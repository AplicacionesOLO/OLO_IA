"""Escalamiento de incidencias vencidas: avisa a quien las tiene asignadas.

═══════════════════════════════════════════════════════════════════════════════
EL PROBLEMA QUE ESTO RESUELVE

`due_date` (0105) lo fija una persona a mano, y hasta ahora fijarlo era el final del
camino: nada volvía a mirarlo. Una incidencia podía llevar semanas vencida sin que
quien la tiene asignada se enterara, salvo que alguien abriera la bandeja y se
fijara en el color del badge.

═══════════════════════════════════════════════════════════════════════════════
POR QUE ESTO NO ES LA "POLITICA DE SLA" QUE 0105 DIJO QUE NO HABRIA

0105 rechazó adivinar un plazo por defecto: eso sería el sistema decidiendo algo que
le tocaba decidir a una persona. Aquí no se adivina nada — `due_date` ya lo fijó una
persona de verdad, y este guion solo hace visible que ese plazo, el que ELLA fijó, ya
se cumplió. No cierra la incidencia, no cambia su estado, no reasigna a nadie.

═══════════════════════════════════════════════════════════════════════════════
POR QUE VA POR LA API Y NO POR SQL DIRECTO

Igual que `vigilante.py`: llama a `POST .../overdue-alert`, el mismo endpoint que
usaría cualquier automatismo futuro, y ese endpoint es el que decide si de verdad
está vencida, si tiene a quien avisar, y si ya se avisó de ESTE vencimiento
(idempotente — ver `IncidentService.alertar_vencimiento`). Este guion no necesita
saber nada de esas reglas: solo encuentra candidatas y llama al endpoint.

═══════════════════════════════════════════════════════════════════════════════
POR QUE RECORRE ALMACENES UNO A UNO

A diferencia de entrenamientos y trabajos de percepción —que no son de ningún
almacén en particular—, las incidencias sí lo son: `GET /v1/incidents` exige
`warehouse_id`. No hay atajo: hay que listar los almacenes accesibles y consultar
cada uno.

═══════════════════════════════════════════════════════════════════════════════
POR QUE NO HACE FALTA "--bucle"

Mismo motivo que `vigilante.py`: es un barrido corto que termina solo. Repetirlo es
trabajo del planificador de Windows, con un disparador cada N minutos.
"""

from __future__ import annotations

import argparse
import io
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sesion import Sesion
from vigilante import Api  # misma clase, mismo manejo de sesion y reintento

REPO = Path(__file__).resolve().parents[2]
SECRETS = REPO / ".secrets"

ABIERTOS = ("open", "in_progress")


def _vencida(incidencia: dict[str, Any]) -> bool:
    plazo = incidencia.get("due_date")
    if not plazo or incidencia.get("status") not in ABIERTOS:
        return False
    vencimiento = datetime.fromisoformat(plazo.replace("Z", "+00:00"))
    return vencimiento <= datetime.now(UTC)


def _escalar_almacen(api: Api, warehouse_id: str, seco: bool) -> tuple[int, int]:
    """Devuelve (avisadas, sin_asignar)."""
    datos = api.get(f"/v1/incidents?warehouse_id={warehouse_id}&limit=500")
    vencidas = [i for i in datos["items"] if _vencida(i)]

    avisadas = 0
    sin_asignar = 0
    for inc in vencidas:
        if not inc.get("assigned_to"):
            sin_asignar += 1
            print(f"  incidencia {inc['id']} · vencida y SIN asignar → no hay a quien avisar")
            continue
        print(
            f"  incidencia {inc['id']} · vencida, asignada a "
            f"{inc.get('assigned_to_name')} → avisando"
        )
        if not seco:
            api.post(f"/v1/incidents/{inc['id']}/overdue-alert")
        avisadas += 1
    return avisadas, sin_asignar


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Avisa a quien tiene asignada una incidencia de que venció su plazo"
    )
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="arojas@ologistics.com")
    ap.add_argument(
        "--seco", action="store_true",
        help="dice que avisaria, sin avisar de verdad",
    )
    args = ap.parse_args()

    # Mismo motivo que vigilante.py: sin consola adjunta, Windows cae al codepage
    # del sistema y revienta con acentos.
    for flujo in (sys.stdout, sys.stderr):
        if isinstance(flujo, io.TextIOWrapper):
            flujo.reconfigure(encoding="utf-8")

    pw_path = SECRETS / "adminpw.txt"
    if not pw_path.exists():
        print(f"FALTA la contraseña en {pw_path}")
        return 2

    sesion = Sesion(args.api, args.email, pw_path.read_text(encoding="utf-8").strip())
    api = Api(args.api, sesion)

    almacenes = api.get("/v1/spatial/warehouses")
    print(f"→ {len(almacenes)} almacen(es) accesible(s)")

    total_avisadas = 0
    total_sin_asignar = 0
    for wh in almacenes:
        wid, nombre = wh["warehouse_id"], wh["warehouse_name"]
        print(f"→ {nombre} ({wid})")
        avisadas, sin_asignar = _escalar_almacen(api, wid, args.seco)
        total_avisadas += avisadas
        total_sin_asignar += sin_asignar

    if total_avisadas == 0 and total_sin_asignar == 0:
        print("\nninguna incidencia vencida: nada que avisar")
    else:
        verbo = "se avisarian" if args.seco else "se avisaron"
        print(f"\n{total_avisadas} incidencia(s) {verbo}")
        if total_sin_asignar:
            print(f"{total_sin_asignar} vencida(s) sin asignar: nadie a quien avisarles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
