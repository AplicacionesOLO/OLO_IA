"""Runner de entrenamiento: coge una ejecución encolada, entrena, y reporta.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ ESTO ES UN GUION Y NO UN ENDPOINT

Entrenar tarda de minutos a horas y necesita GPU. Dentro de la API sería un proceso
web bloqueado durante ese tiempo, sin forma de repartir el trabajo entre máquinas y
sin poder entrenar en un sitio y servir en otro. Así que la API es el REGISTRO —qué se
pidió, con qué datos, qué salió— y esto es el que trabaja.

Se ejecuta donde esté la GPU: en el portátil con CUDA, en una caja de alquiler, en
Colab con el repositorio montado. Lo único que necesita es alcanzar la API.

═══════════════════════════════════════════════════════════════════════════════
LO QUE HACE, EN ORDEN

  1. pide la siguiente ejecución `queued` (o la que se le indique con --run)
  2. `POST /start` con el nombre de esta máquina
  3. descarga el dataset congelado con el export YOLO que ya existe
  4. entrena con ultralytics
  5. `POST /finish` con las métricas reales y la referencia a los pesos

Si algo falla en 3, 4 o 5, cierra la ejecución como `failed` CON el motivo. Una
ejecución que se queda en `running` para siempre porque el proceso murió es peor que
una fallida: parece que sigue trabajando.

═══════════════════════════════════════════════════════════════════════════════
SIN ULTRALYTICS NO ENTRENA, Y NO FINGE

Si `ultralytics` no está instalado, este guion NO reporta métricas inventadas ni cierra
la ejecución como si hubiera entrenado: se detiene y lo dice, y la ejecución sigue
encolada para que la coja una máquina que sí pueda. Es la diferencia entre «todavía no
hay con qué entrenar» y «se entrenó y estos son los resultados», y confundirlas metería
en el registro un modelo que nunca existió.

    pip install ultralytics        # arrastra torch: ~2,5 GB

═══════════════════════════════════════════════════════════════════════════════
USO

    python tools/entrenar.py --listar
    python tools/entrenar.py                      # coge la siguiente encolada
    python tools/entrenar.py --run <uuid>
    python tools/entrenar.py --run <uuid> --seco   # sin entrenar, solo el ciclo

`--seco` recorre el ciclo completo —arranca, exporta el dataset, cierra— SIN entrenar
y SIN métricas, y deja la ejecución en `failed` con el motivo «prueba en seco». Sirve
para comprobar la fontanería de la API en una máquina sin GPU sin dejar un modelo
falso en el registro.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
ENV_LOCAL = REPO / ".env.local"
SECRETS = REPO / ".secrets"


def _leer_clave(path: Path, clave: str) -> str | None:
    if not path.exists():
        return None
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        linea = raw.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, _, v = linea.partition("=")
        if k.strip() == clave:
            return v.strip().strip('"').strip("'")
    return None


class Api:
    """Cliente mínimo. `urllib` y no `httpx` a propósito.

    Este guion tiene que poder correr en una máquina que solo tiene Python y
    ultralytics —una caja de GPU alquilada, un Colab— sin instalar las dependencias
    del backend. Cada `import` extra es una razón más para que no arranque justo donde
    hace falta.
    """

    def __init__(self, base: str, token: str) -> None:
        # El esquema se COMPRUEBA, no se silencia. `urlopen` acepta `file:` y
        # esquemas propios, asi que un `--api file:///c:/algo` leeria el disco local
        # creyendo hablar con la API. Es la clase de cosa que no falla: devuelve algo.
        if not base.startswith(("http://", "https://")):
            msg = f"--api tiene que ser http o https, no {base.split(':', 1)[0]!r}"
            raise ValueError(msg)
        self._base = base.rstrip("/")
        self._token = token

    def _pedir(self, metodo: str, ruta: str, cuerpo: Any = None) -> Any:
        req = urllib.request.Request(
            f"{self._base}{ruta}",
            method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req) as r:
                crudo = r.read()
                return json.loads(crudo)["data"] if crudo else None
        except urllib.error.HTTPError as e:
            detalle = e.read().decode("utf-8", "replace")[:600]
            msg = f"HTTP {e.code} en {metodo} {ruta}: {detalle}"
            raise RuntimeError(msg) from e

    def get(self, ruta: str) -> Any:
        return self._pedir("GET", ruta)

    def post(self, ruta: str, cuerpo: Any = None) -> Any:
        return self._pedir("POST", ruta, cuerpo)

    def subir(self, url: str, datos: bytes, content_type: str) -> None:
        """Sube los bytes a Storage, con `POST` y con el token propio.

        Directo al almacenamiento y no a traves de la API: pasar 6 MB de pesos por el
        proceso web solo para reenviarlos gastaria memoria del servidor sin añadir nada.

        Dos detalles que cuestan un intento cada uno si se dan por hechos:

        · es POST, no PUT. Lo dice el docstring de `upload_endpoint`: «donde el cliente
          hace el POST del binario, con su propio token».
        · lleva `Authorization`. Sin ella Storage responde 401 y el `confirm` posterior
          falla diciendo «el objeto no existe», que es cierto y no explica por que.

        Y `confirm` COMPRUEBA que el objeto este: no hay forma de registrar un asset
        cuyos bytes no se subieron, que es exactamente lo que hay que querer.
        """
        req = urllib.request.Request(
            url,
            method="POST",
            data=datos,
            headers={
                "Content-Type": content_type,
                "Authorization": f"Bearer {self._token}",
            },
        )
        with urllib.request.urlopen(req) as r:
            if r.status >= 300:
                msg = f"la subida de pesos devolvio HTTP {r.status}"
                raise RuntimeError(msg)

    def descargar(self, ruta: str, destino: Path) -> Path:
        """Descarga un binario. El export del dataset es un ZIP, no JSON."""
        req = urllib.request.Request(
            f"{self._base}{ruta}", headers={"Authorization": f"Bearer {self._token}"}
        )
        with urllib.request.urlopen(req) as r, destino.open("wb") as f:
            shutil.copyfileobj(r, f)
        return destino


def _login(base: str, email: str, password: str) -> str:
    if not base.startswith(("http://", "https://")):
        msg = f"--api tiene que ser http o https, no {base.split(':', 1)[0]!r}"
        raise ValueError(msg)
    req = urllib.request.Request(
        f"{base.rstrip('/')}/v1/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return str(json.load(r)["data"]["access_token"])


def _nombre_de_maquina() -> str:
    """Quién entrenó. Se manda al arrancar y queda en la ejecución.

    Es el dato que explica dos ejecuciones con los mismos hiperparámetros y métricas
    distintas: casi siempre es dónde corrieron.
    """
    gpu = "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            gpu = torch.cuda.get_device_name(0).replace(" ", "-")
    except Exception:  # noqa: S110 — sin torch, el nombre se queda en «cpu»
        pass
    return f"{platform.node()}/{gpu}"[:100]


def _hay_ultralytics() -> bool:
    import importlib.util

    return importlib.util.find_spec("ultralytics") is not None


def _entrenar(
    *, raiz_dataset: Path, arquitectura: str, hiperparams: dict[str, Any], salida: Path
) -> dict[str, Any]:
    """Entrena de verdad y devuelve las métricas que produjo ultralytics.

    Las métricas se LEEN del resultado, no se calculan aquí ni se redondean a algo
    presentable: son las que el entrenador midió sobre el conjunto de validación, y son
    lo único con lo que después se puede comparar dos modelos.
    """
    from ultralytics import YOLO

    pesos_base = hiperparams.get("weights") or f"{arquitectura}.pt"
    epocas = int(hiperparams.get("epochs", 50))
    imgsz = int(hiperparams.get("imgsz", 640))
    batch = int(hiperparams.get("batch", 8))

    yaml = raiz_dataset / "data.yaml"
    if not yaml.exists():
        # El export YOLO tiene que traerlo. Si no está, el dataset no es lo que dice
        # ser, y entrenar contra un directorio a medias produciría un modelo que
        # aprendió de menos imágenes de las que su ejecución declara.
        candidatos = list(raiz_dataset.rglob("data.yaml"))
        if not candidatos:
            msg = f"el export no trae data.yaml en {raiz_dataset}"
            raise RuntimeError(msg)
        yaml = candidatos[0]

    t0 = time.monotonic()
    modelo = YOLO(pesos_base)
    resultado = modelo.train(
        data=str(yaml),
        epochs=epocas,
        imgsz=imgsz,
        batch=batch,
        project=str(salida),
        name="run",
        exist_ok=True,
        verbose=True,
    )
    segundos = round(time.monotonic() - t0, 1)

    caja = getattr(getattr(resultado, "box", None), "__dict__", {})
    metricas: dict[str, Any] = {
        "epochs": epocas,
        "imgsz": imgsz,
        "batch": batch,
        "train_seconds": segundos,
        "base_weights": str(pesos_base),
    }
    # Los nombres de ultralytics cambian entre versiones; se buscan varios y se
    # apunta lo que haya. Inventar un 0 para el que falte sería peor: un mAP de 0 es
    # una afirmación —el modelo no acierta nada— y no «no lo sé».
    for destino, posibles in (
        ("map50", ("map50", "map_50")),
        ("map50_95", ("map", "map50_95")),
        ("precision", ("mp", "precision")),
        ("recall", ("mr", "recall")),
    ):
        for nombre in posibles:
            valor = caja.get(nombre)
            if valor is not None:
                metricas[destino] = round(float(valor), 5)
                break

    mejor = next(iter(sorted(salida.rglob("best.pt"))), None)
    if mejor is not None:
        metricas["weights_file"] = str(mejor)
        metricas["weights_bytes"] = mejor.stat().st_size
    return metricas


def main() -> int:
    ap = argparse.ArgumentParser(description="Runner de entrenamiento de OLO_IA")
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="arojas@ologistics.com")
    ap.add_argument("--run", help="uuid de la ejecucion; sin esto coge la siguiente encolada")
    ap.add_argument("--listar", action="store_true", help="lista las ejecuciones y sale")
    ap.add_argument(
        "--seco",
        action="store_true",
        help="recorre el ciclo SIN entrenar y cierra como fallida con el motivo. "
        "Para comprobar la fontaneria en una maquina sin GPU sin dejar un modelo falso",
    )
    ap.add_argument("--trabajo", default=str(Path.home() / "olo-entrenamientos"))
    args = ap.parse_args()

    pw_path = SECRETS / "adminpw.txt"
    if not pw_path.exists():
        print(f"FALTA la contraseña en {pw_path}")
        return 2
    token = _login(args.api, args.email, pw_path.read_text(encoding="utf-8").strip())
    api = Api(args.api, token)

    if args.listar:
        datos = api.get("/v1/ai/training-runs?limit=50")
        print(f"runner conectado segun la API: {datos['runner_available']}")
        if datos.get("unavailable_reason"):
            print(f"   {datos['unavailable_reason']}")
        for r in datos["runs"]:
            print(
                f"  {r['status']:10} {r['id']} · {r['architecture_code']:12} "
                f"· runner={r['runner'] or '-'} · {r['created_at'][:19]}"
            )
        if not datos["runs"]:
            print("  (ninguna ejecucion todavia)")
        return 0

    # ── Elegir la ejecución ────────────────────────────────────────────────
    if args.run:
        run = api.get(f"/v1/ai/training-runs/{args.run}")
    else:
        cola = api.get("/v1/ai/training-runs?status=queued&limit=1")
        if not cola["runs"]:
            print("no hay ninguna ejecucion encolada")
            return 0
        run = cola["runs"][0]

    run_id = run["id"]
    print(f"→ ejecucion {run_id}")
    print(f"  arquitectura : {run['architecture_code']}")
    print(f"  dataset      : {run['dataset_version_id']}")
    print(f"  clases       : {len(run['class_map'])}")
    print(f"  hiperparams  : {json.dumps(run['hyperparams'], ensure_ascii=False)}")

    if not args.seco and not _hay_ultralytics():
        # NO se cierra la ejecución: se deja encolada para que la coja una máquina que
        # pueda. Cerrarla como fallida por no tener la librería castigaría al
        # entrenamiento por un problema de esta máquina.
        print(
            "\nFALTA `ultralytics` en esta maquina, asi que NO se entrena y la ejecucion\n"
            "se queda ENCOLADA para otra que si pueda.\n"
            "  pip install ultralytics      (arrastra torch, ~2,5 GB)\n"
            "\nNo se reportan metricas inventadas: «todavia no hay con que entrenar» y\n"
            "«se entreno y estos son los resultados» no son lo mismo."
        )
        return 3

    # ── Arrancar ───────────────────────────────────────────────────────────
    maquina = _nombre_de_maquina()
    run = api.post(f"/v1/ai/training-runs/{run_id}/start", {"runner": maquina})
    print(f"\n[1/3] arrancada en {maquina}")

    trabajo = Path(args.trabajo) / str(run_id)
    trabajo.mkdir(parents=True, exist_ok=True)

    try:
        # ── Dataset ────────────────────────────────────────────────────────
        proyecto = run["project_id"]
        dv = run["dataset_version_id"]
        zip_path = trabajo / "dataset.zip"
        api.descargar(
            f"/v1/ai/projects/{proyecto}/dataset-versions/{dv}/export", zip_path
        )
        raiz = trabajo / "dataset"
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(raiz)
        imagenes = sum(1 for _ in raiz.rglob("*.jpg")) + sum(1 for _ in raiz.rglob("*.png"))
        print(f"[2/3] dataset extraido: {imagenes} imagenes en {raiz}")

        if args.seco:
            # Se cierra como FALLIDA con el motivo, no como éxito sin métricas: una
            # ejecución `succeeded` sin pesos sería un modelo que no existe.
            api.post(
                f"/v1/ai/training-runs/{run_id}/finish",
                {
                    "error_message": (
                        f"prueba en seco: se comprobo el ciclo completo y el dataset "
                        f"({imagenes} imagenes) sin entrenar. No hay modelo."
                    )
                },
            )
            print("[3/3] cerrada como fallida · prueba en seco, sin modelo")
            return 0

        # ── Entrenar ───────────────────────────────────────────────────────
        metricas = _entrenar(
            raiz_dataset=raiz,
            arquitectura=str(run["architecture_code"]),
            hiperparams=dict(run["hyperparams"]),
            salida=trabajo / "salida",
        )
        print(f"[3/3] entrenado: {json.dumps(metricas, ensure_ascii=False)}")

        # ── Subir los pesos ────────────────────────────────────────────────
        #
        # `ai.model_versions.weights_asset_id` es NOT NULL, y con razon: una version
        # sin archivo no es una version, es una anotacion sobre unas metricas. Asi que
        # el `best.pt` se sube como asset de tipo `weights` con el mismo
        # prepare/confirm que las imagenes del proyecto.
        pesos = metricas.get("weights_file")
        if not pesos or not Path(pesos).exists():
            msg = (
                "el entrenamiento termino y no dejo `best.pt`: sin archivo de pesos no "
                "se puede registrar la version"
            )
            raise RuntimeError(msg)

        ruta_pesos = Path(pesos)
        contenido = ruta_pesos.read_bytes()
        sha = hashlib.sha256(contenido).hexdigest()
        print(f"      subiendo pesos: {ruta_pesos.name} · {len(contenido) / 1e6:.1f} MB")

        prep = api.post(
            f"/v1/ai/projects/{proyecto}/assets/prepare",
            {
                "kind": "weights",
                "content_type": "application/octet-stream",
                "bytes": len(contenido),
                "original_filename": ruta_pesos.name,
            },
        )
        api.subir(prep["upload_url"], contenido, "application/octet-stream")
        asset = api.post(
            f"/v1/ai/projects/{proyecto}/assets/confirm",
            {
                "asset_id": prep["asset_id"],
                "kind": "weights",
                "original_filename": ruta_pesos.name,
                "content_type": "application/octet-stream",
                "bytes": len(contenido),
                "sha256": sha,
            },
        )
        print(f"      pesos guardados como asset {asset['id']}")

        resultado = api.post(
            f"/v1/ai/training-runs/{run_id}/finish",
            {
                "metrics": metricas,
                "weights_asset_id": asset["id"],
                # DONDE CORRIO, que es distinto de donde estan los bytes: eso lo dice
                # el asset. Las dos cosas hacen falta para reproducir un resultado.
                "source_reference": f"{maquina}:{pesos}",
                "version_notes": (
                    f"entrenado por {maquina} · "
                    f"mAP50={metricas.get('map50', 'n/d')} · "
                    f"{metricas.get('train_seconds')} s"
                ),
            },
        )
        v = resultado.get("version")
        print(f"\n✓ version registrada: v{v['version']} ({v['status']})" if v else "\n✓ cerrada")
        if resultado.get("missing_metrics"):
            print(f"  metricas que no vinieron: {', '.join(resultado['missing_metrics'])}")
        if v:
            print(
                "\nLa version nace en `registered`. Para que percepcion la ofrezca hay "
                "que validarla y publicarla:\n"
                f"  POST /v1/ai/model-versions/{v['id']}/status  "
                '{"to_status": "validating"}  → validated → published'
            )
        return 0

    except Exception as exc:  # se reporta y se cierra la ejecución
        # Una ejecución que se queda en `running` para siempre porque el proceso murió
        # es peor que una fallida: parece que sigue trabajando.
        motivo = f"{type(exc).__name__}: {exc}"[:3900]
        print(f"\n✗ FALLO: {motivo}")
        try:
            api.post(f"/v1/ai/training-runs/{run_id}/finish", {"error_message": motivo})
            print("  ejecucion cerrada como `failed` con el motivo")
        except Exception as cierre:
            print(f"  ADEMAS no se pudo cerrar la ejecucion: {cierre}")
            print(f"  cierrala a mano: POST /v1/ai/training-runs/{run_id}/cancel")
        return 1


if __name__ == "__main__":
    sys.exit(main())
