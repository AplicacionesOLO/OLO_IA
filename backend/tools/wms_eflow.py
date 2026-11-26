"""INVENTARIO EN TIEMPO REAL desde la base del WMS (eFlow, SQL Server).

La base del WMS vive en la red interna de la empresa: la nube (Render) no la alcanza.
Por eso la lee el WORKER, que corre en una PC de esa red, y manda la foto a la API
(`POST /v1/inventory/warehouses/{id}/wms-sync`). Para el resto del sistema es un corte
del WMS mas —ocupacion, 3D, reconciliacion— con la diferencia de que tiene minutos y
no dias.

SOLO LECTURA: `ApplicationIntent=ReadOnly`, conexion `readonly`, `READ UNCOMMITTED`
(no bloquea al WMS) y `LOCK_TIMEOUT`. Aqui no hay un solo INSERT/UPDATE.

Mapa de tablas (EFLOW_OLO), medido el 26/11:
  ALMACENAMIENTOSUBICACIONES  posiciones; `MASCARA` = `RCL50-C001-N03-2`, el mismo
                              codigo del QR de ubicacion. `TPUBSI` OCUP/DISP.
  CONTENEDOR                  pallets; `IDCONTENEDOR` = `22O0000186515` (el QR de
                              pallet) e `IDUBICACION` -> la posicion. Activo si
                              `FECHABAJA IS NULL` y `TPCNSI <> 'BAJA'`.
  CONTENEDORARTICULOS         articulo y unidades por pallet.
  ARTICULOSGESTION / COMPANIA descripcion del articulo y nombre del cliente.
~40.500 lineas, 14.900 posiciones ocupadas, 25.000 pallets; la consulta tarda ~0,5 s.

Credenciales: `EPRAC_PROD_CR_HOST/USER/PASS` (entorno o `.env.local`). Sin ellas, o
sin `pyodbc`, la sincronizacion simplemente no se activa.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

RAIZ = Path(__file__).resolve().parents[2]
BASE_WMS = "EFLOW_OLO"
#: Cada cuanto se relee el WMS. Una foto completa cuesta ~0,5 s en el WMS y unos MB de
#: subida; si no cambio nada no se sube.
CADA_S = 180.0

CONSULTA = """
SELECT u.MASCARA AS codigo,
       c.IDCONTENEDOR AS pallet,
       a.IDARTICULO AS sku,
       g.DESCRIPCIONLARGA AS descripcion,
       a.CANTIDADUNIDADES AS qty,
       a.IDPRESENTACION AS uom,
       co.DESCRIPCION AS compania,
       a.LOTE AS lote,
       a.FECHACADUCIDAD AS caduca,
       u.TPUBSI AS situacion_ubic,
       u.TPUBES AS estado_ubic,
       c.TPCNSI AS situacion_pallet,
       c.FECHAUBICACION AS fecha_ubicacion
  FROM dbo.ALMACENAMIENTOSUBICACIONES u
  JOIN dbo.CONTENEDOR c
    ON c.IDALMACEN = u.IDALMACEN AND c.IDUBICACION = u.IDUBICACION
   AND c.FECHABAJA IS NULL AND c.TPCNSI <> 'BAJA'
  LEFT JOIN dbo.CONTENEDORARTICULOS a
    ON a.IDCONTENEDOR = c.IDCONTENEDOR AND a.CANTIDADUNIDADES > 0
  OUTER APPLY (SELECT TOP 1 ag.DESCRIPCIONLARGA FROM dbo.ARTICULOSGESTION ag
               WHERE ag.IDCOMPANIA = a.IDCOMPANIA AND ag.IDARTICULO = a.IDARTICULO) g
  LEFT JOIN dbo.COMPANIA co
    ON co.IDCOMPANIA = COALESCE(a.IDCOMPANIA, c.IDCOMPANIA)
 WHERE u.MASCARA LIKE '%-%-%-%'
"""


def _env_local() -> dict[str, str]:
    vals: dict[str, str] = {}
    env_local = RAIZ / ".env.local"
    if env_local.exists():
        for linea in env_local.read_text(encoding="utf-8").splitlines():
            k, _, v = linea.partition("=")
            vals[k.strip()] = v.strip()
    return vals


def _credenciales() -> dict[str, str] | None:
    vals = _env_local()
    claves = ("EPRAC_PROD_CR_HOST", "EPRAC_PROD_CR_USER", "EPRAC_PROD_CR_PASS")
    cred = {k: os.environ.get(k) or vals.get(k, "") for k in claves}
    return cred if all(cred.values()) else None


def _credenciales_extra(clave: str) -> str | None:
    """Otra variable del entorno o de `.env.local` (p. ej. el almacen)."""
    return os.environ.get(clave) or _env_local().get(clave) or None


def disponible() -> bool:
    """Si esta PC puede leer el WMS: credenciales y driver."""
    try:
        import pyodbc  # noqa: F401
    except ImportError:
        return False
    return _credenciales() is not None


def _texto(v: Any, largo: int) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s[:largo] or None


def leer_inventario() -> list[dict[str, Any]]:
    """El inventario completo, en las mismas lineas que el reporte xlsx del WMS."""
    import pyodbc

    cred = _credenciales()
    if cred is None:
        raise RuntimeError("faltan EPRAC_PROD_CR_HOST/USER/PASS")
    cn = pyodbc.connect(
        "DRIVER={ODBC Driver 18 for SQL Server};"
        f"SERVER={cred['EPRAC_PROD_CR_HOST']};DATABASE={BASE_WMS};"
        f"UID={cred['EPRAC_PROD_CR_USER']};PWD={cred['EPRAC_PROD_CR_PASS']};"
        "TrustServerCertificate=yes;Encrypt=yes;ApplicationIntent=ReadOnly;"
        "Connection Timeout=15",
        readonly=True,
        autocommit=True,
        timeout=60,
    )
    try:
        cur = cn.cursor()
        cur.execute("SET LOCK_TIMEOUT 5000; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED")
        cur.execute(CONSULTA)
        filas = cur.fetchall()
    finally:
        cn.close()

    lineas = []
    for f in filas:
        caduca = f.caduca.date() if isinstance(f.caduca, datetime) else f.caduca
        lineas.append(
            {
                "codigo": str(f.codigo).strip().upper(),
                "pallet": _texto(f.pallet, 80),
                "sku": _texto(f.sku, 80),
                "descripcion": _texto(f.descripcion, 240),
                "qty": float(f.qty) if f.qty is not None else None,
                "uom": _texto(f.uom, 12),
                "compania": _texto(f.compania, 200),
                "lote": _texto(f.lote, 60),
                "caduca": caduca.isoformat() if isinstance(caduca, date) else None,
                "raw": {
                    k: v
                    for k, v in (
                        ("situacion_ubicacion", _texto(f.situacion_ubic, 12)),
                        ("estado_ubicacion", _texto(f.estado_ubic, 12)),
                        ("situacion_pallet", _texto(f.situacion_pallet, 12)),
                        ("fecha_ubicacion",
                         f.fecha_ubicacion.isoformat() if f.fecha_ubicacion else None),
                    )
                    if v
                },
            }
        )
    return lineas


class SincronizadorWms:
    """Relee el WMS cada `CADA_S` en su propio hilo y manda la foto si cambio.

    `ahora()` fuerza una lectura inmediata (al abrir un directo, para reconciliar contra
    lo que el WMS dice EN ESE MOMENTO). Un fallo es un aviso en el log, nunca tumba el
    worker: sin WMS el analisis sigue, solo que contra el ultimo corte que haya.
    """

    def __init__(self, enviar: Callable[[list[dict[str, Any]]], dict[str, Any]]) -> None:
        self._enviar = enviar
        self._despertar = threading.Event()
        self._ultimo_sha: str | None = None
        self._hilo = threading.Thread(target=self._bucle, name="wms-sync", daemon=True)
        self._hilo.start()

    def ahora(self) -> None:
        self._despertar.set()

    def _una_vez(self) -> None:
        t = time.monotonic()
        lineas = leer_inventario()
        sha = hashlib.sha256(
            json.dumps(lineas, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        if sha == self._ultimo_sha:
            print(f"WMS sin cambios ({len(lineas)} lineas)", flush=True)
            return
        r = self._enviar(lineas)
        self._ultimo_sha = sha
        print(
            f"WMS sincronizado: {r.get('status')} · {len(lineas)} lineas · "
            f"{r.get('locations_occupied') or '-'} ubicaciones · "
            f"{r.get('pallets') or '-'} pallets · {time.monotonic() - t:.1f} s",
            flush=True,
        )

    def _bucle(self) -> None:
        while True:
            try:
                self._una_vez()
            except Exception as exc:
                print(f"aviso: WMS sin sincronizar ({type(exc).__name__}: {exc})"[:400],
                      flush=True)
            self._despertar.wait(CADA_S)
            self._despertar.clear()
