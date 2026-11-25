"""Abre un trabajo de inferencia EN DIRECTO sobre un stream RTSP/RTMP.

El worker con GPU (donde corra `inferir.py --bucle`) lo recoge y analiza el
directo mientras el dron vuela. Preset "huecos vacios" por defecto.

Uso (desde C:\\OLO_IA\\backend, con el venv):
  PYTHONPATH=src .venv/Scripts/python.exe tools/rtmp/crear_directo.py \
      --url rtsp://127.0.0.1:8554/dron

  Opciones:
    --url      URL que ABRE el worker (rtsp:// recomendado; tambien rtmp://).
    --nombre   Nombre del directo en la app.
    --umbral   Confianza minima (0..1). Por defecto 0.5.
    --fps      Fotogramas por segundo a analizar. Por defecto 2.
    --pipeline detection-ocr (lee ubicaciones) | object-detection (solo marca).
"""
import argparse, asyncio, sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from olo.core.config import get_settings
from olo.core.context import TenantContext, set_request_ids
from olo.db.session import init_engine, tenant_session, dispose_engine
from olo.services.perception import PerceptionService

AUTH_USER = UUID("50beb54b-16a5-4bdc-a030-ac94d8375850")
TENANT    = UUID("d1ae4202-6f85-45d9-a8ed-ca9d122c0257")
WAREHOUSE = UUID("cae0859d-7dd8-4cfb-ae9d-422f00b5dc1a")
MODEL_VER = UUID("b64c6e17-b8d3-4b4c-bbd1-88b95dfe278e")  # Detector de alturas v5


async def main(a) -> int:
    settings = get_settings()
    init_engine(settings)
    set_request_ids("directo-rtmp", "directo-rtmp")
    ctx = TenantContext(auth_user_id=AUTH_USER, tenant_id=TENANT,
                        tenant_wide_access=True, warehouse_id=WAREHOUSE)
    try:
        async with tenant_session(ctx) as s:
            svc = PerceptionService(s, ctx)
            try:
                job = await svc.start_live(
                    warehouse_id=WAREHOUSE,
                    name=a.nombre,
                    stream_url=a.url,
                    pipeline=a.pipeline,
                    model_version_id=MODEL_VER,
                    confidence_threshold=a.umbral,
                    frame_sampling_rate=a.fps,
                    notes="Directo RTMP del dron (preset huecos vacios)",
                )
            except Exception as e:  # noqa: BLE001  mensaje claro para la consola
                print(f"NO se pudo abrir el directo: {type(e).__name__}: {e}")
                return 1
            print(f"DIRECTO ABIERTO: {job['id']}")
            print(f"  nombre : {job['name']}")
            print(f"  stream : {a.url}")
            print(f"  estado : {job['status']}  (el worker con GPU lo recoge)")
            print(f"  umbral {a.umbral} · {a.fps} fps · {a.pipeline}")
            print("\nPara CERRARLO: en la app pon el trabajo en 'cancelled',")
            print("o detén el worker (Ctrl-C) y luego ciérralo en la app.")
    finally:
        await dispose_engine()
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="rtsp://127.0.0.1:8554/dron")
    p.add_argument("--nombre", default="Directo dron -- huecos")
    p.add_argument("--umbral", type=float, default=0.5)
    p.add_argument("--fps", type=float, default=2.0)
    p.add_argument("--pipeline", default="detection-ocr",
                   choices=["detection-ocr", "object-detection", "ocr", "ubicaciones"])
    raise SystemExit(asyncio.run(main(p.parse_args())))
