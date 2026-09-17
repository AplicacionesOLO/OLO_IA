"""Vigilante de procesos huerfanos: cierra lo que quedo `running` sin nadie vivo.

═══════════════════════════════════════════════════════════════════════════════
EL PROBLEMA QUE ESTO RESUELVE

Si `inferir.py` o `entrenar.py` mueren a mitad de un trabajo —se cae la maquina, se
corta la luz, un `kill -9`— la fila se queda en `running` PARA SIEMPRE. Nada la
mueve de ahi sola: el propio proceso era el unico que iba a cerrarla. La pantalla
sigue diciendo «analizando» de algo que ya no existe, y sin este guion la unica
forma de notar el problema es que alguien lo note el.

═══════════════════════════════════════════════════════════════════════════════
COMO DECIDE QUE ESTA MUERTO, Y POR QUE ESO BASTA

No hace falta ninguna tabla ni endpoint nuevo: `GET /v1/perception/workers` ya dice
si el latido de una maquina tiene mas de 90 s (`core.worker_esta_vivo()`, 0075). Si
el trabajo dice `runner = "esta-maquina"` y esa maquina no esta viva, el trabajo no
puede estar corriendo de verdad —el proceso que lo tendria que estar moviendo es el
mismo que deberia estar latiendo—.

El margen de gracia (`--margen`, 120 s por omision) es aparte del de 90 s del
latido: cubre el hueco entre que un trabajo arranca y que su primer latido llega,
para no cerrar algo que en realidad acaba de empezar.

═══════════════════════════════════════════════════════════════════════════════
POR QUE CIERRA CON LAS MISMAS HERRAMIENTAS QUE UNA PERSONA, NO CON SQL DIRECTO

Cancela via `POST .../cancel` y falla via `POST .../status`, exactamente los
mismos extremos que usaria alguien desde la pantalla. Así pasa por las mismas
comprobaciones —motivo obligatorio, transicion valida— y dispara la MISMA
notificacion (0104) que un cierre humano: quien encolo el trabajo se entera igual,
diga lo que diga el motivo.

═══════════════════════════════════════════════════════════════════════════════
POR QUE NO HACE FALTA "--bucle" COMO LOS OTROS DOS

`inferir.py`/`entrenar.py` tienen que quedarse RESIDENTES: en cuanto ven trabajo
encolado, lo cogen y ocupan la GPU un rato largo. Este guion hace un barrido corto
y se va; repetirlo es trabajo del PROPIO PLANIFICADOR DE WINDOWS —un disparador con
repeticion cada N minutos—, no de un bucle de Python que tendria que quedarse
vivo sin hacer nada la mayor parte del tiempo.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from sesion import Sesion

REPO = Path(__file__).resolve().parents[2]
SECRETS = REPO / ".secrets"

#: Ademas de los 90 s del latido (0075): cubre el hueco entre que un trabajo
#: arranca y que llega su primer latido, para no cerrar algo recien empezado.
MARGEN_S_POR_OMISION = 120


class Api:
    def __init__(self, base: str, sesion: Sesion) -> None:
        if not base.startswith(("http://", "https://")):
            msg = f"--api tiene que ser http o https, no {base.split(':', 1)[0]!r}"
            raise ValueError(msg)
        self._base = base.rstrip("/")
        self._sesion = sesion

    def _pedir(self, metodo: str, ruta: str, cuerpo: Any = None) -> Any:
        for intento in (1, 2):
            token = self._sesion.vigente() if intento == 1 else self._sesion.token
            generacion = self._sesion.generacion
            req = urllib.request.Request(
                f"{self._base}{ruta}",
                method=metodo,
                data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req) as r:
                    crudo = r.read()
                    return json.loads(crudo)["data"] if crudo else None
            except urllib.error.HTTPError as e:
                if e.code == 401 and intento == 1:
                    e.read()
                    self._sesion.renovar(generacion)
                    continue
                detalle = e.read().decode("utf-8", "replace")[:600]
                msg = f"HTTP {e.code} en {metodo} {ruta}: {detalle}"
                raise RuntimeError(msg) from e
        msg = f"no se pudo completar {metodo} {ruta} ni renovando la sesion"
        raise RuntimeError(msg)

    def get(self, ruta: str) -> Any:
        return self._pedir("GET", ruta)

    def post(self, ruta: str, cuerpo: Any = None) -> Any:
        return self._pedir("POST", ruta, cuerpo)


def _vivos_por_nombre(api: Api, kind: str) -> dict[str, bool]:
    """`{nombre_de_maquina: esta_viva}` para un tipo de worker."""
    datos = api.get(f"/v1/perception/workers?kind={kind}")
    return {w["name"]: bool(w["alive"]) for w in datos["workers"]}


def _hace_mas_de(iso: str | None, segundos: int) -> bool:
    if not iso:
        return False
    from datetime import UTC, datetime

    inicio = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (datetime.now(UTC) - inicio).total_seconds() > segundos


def _revisar_entrenamientos(api: Api, margen: int, seco: bool) -> int:
    cerrados = 0
    datos = api.get("/v1/ai/training-runs?status=running&limit=100")
    vivos = _vivos_por_nombre(api, "training")
    for run in datos["runs"]:
        runner = run.get("runner")
        if not runner or vivos.get(runner, False):
            continue
        if not _hace_mas_de(run["started_at"], margen):
            continue
        motivo = (
            f"cerrado automaticamente por el vigilante: el runner «{runner}» no tiene "
            f"latido reciente (mas de 90 s) y la ejecucion lleva mas de {margen} s "
            "corriendo. El proceso que la estaba entrenando ya no responde."
        )
        print(f"  entrenamiento {run['id']} · runner «{runner}» muerto → cancelando")
        if not seco:
            api.post(f"/v1/ai/training-runs/{run['id']}/cancel", {"reason": motivo})
        cerrados += 1
    return cerrados


def _revisar_percepcion(api: Api, margen: int, seco: bool) -> int:
    cerrados = 0
    datos = api.get("/v1/perception/jobs?status=running&limit=100")
    vivos = _vivos_por_nombre(api, "inference")
    for job in datos["jobs"]:
        # `perception.inference_jobs` no guarda el nombre del worker en la fila del
        # trabajo —a diferencia de `training_runs.runner`—, asi que la unica señal
        # disponible es si HAY ALGUN worker de inferencia vivo. Con ninguno vivo, un
        # trabajo `running` no lo puede estar moviendo nadie.
        if any(vivos.values()):
            continue
        if not _hace_mas_de(job.get("started_at"), margen):
            continue
        motivo = (
            "cerrado automaticamente por el vigilante: no hay ningun worker de "
            f"inferencia con latido reciente y el trabajo lleva mas de {margen} s "
            "corriendo. El proceso que lo estaba analizando ya no responde."
        )
        print(f"  percepcion {job['id']} · sin worker de inferencia vivo → marcando fallido")
        if not seco:
            api.post(
                f"/v1/perception/jobs/{job['id']}/status",
                {"to_status": "failed", "reason": motivo},
            )
        cerrados += 1
    return cerrados


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Cierra entrenamientos y trabajos de percepcion huerfanos"
    )
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="arojas@ologistics.com")
    ap.add_argument(
        "--margen", type=int, default=MARGEN_S_POR_OMISION,
        help="segundos de gracia ademas de los 90 s del latido, antes de cerrar algo",
    )
    ap.add_argument(
        "--seco", action="store_true",
        help="dice que cerraria, sin cerrar nada de verdad",
    )
    args = ap.parse_args()

    # Sin consola adjunta —la tarea programada lo lanza con su salida redirigida a
    # un archivo—, Python en Windows cae al codepage del sistema (cp1252 aqui) en
    # vez de UTF-8, y revienta con `UnicodeEncodeError` en el primer «→». Medido al
    # instalar `vigilante_servicio.ps1`. El `isinstance` es para mypy: `sys.stdout`
    # esta tipado como `TextIO`, que no declara `reconfigure` aunque `TextIOWrapper`
    # —lo que de verdad es— si lo tiene.
    for flujo in (sys.stdout, sys.stderr):
        if isinstance(flujo, io.TextIOWrapper):
            flujo.reconfigure(encoding="utf-8")

    pw_path = SECRETS / "adminpw.txt"
    if not pw_path.exists():
        print(f"FALTA la contraseña en {pw_path}")
        return 2

    sesion = Sesion(args.api, args.email, pw_path.read_text(encoding="utf-8").strip())
    api = Api(args.api, sesion)

    print("→ revisando entrenamientos `running`...")
    n1 = _revisar_entrenamientos(api, args.margen, args.seco)
    print("→ revisando percepcion `running`...")
    n2 = _revisar_percepcion(api, args.margen, args.seco)

    total = n1 + n2
    if total == 0:
        print("nada huerfano: todo lo que esta `running` tiene quien lo mueva")
    else:
        verbo = "se cerrarian" if args.seco else "se cerraron"
        print(f"\n{total} proceso(s) huerfano(s) {verbo} ({n1} entrenamiento(s), {n2} percepcion)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
