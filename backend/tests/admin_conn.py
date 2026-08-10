"""Conexión privilegiada (`postgres`) para las pruebas que la necesitan.

DELIBERADAMENTE FUERA DEL PAQUETE `olo`. La aplicación nunca debe poder abrir una
conexión que salte RLS; `olo_app` es `NOBYPASSRLS` por diseño (migración 0002).
Esto es infraestructura de pruebas y no se distribuye.

Hace falta para exactamente tres cosas que `olo_app` no puede hacer:

  · leer `core.tenants` y `core.users` sin contexto de tenant, para PREPARAR los
    contextos con los que después se prueba;
  · `ALTER TABLE ... DISABLE TRIGGER`, que exige ser propietario de la tabla;
  · demostrar que los triggers de inmutabilidad abortan de verdad. Como `olo_app`
    no hay política de UPDATE, así que el UPDATE se queda en cero filas EN
    SILENCIO y el trigger nunca llega a dispararse. Las dos capas se prueban por
    separado porque protegen de cosas distintas.
"""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

import asyncpg
import pytest

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

_REPO = Path(__file__).resolve().parents[2]
_ENV_LOCAL = _REPO / ".env.local"
_ENV_SECRET = _REPO / "docs" / ".envlocal"


def _read_key(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == key:
            return v.strip().strip('"').strip("'")
    return None


def _kwargs() -> dict[str, Any]:
    url = _read_key(_ENV_LOCAL, "DATABASE_URL")
    password = _read_key(_ENV_SECRET, "passwordBD_OLO_IA")
    if not url or not password:
        pytest.skip("sin credencial privilegiada: se omiten las pruebas del motor")

    m = re.match(
        r"^postgresql(?:\+\w+)?://(?P<user>[^:/?#]+):[^@]*@(?P<host>[^:/?#]+)"
        r"(?::(?P<port>\d+))?/(?P<db>[^?#]+)",
        url,
    )
    if not m:
        pytest.skip("DATABASE_URL no tiene la forma esperada")

    host = m.group("host")
    existing = m.group("user")
    user = (
        f"postgres.{existing.split('.', 1)[1]}"
        if "pooler.supabase.com" in host and "." in existing
        else "postgres"
    )
    return {
        "host": host,
        "port": int(m.group("port") or 5432),
        "database": m.group("db"),
        "user": user,
        "password": password,
        "statement_cache_size": 0,
    }


@asynccontextmanager
async def admin_tx() -> AsyncIterator[asyncpg.Connection]:
    """Transacción privilegiada que SIEMPRE se deshace.

    Se deshace incluso en el camino feliz: estas pruebas crean proyectos, clases y
    assets de usar y tirar, y dejarlos sembrados contaminaría las siguientes y la
    base de desarrollo. Lo que se comprueba es el comportamiento del motor, no la
    persistencia.
    """
    conn = await asyncpg.connect(**_kwargs())
    tx = conn.transaction()
    await tx.start()
    try:
        yield conn
    finally:
        await tx.rollback()
        await conn.close()


class _Marcada:
    """Envuelve la conexión para que cada sentencia vaya en su propia transacción
    con `app.is_test` puesto.

    ── POR QUE HACE FALTA ────────────────────────────────────────────────────

    Estas escrituras CONFIRMAN, así que desde la migración 0085 quedan en el registro
    de auditoría para siempre. Medido en una pasada completa: **24 entradas** —20
    `DELETE` de `ai.projects` y 4 de `ai.models`— que son limpieza de artefactos de
    prueba y aparecían mezcladas con la operación real.

    ── Y POR QUE ASI Y NO DE OTRA FORMA ──────────────────────────────────────

    Se probaron las dos alternativas y las dos fallaron, medidas:

      `SET` de sesión          fija la conexión al servidor a través de PgBouncer en
                               modo transacción y agotó el pool: la suite se colgó
                               17 minutos con 17 s de CPU.
      `server_settings` en la  el pooler ACEPTA la conexión y descarta el GUC en
      conexión                 silencio: `current_setting` devuelve NULL.

    Una transacción por sentencia mantiene el comportamiento —cada una sigue
    confirmando al momento, que es para lo que existe `admin_commit`— sin dejar estado
    de sesión que el pooler pueda fijar.
    """

    def __init__(self, conn: asyncpg.Connection) -> None:
        self._conn = conn

    async def _con_marca(self, metodo: str, sql: str, *args: Any) -> Any:
        async with self._conn.transaction():
            await self._conn.execute("SET LOCAL app.is_test = 'on'")
            return await getattr(self._conn, metodo)(sql, *args)

    async def execute(self, sql: str, *args: Any) -> Any:
        return await self._con_marca("execute", sql, *args)

    async def fetchval(self, sql: str, *args: Any) -> Any:
        return await self._con_marca("fetchval", sql, *args)

    async def fetch(self, sql: str, *args: Any) -> Any:
        return await self._con_marca("fetch", sql, *args)

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        return await self._con_marca("fetchrow", sql, *args)

    def __getattr__(self, nombre: str) -> Any:
        """Lo que no se envuelve pasa tal cual.

        Deliberadamente permisivo: si mañana una prueba usa `copy_records_to_table` o
        `executemany`, funcionará —solo que sin marca— en vez de romperse. Perder la
        marca de una entrada es un ruido; romper la suite por un método no previsto
        es peor.
        """
        return getattr(self._conn, nombre)


@asynccontextmanager
async def admin_commit() -> AsyncIterator[asyncpg.Connection]:
    """Transacción privilegiada que SÍ confirma. Solo para la prueba 17.

    La revocación tiene que ser visible para la petición HTTP que va a
    continuación, así que no puede quedarse en una transacción abierta.

    Sus escrituras van marcadas como de prueba: confirman, así que quedan en el
    registro de auditoría para siempre. Ver `_Marcada`.
    """
    conn = await asyncpg.connect(**_kwargs())
    try:
        yield _Marcada(conn)  # type: ignore[misc]
    finally:
        await conn.close()
