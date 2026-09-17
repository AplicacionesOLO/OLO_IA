"""Alertas proactivas de cuota y flota (#6 del plan de mejoras SaaS).

═══════════════════════════════════════════════════════════════════════════════
QUE REVISA, Y POR QUE DOS ENDPOINTS Y NO UNO

`POST /v1/usage/quota-alert` avisa si detecciones o dispositivos estan al 90%
o mas de la cuota del tenant. `POST /v1/fleet/devices/offline-alert` avisa de
cada dispositivo que dejo de latir sin haber sido retirado a mano. Son dos
endpoints, no uno, porque son dos servicios (`UsageService`/`FleetService`)
con su propia idempotencia (`core.tenant_quota_alerts` / `fleet_devices.
offline_notified_at`, ver migracion 0116) -- juntarlos en un tercer endpoint
solo para este guion duplicaria esa logica en vez de reusarla.

═══════════════════════════════════════════════════════════════════════════════
POR QUE VA POR LA API Y NO POR SQL DIRECTO

Igual que `escalar_incidencias.py`: los dos endpoints ya deciden que esta cerca
del limite, a quien avisar (los `tenant_admin` del tenant) y si ya se aviso de
ESTE periodo/caida -- este guion no necesita saber nada de esas reglas, solo
llamarlos.

═══════════════════════════════════════════════════════════════════════════════
POR QUE NO RECORRE ALMACENES

A diferencia de `escalar_incidencias.py` -- las incidencias son de un almacen
concreto --, la cuota y la flota son del TENANT entero: RLS ya acota cada
endpoint a la sesion con la que este guion entra, sin necesidad de listar nada
antes.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from sesion import Sesion
from vigilante import Api  # misma clase, mismo manejo de sesion y reintento

REPO = Path(__file__).resolve().parents[2]
SECRETS = REPO / ".secrets"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Avisa si la cuota del tenant esta cerca del limite o si "
        "un dispositivo de flota se cayo sin haber sido retirado"
    )
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="arojas@ologistics.com")
    args = ap.parse_args()

    # Mismo motivo que vigilante.py/escalar_incidencias.py: sin consola
    # adjunta, Windows cae al codepage del sistema y revienta con acentos.
    for flujo in (sys.stdout, sys.stderr):
        if isinstance(flujo, io.TextIOWrapper):
            flujo.reconfigure(encoding="utf-8")

    pw_path = SECRETS / "adminpw.txt"
    if not pw_path.exists():
        print(f"FALTA la contraseña en {pw_path}")
        return 2

    sesion = Sesion(args.api, args.email, pw_path.read_text(encoding="utf-8").strip())
    api = Api(args.api, sesion)

    cuota = api.post("/v1/usage/quota-alert")
    avisos_cuota = cuota.get("avisos_enviados") or []
    if avisos_cuota:
        print(f"cuota: se aviso de {', '.join(avisos_cuota)}")
    else:
        print("cuota: nada cerca del limite (o ya se habia avisado este periodo)")

    flota = api.post("/v1/fleet/devices/offline-alert")
    avisados = flota.get("dispositivos_avisados") or []
    if avisados:
        print(f"flota: caidos y avisados -> {', '.join(avisados)}")
    else:
        print("flota: ningun dispositivo caido sin avisar")

    return 0


if __name__ == "__main__":
    sys.exit(main())
