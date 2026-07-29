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


@asynccontextmanager
async def admin_commit() -> AsyncIterator[asyncpg.Connection]:
    """Transacción privilegiada que SÍ confirma. Solo para la prueba 17.

    La revocación tiene que ser visible para la petición HTTP que va a
    continuación, así que no puede quedarse en una transacción abierta.
    """
    conn = await asyncpg.connect(**_kwargs())
    try:
        yield conn
    finally:
        await conn.close()
