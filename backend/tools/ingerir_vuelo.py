"""Ingiere un recorrido en `spatial.rack_observations` POR LA API.

    python tools/ingerir_vuelo.py --almacen <uuid> --fuente DRONE-01 --tipo drone \
        --racks MZ01,MZ02,MZ03 --desde "2026-08-04T09:00:00Z" --cada 45

── PARA QUE SIRVE ───────────────────────────────────────────────────────────

Es el CLIENTE que hoy no existe: cuando haya un dron con reconocimiento a bordo, lo
que hará es exactamente esto —un POST con «vi estos racks a estas horas»—. Hasta
entonces sirve para dos cosas legítimas:

  1. Ver la vista de rutas funcionando con un recorrido concreto, sin que la
     aplicación traiga datos inventados dentro.
  2. Transcribir una ronda que alguien hizo a mano con una libreta, que es
     información REAL aunque no la haya producido un modelo.

── POR QUE ESTA FUERA DE LA APLICACION ──────────────────────────────────────

Porque un botón «generar vuelo de prueba» dentro de la aplicación mete en la base un
recorrido que nadie hizo, y una observación inventada es indistinguible de una
medida. El día que alguien audite la cobertura del almacén no habría forma de saber
cuál es cuál. Aquí, en `tools/`, quien lo ejecuta sabe lo que está metiendo.

Por eso además NO usa la conexión de administrador: pasa por la API con un usuario y
su permiso `observations:write`, así que la ingesta queda con su `created_by` y
sujeta a las mismas policies que cualquier dispositivo.
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

TIPOS = ("drone", "phone", "fixed_camera", "forklift", "manual")


def parsear() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--api", default="http://127.0.0.1:8000/v1")
    p.add_argument("--email", required=True)
    p.add_argument(
        "--password-file",
        type=Path,
        required=True,
        help="Fichero con la contraseña. No se acepta por argumento porque quedaría "
        "en el historial del shell.",
    )
    p.add_argument("--almacen", required=True, help="UUID del almacén")
    p.add_argument("--fuente", required=True, help="Código de la fuente, p.ej. DRONE-01")
    p.add_argument("--tipo", choices=TIPOS, default="drone")
    p.add_argument("--nombre", default=None)
    p.add_argument(
        "--racks",
        required=True,
        help="Códigos de rack separados por coma, EN EL ORDEN del recorrido. Un código "
        "repetido es un rack por el que se pasó dos veces.",
    )
    p.add_argument(
        "--desde",
        default=None,
        help="ISO 8601 del primer avistamiento. Por omisión, ahora menos la duración "
        "del recorrido, para que el resultado quede en el pasado inmediato.",
    )
    p.add_argument("--cada", type=float, default=45.0, help="Segundos entre avistamientos")
    p.add_argument(
        "--confianza",
        type=float,
        default=None,
        help="0..1. Sin ella se manda `null`, que es «no aplica» —lo correcto para un "
        "registro manual— y no 1, que sería «el modelo está seguro».",
    )
    return p.parse_args()


def main() -> int:
    a = parsear()
    codigos = [c.strip().upper() for c in a.racks.split(",") if c.strip()]
    if not codigos:
        print("✗ --racks está vacío", file=sys.stderr)
        return 2

    inicio = (
        datetime.fromisoformat(a.desde.replace("Z", "+00:00"))
        if a.desde
        else datetime.now(UTC) - timedelta(seconds=a.cada * (len(codigos) - 1) + 60)
    )

    with httpx.Client(timeout=180.0) as c:
        pw = a.password_file.read_text(encoding="utf-8").strip()
        r = c.post(f"{a.api}/auth/login", json={"email": a.email, "password": pw})
        if r.status_code != 200:
            print(f"✗ login: {r.status_code} {r.text[:200]}", file=sys.stderr)
            return 1
        h = {"Authorization": f"Bearer {r.json()['data']['access_token']}"}

        # Los códigos se resuelven a UUID contra el catálogo: el código es único por
        # almacén, no globalmente, así que la API no lo acepta como identificador.
        por_codigo: dict[str, str] = {}
        cursor: str | None = None
        for _ in range(30):
            params: dict[str, object] = {"limit": 200}
            if cursor:
                params["cursor"] = cursor
            plano = c.get(
                f"{a.api}/spatial/warehouses/{a.almacen}/floor-plan",
                params=params,
                headers=h,
            )
            if plano.status_code != 200:
                print(f"✗ catálogo: {plano.status_code} {plano.text[:200]}", file=sys.stderr)
                return 1
            cuerpo = plano.json()
            por_codigo.update({x["rack_code"]: x["rack_id"] for x in cuerpo["data"]})
            cursor = cuerpo["pagination"].get("next_cursor")
            if not cursor:
                break

        faltan = [k for k in codigos if k not in por_codigo]
        if faltan:
            print(f"✗ estos racks no existen en el almacén: {', '.join(faltan)}", file=sys.stderr)
            return 1

        obs = [
            {
                "rack_node_id": por_codigo[k],
                "observed_at": (inicio + timedelta(seconds=a.cada * n)).isoformat(),
                "confidence": a.confianza,
                "notes": f"Ingerido con tools/ingerir_vuelo.py ({a.tipo})",
            }
            for n, k in enumerate(codigos)
        ]

        r = c.post(
            f"{a.api}/spatial/warehouses/{a.almacen}/observations",
            headers=h,
            json={
                "source_code": a.fuente,
                "source_name": a.nombre or a.fuente,
                "source_kind": a.tipo,
                "observations": obs,
            },
        )
        if r.status_code != 200:
            print(f"✗ ingesta: {r.status_code} {r.text[:400]}", file=sys.stderr)
            return 1
        d = r.json()["data"]
        print(
            f"✓ {a.fuente} ({a.tipo}): {d['stored']} nuevas de {d['received']}"
            + (f", {d['duplicates']} ya estaban" if d["duplicates"] else "")
        )

        rutas = c.get(
            f"{a.api}/spatial/warehouses/{a.almacen}/routes",
            params={"source": a.fuente},
            headers=h,
        ).json()["data"]["routes"]
        if not rutas:
            print(
                "  ⚠ la ruta sale vacía: ninguno de esos racks está COLOCADO en el "
                "plano, así que no tienen punto por el que dibujarlos. Publica el "
                "layout desde el editor."
            )
            return 0
        ruta = rutas[0]
        print(
            f"  ruta: {ruta['point_count']} puntos · {ruta['distinct_racks']} racks · "
            f"{ruta['straight_line_distance_m']} m en rectas"
            + (f" · {ruta['duration_s']:.0f} s" if ruta["duration_s"] else "")
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())
