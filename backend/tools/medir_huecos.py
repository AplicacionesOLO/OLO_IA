"""MIDE SI EL MOVIMIENTO SEPARA UN HUECO LLENO DE UNO VACIO, Y SACA EL UMBRAL.

═══════════════════════════════════════════════════════════════════════════════════════
PARA QUE SIRVE

Para no elegir el umbral: leerlo. `olo.domain.perception.rejilla` decide que una posicion
esta vacia cuando lo que hay dentro se mueve menos que `UMBRAL_FLUJO_VACIO`, y ese numero
salio de correr esto sobre 36 anotaciones reales:

        hueco vacio    n=15    0,192 … 0,475    mediana 0,268
        con pallet     n=21    0,808 … 1,102    mediana 1,007

Separacion completa. Cuando haya mas anotaciones —o material de otro almacen, u otra altura
de vuelo— hay que volver a correr esto y comprobar que el umbral sigue en su sitio. Si las
dos poblaciones empiezan a solaparse, el numero hay que moverlo, y este guion dice cuanto.

═══════════════════════════════════════════════════════════════════════════════════════
COMO SE USA

    set PYTHONIOENCODING=utf-8
    python tools/medir_huecos.py <video local> --asset <nombre en ai.assets>

El video local tiene que ser EL MISMO archivo que se subio, porque los `frame_index` de las
anotaciones apuntan a sus fotogramas. Si se subio una copia recomprimida, hay que medir
sobre esa copia y no sobre el original.

    python tools/medir_huecos.py vista_4k.mp4 --asset DJI_0005_H264_4K.mp4

Deja un `histograma_flujo.png` al lado si matplotlib esta instalado, y en cualquier caso
imprime los numeros: el resumen de cada poblacion, el mejor corte, y los casos en que un
mismo fotograma tiene un vacio y un lleno a la vez — que son los que no admiten excusas,
porque comparten velocidad del dron y luz—.

═══════════════════════════════════════════════════════════════════════════════════════
EL FLUJO SE NORMALIZA, Y ESO NO ES UN DETALLE

El dron no lleva velocidad constante: acelera, frena y gira. Un hueco lleno grabado despacio
da menos flujo ABSOLUTO que uno vacio grabado deprisa, asi que un umbral sobre el valor
absoluto mediria la velocidad del dron y no la profundidad del hueco.

Se divide por el percentil 75 del fotograma completo. Lo que queda es «esta region se mueve
mas o menos que el resto de la escena», que es la pregunta que se queria hacer.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend" / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import admin_sql  # noqa: E402  reutiliza su lectura de credenciales

#: A que escala se mide el flujo. A 4K no aporta nada y cuesta cuatro veces mas: lo que se
#: mide es el movimiento de REGIONES grandes, no de pixeles sueltos.
ESCALA = 0.5

#: Las clases que hacen de «lleno» y de «vacio». `pallet` sirve de contraparte sin anotar
#: nada de mas: una tarima anotada esta, por definicion, en una posicion ocupada.
CLASE_VACIO = "hueco_vacio"
CLASE_LLENO = "pallet"

SQL = """
SELECT c.name AS clase, i.frame_index AS f, a.cx, a.cy, a.w, a.h
  FROM ai.annotations a
  JOIN ai.classes c ON c.id = a.class_id
  JOIN ai.images i ON i.id = a.image_id
  JOIN ai.assets v ON v.id = i.source_video_asset_id
 WHERE a.deleted_at IS NULL
   AND v.original_filename = $1
   AND c.name = ANY($2::text[])
 ORDER BY i.frame_index
"""


async def _anotaciones(asset: str) -> list[dict[str, Any]]:
    import asyncpg

    conn = await asyncpg.connect(**admin_sql._connection_kwargs())
    try:
        filas = await conn.fetch(SQL, asset, [CLASE_VACIO, CLASE_LLENO])
    finally:
        await conn.close()
    #  `numeric` llega como `Decimal` y mezclarlo con `float` revienta al dividir.
    return [
        {k: (float(v) if k in ("cx", "cy", "w", "h") else v) for k, v in dict(r).items()}
        for r in filas
    ]


def _medir(video: Path, filas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(video), cv2.CAP_FFMPEG)
    if not cap.isOpened():
        sys.exit(f"no se pudo abrir {video}")

    por_fotograma: dict[int, list[dict[str, Any]]] = {}
    for r in filas:
        por_fotograma.setdefault(int(r["f"]), []).append(r)

    salida: list[dict[str, Any]] = []
    try:
        for indice in sorted(por_fotograma):
            cap.set(cv2.CAP_PROP_POS_FRAMES, indice)
            ok1, a = cap.read()
            ok2, b = cap.read()
            if not (ok1 and ok2):
                print(f"  fotograma {indice}: no se pudo leer el par")
                continue
            ga = cv2.cvtColor(cv2.resize(a, None, fx=ESCALA, fy=ESCALA), cv2.COLOR_BGR2GRAY)
            gb = cv2.cvtColor(cv2.resize(b, None, fx=ESCALA, fy=ESCALA), cv2.COLOR_BGR2GRAY)
            mag = np.linalg.norm(
                cv2.calcOpticalFlowFarneback(ga, gb, None, 0.5, 3, 25, 3, 5, 1.2, 0), axis=2
            )
            referencia = float(np.percentile(mag, 75))
            if referencia <= 0:
                continue
            alto, ancho = mag.shape
            for r in por_fotograma[indice]:
                x1 = int(max(0, (r["cx"] - r["w"] / 2) * ancho))
                x2 = int(min(ancho, (r["cx"] + r["w"] / 2) * ancho))
                y1 = int(max(0, (r["cy"] - r["h"] / 2) * alto))
                y2 = int(min(alto, (r["cy"] + r["h"] / 2) * alto))
                if x2 <= x1 or y2 <= y1:
                    continue
                mediana = float(np.median(mag[y1:y2, x1:x2]))
                salida.append(
                    {
                        "clase": r["clase"],
                        "f": indice,
                        "absoluto": mediana,
                        "relativo": mediana / referencia,
                        "movimiento": referencia,
                    }
                )
    finally:
        cap.release()
    return salida


def _informar(medidas: list[dict[str, Any]], destino: Path) -> None:
    import numpy as np

    vac = np.array([m["relativo"] for m in medidas if m["clase"] == CLASE_VACIO])
    lle = np.array([m["relativo"] for m in medidas if m["clase"] == CLASE_LLENO])
    if len(vac) == 0 or len(lle) == 0:
        sys.exit(
            f"hacen falta anotaciones de las DOS clases y hay {len(vac)} de {CLASE_VACIO} "
            f"y {len(lle)} de {CLASE_LLENO}. Sin las dos no hay nada que separar."
        )

    print("\nFLUJO RELATIVO (1,0 = se mueve como el resto de la escena)\n")
    for nombre, v in ((CLASE_VACIO, vac), (CLASE_LLENO, lle)):
        print(
            f"  {nombre:14s} n={len(v):3d}  min={v.min():.3f}  mediana={np.median(v):.3f}  "
            f"max={v.max():.3f}"
        )

    #  Se prueban todos los cortes y se queda el que menos se equivoca. Si el mejor falla
    #  mucho, la respuesta honesta es que este material NO separa.
    todos = np.concatenate([vac, lle])
    mejor = (0.0, -1.0)
    for corte in np.unique(todos):
        acierto = float(((vac < corte).sum() + (lle >= corte).sum()) / len(todos))
        if acierto > mejor[1]:
            mejor = (float(corte), acierto)
    corte, acierto = mejor
    print(f"\n  mejor corte: {corte:.3f}  ->  acierta {acierto * 100:.0f} %")
    print(
        f"  se solapan: {int((vac >= corte).sum())} vacio(s) por encima y "
        f"{int((lle < corte).sum())} lleno(s) por debajo"
    )
    #  El corte que mas acierta suele quedar PEGADO al borde de una de las dos poblaciones.
    #  El robusto es el punto medio del margen, y es el que se lleva al dominio.
    if (vac < corte).all() and (lle >= corte).all():
        medio = (vac.max() + lle.min()) / 2
        print(
            f"  separacion COMPLETA · umbral recomendado {medio:.3f} "
            f"(punto medio entre {vac.max():.3f} y {lle.min():.3f})"
        )
    else:
        print("  NO separan del todo: el umbral que se lleve al dominio va a fallar casos")

    #  Los pares del mismo fotograma: misma velocidad, misma luz, ninguna excusa.
    pares = {}
    for m in medidas:
        pares.setdefault(m["f"], {}).setdefault(m["clase"], []).append(m["relativo"])
    bien = total = 0
    for f, c in sorted(pares.items()):
        if CLASE_VACIO in c and CLASE_LLENO in c:
            total += 1
            v, lln = float(np.mean(c[CLASE_VACIO])), float(np.mean(c[CLASE_LLENO]))
            bien += v < lln
            print(
                f"    fotograma {f}: vacio {v:.3f} vs lleno {lln:.3f}"
                f"   {'OK' if v < lln else 'AL REVES'}"
            )
    if total:
        print(f"\n  en el MISMO fotograma el vacio se mueve menos en {bien} de {total}")

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("\n  (sin matplotlib: no se dibuja el histograma)")
        return

    fig, ax = plt.subplots(figsize=(9, 4.5), dpi=130)
    topes = np.linspace(0, float(todos.max()) * 1.05, 22)
    ax.hist(lle, bins=topes, alpha=0.75, label=f"{CLASE_LLENO} (n={len(lle)})", color="#34E5B4")
    ax.hist(vac, bins=topes, alpha=0.75, label=f"{CLASE_VACIO} (n={len(vac)})", color="#64748B")
    ax.axvline(corte, color="#F472B6", ls="--", lw=2, label=f"corte {corte:.2f}")
    ax.set_xlabel("flujo de la region / flujo del fotograma  (bajo = lejos = se ve el fondo)")
    ax.set_ylabel("casos")
    ax.legend()
    fig.tight_layout()
    fig.savefig(destino)
    print(f"\n  {destino}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("video", type=Path, help="el MISMO archivo que se subio")
    ap.add_argument("--asset", required=True, help="original_filename en ai.assets")
    ap.add_argument("--png", type=Path, default=Path("histograma_flujo.png"))
    ap.add_argument("--json", type=Path, help="guarda las medidas crudas")
    args = ap.parse_args()

    if not args.video.exists():
        sys.exit(f"no existe {args.video}")

    filas = asyncio.run(_anotaciones(args.asset))
    print(f"{len(filas)} anotaciones de {args.asset}")
    if not filas:
        sys.exit(
            "ninguna anotacion. Comprueba el nombre del asset: tiene que ser el "
            "`original_filename` con el que se subio, no la ruta del archivo local."
        )

    medidas = _medir(args.video, filas)
    print(f"{len(medidas)} medidas")
    if args.json:
        args.json.write_text(json.dumps(medidas, indent=1), encoding="utf-8")
    _informar(medidas, args.png)


if __name__ == "__main__":
    main()
