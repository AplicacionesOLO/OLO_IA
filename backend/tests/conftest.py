"""Fixtures compartidas.

Los tests unitarios NO tocan la base de datos: el motor se inicializa de forma
diferida en `lifespan`, así que `create_app` no abre conexiones. Los tests que
sí la necesitan llevan la marca `integration`.

═══════════════════════════════════════════════════════════════════════════════
TODA ESCRITURA DE LA SUITE QUEDA MARCADA COMO DE PRUEBA

La suite corre contra la base de PRODUCCIÓN —hay una sola instancia de Supabase— y
desde la migración 0085 sus escrituras quedan en el registro de auditoría para
siempre. Medido: **152 entradas por ejecución completa**, con cosas como «María Rojas
borró una colocación de racks», que es un usuario de prueba. El ruido de los tests
superaba al de la operación en el registro que alguien va a leer para auditar.

Así que aquí se engancha un oyente al evento `begin` de SQLAlchemy que pone
`app.is_test` en CADA transacción de CADA motor del proceso. El trigger de auditoría
lo lee y marca la entrada (0086).

── POR QUE AQUI Y NO ENVOLVIENDO `tenant_session` ────────────────────────────

Se intentó primero, y falla por donde importa: las pruebas que conducen la aplicación
por HTTP —`httpx` sobre la ASGI— usan el `tenant_session` de VERDAD, que la suite no
toca. Medido: de 152 entradas por ejecución, ese enfoque marcaba 24. El 84 % seguía
entrando como escritura de una persona.

El evento `begin` cubre las tres rutas —la suite, la aplicación servida en proceso y
las conexiones privilegiadas— porque las tres abren transacciones en este proceso.

── Y SIN TOCAR EL CODIGO DE PRODUCCION ───────────────────────────────────────

`tenant_session` no sabe que existen las pruebas, y es deliberado: si la aplicación
tuviera una forma cómoda de marcar sus propias escrituras, antes o después alguien la
usaría para bajar el ruido de algo que no es una prueba.

Y la marca NO esconde: la entrada se escribe completa, nunca se borra —`olo_app` sigue
sin poder hacer DELETE— y la pantalla cuenta cuántas deja fuera.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.engine import Engine

from olo.core.config import Environment, Settings

#: Poner a `0` desactiva la marca, para poder comparar el comportamiento de la suite con
#: y sin ella. Por defecto activa: la ausencia de la variable no cambia nada.
_MARCAR_PRUEBAS = os.environ.get("OLO_MARCAR_PRUEBAS", "1") != "0"


@event.listens_for(Engine, "begin")
def _marcar_como_prueba(conn: object) -> None:
    """Marca la transacción recién abierta como de la suite de tests.

    Se registra sobre la clase `Engine`, no sobre una instancia: cada módulo de
    pruebas llama a `init_engine()` por su cuenta y no hay un punto único donde
    engancharse después. Sobre la clase, vale para todos y sin depender del orden.

    `SET LOCAL` dentro de la transacción que acaba de empezar: no adquiere conexión
    nueva ni deja estado de sesión. Un `SET` de sesión sí lo dejaría, y a través de
    PgBouncer en modo transacción fija la conexión al servidor — eso colgó la suite
    entera durante 17 minutos en un intento anterior.
    """
    if not _MARCAR_PRUEBAS:
        return
    conn.exec_driver_sql("SET LOCAL app.is_test = 'on'")  # type: ignore[attr-defined]

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

    from fastapi import FastAPI


@pytest.fixture
def settings() -> Settings:
    """Ajustes de prueba. Valores ficticios: nada real, nada secreto."""
    return Settings(
        environment=Environment.LOCAL,
        supabase_url="https://test.supabase.co",
        database_url="postgresql+asyncpg://olo_app:x@127.0.0.1:5432/postgres",
        jwt_algorithm="hs256",
        jwt_secret="test-secret-not-real",
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
