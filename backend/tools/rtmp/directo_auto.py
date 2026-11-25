"""Hook de MediaMTX: el dron CONECTA -> se abre el directo solo; se DESCONECTA -> se cierra.

Lo llama MediaMTX (ver `directo.yml`), no una persona:

  runOnAvailable   -> directo_auto.py conectar
      1. abre el trabajo en vivo (`start_live`, RESERVADO: nunca pasa por la cola) sobre
         rtsp://127.0.0.1:8554/dron con el preset "huecos vacios", y lanza un worker
         dedicado `inferir.py --job <id>` en esta maquina;
      2. late en Flota con `current_job_id` -> la tarjeta del dron sale "En vivo" y
         enlaza a la inspeccion;
      3. sigue latiendo hasta que MediaMTX lo mata (el dron dejo de emitir).

  runOnUnavailable -> directo_auto.py desconectar
      ultimo latido SIN trabajo (el dron queda "connected" y luego "offline"), y si el
      trabajo nunca lo cogio ningun worker (sigue `queued`) se cancela, para que la
      proxima conexion no choque con "ya hay un directo abierto sobre esa URL". Si un
      worker lo estaba analizando, lo cierra el propio worker al perder el stream (y
      al cerrarlo el backend resuelve las ubicaciones).

Todo queda en `logs/directo.log` (MediaMTX no muestra la salida de sus hooks).
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from uuid import UUID

AQUI = Path(__file__).resolve().parent
BACKEND = AQUI.parents[1]
#  La configuracion se lee de `.env.local` con rutas RELATIVAS al directorio actual, y
#  MediaMTX lanza el hook desde el suyo. Sin esto, el hook no encontraria la base.
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND / "src"))

from olo.core.config import get_settings  # noqa: E402
from olo.core.context import TenantContext, set_request_ids  # noqa: E402
from olo.db.session import dispose_engine, init_engine, tenant_session  # noqa: E402
from olo.services.fleet import FleetService  # noqa: E402
from olo.services.perception import PerceptionService  # noqa: E402

AUTH_USER = UUID("50beb54b-16a5-4bdc-a030-ac94d8375850")
TENANT = UUID("d1ae4202-6f85-45d9-a8ed-ca9d122c0257")
WAREHOUSE = UUID("cae0859d-7dd8-4cfb-ae9d-422f00b5dc1a")
MODEL_VER = UUID("b64c6e17-b8d3-4b4c-bbd1-88b95dfe278e")  # Detector de alturas v5

STREAM_WORKER = os.environ.get("OLO_DIRECTO_URL", "rtsp://127.0.0.1:8554/dron")
#  `ubicaciones` lee con OCR solo las etiquetas de ubicacion (mas rapido). Si la base aun
#  no tiene la migracion 0119, se cae a `detection-ocr`, que hace lo mismo y algo mas.
PIPELINES = ("ubicaciones", "detection-ocr")
UMBRAL = float(os.environ.get("OLO_DIRECTO_UMBRAL", "0.5"))
FPS = float(os.environ.get("OLO_DIRECTO_FPS", "2"))

DRON_KEY = "dron-dji-mini4pro"
DRON_NOMBRE = "DJI Mini 4 Pro"
DRON_MODELO = "DJI RC 2 (RC331)"
LATIDO_S = 20.0

#  El worker usa el entorno con torch+CUDA, rfdetr y easyocr, no el del backend.
PY_WORKER = BACKEND.parent / ".venv-train" / "Scripts" / "python.exe"
API_LOCAL = os.environ.get("OLO_API", "http://127.0.0.1:8000")

LOGS = AQUI / "logs"
ESTADO = LOGS / "directo_actual.json"


def log(msg: str) -> None:
    LOGS.mkdir(exist_ok=True)
    linea = f"{datetime.now():%Y-%m-%d %H:%M:%S} [{os.getpid()}] {msg}"
    print(linea, flush=True)
    with (LOGS / "directo.log").open("a", encoding="utf-8") as f:
        f.write(linea + "\n")


def _ctx() -> TenantContext:
    return TenantContext(
        auth_user_id=AUTH_USER,
        tenant_id=TENANT,
        tenant_wide_access=True,
        warehouse_id=WAREHOUSE,
    )


async def _latir(job_id: UUID | None) -> None:
    async with tenant_session(_ctx()) as s:
        await FleetService(s, _ctx()).heartbeat(
            device_key=DRON_KEY,
            kind="drone",
            name=DRON_NOMBRE,
            warehouse_id=WAREHOUSE,
            app_version="directo-auto",
            device_model=DRON_MODELO,
            current_job_id=job_id,
        )


async def _abrir_directo() -> dict:
    """Abre el trabajo. Reintenta ~90 s si aun hay uno abierto sobre la URL: pasa
    cuando el dron se reconecta mientras el worker todavia cierra el anterior."""
    nombre = f"Directo dron {datetime.now():%d/%m %H:%M}"
    limite = time.monotonic() + 90
    ultimo_error: Exception | None = None
    while time.monotonic() < limite:
        for pipeline in PIPELINES:
            try:
                async with tenant_session(_ctx()) as s:
                    job = await PerceptionService(s, _ctx()).start_live(
                        warehouse_id=WAREHOUSE,
                        name=nombre,
                        stream_url=STREAM_WORKER,
                        pipeline=pipeline,
                        model_version_id=MODEL_VER,
                        confidence_threshold=UMBRAL,
                        frame_sampling_rate=FPS,
                        notes="Abierto automaticamente al conectar el dron (huecos vacios)",
                        reservado=True,
                    )
                job["_pipeline"] = pipeline
                return job
            except Exception as e:  # el siguiente pipeline o el reintento lo resuelven
                ultimo_error = e
                texto = str(e)
                if "Ya hay un directo abierto" in texto:
                    log("hay un directo anterior cerrandose; reintento en 5 s")
                    break
                log(f"pipeline {pipeline} no disponible: {type(e).__name__}: {texto[:200]}")
        await asyncio.sleep(5)
    raise RuntimeError(f"no se pudo abrir el directo: {ultimo_error}")


def _lanzar_worker(job_id: UUID) -> subprocess.Popen:
    """El worker DEDICADO a este directo, en esta maquina (la que tiene el stream).

    `--job` y no la cola: el directo se crea `reservado` (nunca `queued`), asi que ningun
    otro worker lo ve. Proceso independiente: sigue analizando aunque MediaMTX mate este
    hook, y se cierra solo cuando el stream deja de llegar (con 20 s de reconexion).
    """
    env = {**os.environ, "PYTHONPATH": str(BACKEND / "src")}
    return subprocess.Popen(  # noqa: S603  argumentos fijos, sin entrada externa
        [
            str(PY_WORKER), "-u", str(BACKEND / "tools" / "inferir.py"),
            "--api", API_LOCAL, "--job", str(job_id),
            "--log", str(LOGS / "worker_directo.log"),
        ],
        cwd=str(BACKEND),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        #  Fuera del grupo del hook: que MediaMTX lo mate no debe arrastrar al worker.
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        | getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


async def conectar() -> int:
    log("DRON CONECTADO: abriendo directo")
    job = await _abrir_directo()
    job_id = UUID(str(job["id"]))
    ESTADO.write_text(json.dumps({"job_id": str(job_id)}), encoding="utf-8")
    log(
        f"directo {job_id} abierto ({job['_pipeline']}, umbral {UMBRAL}, {FPS} fps) · "
        f"worker disponible: {job.get('worker_available')}"
    )
    worker = _lanzar_worker(job_id)
    log(f"worker dedicado lanzado (pid {worker.pid}) · salida en logs/worker_directo.log")
    #  Hasta que MediaMTX nos mate: el dron sigue emitiendo.
    while True:
        try:
            await _latir(job_id)
        except Exception as e:
            log(f"latido fallido: {type(e).__name__}: {e}")
        await asyncio.sleep(LATIDO_S)


async def desconectar() -> int:
    log("DRON DESCONECTADO")
    try:
        await _latir(None)
    except Exception as e:
        log(f"latido final fallido: {type(e).__name__}: {e}")
    if not ESTADO.exists():
        return 0
    job_id = UUID(json.loads(ESTADO.read_text(encoding="utf-8"))["job_id"])
    ESTADO.unlink(missing_ok=True)
    #  Si un worker lo esta analizando, lo cierra el. Solo se cancela lo que nadie cogio.
    async with tenant_session(_ctx()) as s:
        svc = PerceptionService(s, _ctx())
        job = await svc.get_job(job_id)
        if job["status"] == "queued":
            await svc.change_status(
                job_id=job_id,
                to_status="cancelled",
                reason="El dron se desconecto antes de que un worker abriera el directo",
            )
            log(f"directo {job_id} cancelado (ningun worker lo llego a abrir)")
        else:
            log(f"directo {job_id} en '{job['status']}': lo cierra el worker")
    return 0


async def main(accion: str) -> int:
    init_engine(get_settings())
    set_request_ids("directo-auto", "directo-auto")
    try:
        return await (conectar() if accion == "conectar" else desconectar())
    finally:
        await dispose_engine()


if __name__ == "__main__":
    accion = sys.argv[1] if len(sys.argv) > 1 else ""
    if accion not in ("conectar", "desconectar"):
        print("uso: directo_auto.py conectar|desconectar")
        raise SystemExit(2)
    try:
        raise SystemExit(asyncio.run(main(accion)))
    except (KeyboardInterrupt, asyncio.CancelledError):
        raise SystemExit(0) from None
    except Exception:
        log("ERROR:\n" + traceback.format_exc())
        raise SystemExit(1) from None
