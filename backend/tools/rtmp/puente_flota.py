"""Puente de latido: hace que el DRON aparezca EN VIVO en el modulo Flota.

El dron DJI no corre nuestro APK, asi que no late solo ni necesita "Crear
credencial" (esa via crea una identidad anonima en Supabase Auth y es para
telefonos). Este puente usa la MISMA via que un telefono al latir --
`FleetService.heartbeat` -> `latir()` -- que hace un simple upsert del
dispositivo SIN tocar Supabase Auth. Por eso NO depende de que los inicios de
sesion anonimos esten habilitados.

Mientras corre:
  * registra/refresca un dispositivo tipo `drone` cada ~20 s, y
  * si le pasas --job-id, le pone ese `current_job_id` -> la tarjeta de Flota
    pasa a "En vivo" y enlaza sola a /perception/jobs/<job-id>.
Al cerrarlo (Ctrl-C) manda un ultimo latido SIN job -> queda "connected" y, a
los 45 s sin latido, "offline". Nada que limpiar.

Es ADITIVO: no toca backend, worker ni frontend. Solo habla con la BD via los
servicios que ya existen.

Uso (desde C:\\OLO_IA\\backend, con el venv):
  # Solo mostrar el dron conectado (sin directo todavia):
  PYTHONPATH=src .venv/Scripts/python.exe tools/rtmp/puente_flota.py

  # Con un directo en curso (lo normal) -> sale "En vivo" + enlace:
  PYTHONPATH=src .venv/Scripts/python.exe tools/rtmp/puente_flota.py \
      --job-id <uuid-del-directo>

  Opciones:
    --job-id     UUID del trabajo en vivo (de crear_directo.py). Opcional.
    --nombre     Nombre del dron en Flota. Por defecto "DJI -- dron".
    --modelo     Modelo mostrado. Por defecto "DJI RC331".
    --device-key Clave persistente del dron (mismo dron = misma tarjeta).
    --intervalo  Segundos entre latidos. Por defecto 20 (el backend marca
                 offline a los 45 s, asi que no subas de ~40).
"""
import argparse
import asyncio
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from olo.core.config import get_settings
from olo.core.context import TenantContext, set_request_ids
from olo.db.session import init_engine, tenant_session, dispose_engine
from olo.services.fleet import FleetService

AUTH_USER = UUID("50beb54b-16a5-4bdc-a030-ac94d8375850")
TENANT = UUID("d1ae4202-6f85-45d9-a8ed-ca9d122c0257")
WAREHOUSE = UUID("cae0859d-7dd8-4cfb-ae9d-422f00b5dc1a")


async def _latir(ctx: TenantContext, a, *, job_id: UUID | None) -> dict:
    async with tenant_session(ctx) as s:
        svc = FleetService(s, ctx)
        return await svc.heartbeat(
            device_key=a.device_key,
            kind="drone",
            name=a.nombre,
            warehouse_id=WAREHOUSE,
            app_version="puente-rtmp",
            device_model=a.modelo,
            current_job_id=job_id,
        )


async def main(a) -> int:
    settings = get_settings()
    init_engine(settings)
    set_request_ids("puente-flota", "puente-flota")
    ctx = TenantContext(
        auth_user_id=AUTH_USER,
        tenant_id=TENANT,
        tenant_wide_access=True,
        warehouse_id=WAREHOUSE,
    )
    job_id = UUID(a.job_id) if a.job_id else None
    try:
        d = await _latir(ctx, a, job_id=job_id)
        estado = d.get("status", "?")
        print(f"DRON EN FLOTA: {d.get('name')}  ->  estado '{estado}'")
        if job_id:
            print(f"  enlazado al directo {job_id} (la tarjeta mostrara 'En vivo')")
        else:
            print("  sin directo: aparece 'connected'. Pasa --job-id para 'En vivo'.")
        print(f"  latiendo cada {a.intervalo}s. Ctrl-C para detener.\n")
        try:
            while True:
                await asyncio.sleep(a.intervalo)
                await _latir(ctx, a, job_id=job_id)
                print("  . latido")
        except (KeyboardInterrupt, asyncio.CancelledError):
            print("\nCerrando: ultimo latido sin directo...")
            await _latir(ctx, a, job_id=None)
            print("Listo. El dron quedara 'offline' en ~45s sin mas latidos.")
    finally:
        await dispose_engine()
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--job-id", default=None)
    p.add_argument("--nombre", default="DJI -- dron")
    p.add_argument("--modelo", default="DJI RC331")
    p.add_argument("--device-key", default="dron-dji-rc331")
    p.add_argument("--intervalo", type=float, default=20.0)
    raise SystemExit(asyncio.run(main(p.parse_args())))
