"""Fixtures compartidas.

Los tests unitarios NO tocan la base de datos: el motor se inicializa de forma
diferida en `lifespan`, así que `create_app` no abre conexiones. Los tests que
sí la necesitan llevan la marca `integration`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import TYPE_CHECKING

import pytest
from httpx import ASGITransport, AsyncClient

from olo.core.config import Environment, Settings

if TYPE_CHECKING:
    from fastapi import FastAPI


@pytest.fixture
def settings() -> Settings:
    """Ajustes de prueba. Valores ficticios: nada real, nada secreto."""
    return Settings(
        environment=Environment.LOCAL,
        supabase_url="https://test.supabase.co",
        database_url="postgresql+asyncpg://olo_app:x@127.0.0.1:5432/postgres",  # noqa: S106
        jwt_algorithm="hs256",
        jwt_secret="test-secret-not-real",  # noqa: S106
        log_json=False,
        log_level="WARNING",
    )


@pytest.fixture
def app(settings: Settings) -> Iterator[FastAPI]:
    from olo.main import create_app

    yield create_app(settings)


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """Cliente sin `lifespan`, para no abrir el pool en tests unitarios."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
