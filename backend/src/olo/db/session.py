"""Motor de base de datos y establecimiento del contexto RLS.

Implementa el **canal B** de DEC-02: el backend se conecta con el rol `olo_app`
—sin BYPASSRLS— y fija el contexto con `set_config()` dentro de una
transacción explícita.

Tres reglas verificadas empíricamente contra la base real. No son estilo:

1. `SET LOCAL` / `set_config(..., is_local => true)` FUERA de una transacción
   explícita es un **no-op silencioso**: el GUC queda vacío, no hay error, y
   RLS deniega todas las filas. La transacción va SIEMPRE primero.
2. Los valores se pasan como **parámetros ligados**, nunca interpolados. La
   interpolación es inyección SQL y además inútil en autocommit.
3. `is_local => true` da al ajuste alcance de transacción, y es lo que hace
   este patrón seguro con el pooler de Supabase en modo *transaction*: se
   verificó que el contexto NO se filtra a la siguiente transacción de la
   misma conexión.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from olo.core.config import Settings, get_settings
from olo.core.logging import get_logger

if TYPE_CHECKING:
    from uuid import UUID

    from olo.core.context import TenantContext

_log = get_logger(__name__)

class DatabaseUnavailableError(RuntimeError):
    """La base no está accesible o el motor no se inicializó. Mensaje accionable."""

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None

# Una sola sentencia fija los cinco ajustes. Menos ida y vuelta que cinco
# llamadas, y garantiza que o entran todos o ninguno.
_SET_CONTEXT = text(
    """
    SELECT set_config('app.auth_user_id',       :auth_user_id,       true),
           set_config('app.tenant_id',          :tenant_id,          true),
           set_config('app.tenant_wide_access', :tenant_wide_access, true),
           set_config('app.request_id',         :request_id,         true),
           set_config('app.correlation_id',     :correlation_id,     true)
    """
)


def init_engine(settings: Settings | None = None, *, null_pool: bool = False) -> AsyncEngine:
    """Inicializa el motor. Solo debe llamarlo el `lifespan` o una fixture.

    `null_pool`: sin pool de conexiones. Necesario en tests de integración,
    porque un pool queda ligado al event loop que lo creó y pytest-asyncio usa
    uno distinto por módulo, lo que produce `Event loop is closed`. En
    producción **nunca**: sin pool, cada consulta abre y cierra una conexión TLS.
    """
    global _engine, _sessionmaker
    if _engine is not None:
        return _engine

    cfg = settings or get_settings()
    pool_kwargs: dict[str, object] = {}
    if null_pool:
        from sqlalchemy.pool import NullPool

        pool_kwargs["poolclass"] = NullPool
    else:
        pool_kwargs.update(
            pool_size=cfg.db_pool_size,
            max_overflow=cfg.db_max_overflow,
            pool_timeout=cfg.db_pool_timeout_s,
            pool_pre_ping=True,
        )
    _engine = create_async_engine(
        str(cfg.database_url),
        **pool_kwargs,  # type: ignore[arg-type]
        echo=False,
        connect_args={
            "server_settings": {
                "application_name": cfg.app_name,
                "statement_timeout": str(cfg.db_statement_timeout_ms),
            },
            # El pooler en modo transaction no soporta sentencias preparadas
            # con nombre: hay que desactivar la caché de asyncpg.
            "statement_cache_size": 0,
        },
    )
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, autoflush=False)
    _log.info("db engine inicializado", extra={"pool_size": cfg.db_pool_size})
    return _engine


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _sessionmaker = None


def _get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """El motor NO se inicializa de forma diferida a propósito.

    Inicializarlo aquí obligaría a releer el entorno y descartaría los ajustes
    con los que se construyó la aplicación. Peor aún: un error de configuración
    aparecería en la primera petición de un usuario, como un 500 opaco, en lugar
    de al arrancar. El `lifespan` es el único responsable de inicializarlo.
    """
    if _sessionmaker is None:
        msg = (
            "El motor de base de datos no está inicializado. Se inicializa en el "
            "lifespan de la aplicación (`init_engine(settings)`). En tests que "
            "necesiten base, llama a `init_engine(settings)` en la fixture."
        )
        raise DatabaseUnavailableError(msg)
    return _sessionmaker


@asynccontextmanager
async def tenant_session(ctx: TenantContext) -> AsyncIterator[AsyncSession]:
    """Sesión con contexto de tenant aplicado. Es el ÚNICO camino de escritura.

    Toda la petición ocurre dentro de una transacción: si algo falla, se
    revierte y el contexto desaparece con ella.
    """
    maker = _get_sessionmaker()
    async with maker() as session, session.begin():
        gucs = ctx.as_gucs()
        await session.execute(
            _SET_CONTEXT,
            {
                "auth_user_id": gucs["app.auth_user_id"],
                "tenant_id": gucs["app.tenant_id"],
                "tenant_wide_access": gucs["app.tenant_wide_access"],
                "request_id": gucs["app.request_id"],
                "correlation_id": gucs["app.correlation_id"],
            },
        )
        yield session


@asynccontextmanager
async def worker_session(tenant_id: UUID, *, request_id: str = "") -> AsyncIterator[AsyncSession]:
    """Sesión para workers y jobs, sin usuario asociado.

    El `tenant_id` se lee de la fila del trabajo que se procesa. Un worker
    NUNCA lo infiere: un job sin tenant_id es un error de programación y debe
    fallar, no adivinar.
    """
    maker = _get_sessionmaker()
    async with maker() as session, session.begin():
        await session.execute(
            _SET_CONTEXT,
            {
                "auth_user_id": "",
                "tenant_id": str(tenant_id),
                "tenant_wide_access": "true",  # el worker opera sobre todo el tenant
                "request_id": request_id,
                "correlation_id": request_id,
            },
        )
        yield session


async def verify_connectivity() -> None:
    """Comprueba la conexión al arrancar y falla con un mensaje claro.

    Se ejecuta en el `lifespan`. Arrancar sin base solo desplazaría el fallo al
    primer usuario que entrara, con un 500 opaco en lugar de un error de
    despliegue evidente.

    El caso más probable en esta fase: el rol `olo_app` se creó **sin
    contraseña** (fail-secure deliberado), así que hasta que se le fije una y se
    ponga en `DATABASE_URL` la autenticación falla.
    """
    engine = init_engine()
    try:
        async with engine.connect() as conn:
            role = (await conn.execute(text("SELECT current_user"))).scalar_one()
            bypass = (
                await conn.execute(
                    text("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")
                )
            ).scalar_one()
    except Exception as exc:  # noqa: BLE001 - se reempaqueta con contexto útil
        msg = (
            "No se pudo conectar a la base de datos.\n"
            "  • Revisa DATABASE_URL: debe usar el rol `olo_app` y el pooler en "
            "modo transaction (puerto 6543).\n"
            "  • `olo_app` se crea SIN contraseña en la migración 0002. Si no se "
            "le ha fijado una, la autenticación falla: fíjala y ponla en "
            "DATABASE_URL.\n"
            "  • NO uses `postgres` ni `service_role`: ambos tienen BYPASSRLS y "
            "anularían todo el aislamiento multi-tenant.\n"
            f"  • Causa original: {type(exc).__name__}"
        )
        raise DatabaseUnavailableError(msg) from exc

    if bypass:
        # Es el fallo de seguridad más grave posible en este arranque: con
        # BYPASSRLS ninguna política se evalúa y el aislamiento desaparece por
        # completo, sin ningún síntoma visible.
        msg = (
            f"El rol de conexión {role!r} tiene BYPASSRLS: RLS no se evaluaría y el "
            "aislamiento multi-tenant quedaría anulado. Usa `olo_app` en DATABASE_URL."
        )
        raise DatabaseUnavailableError(msg)

    _log.info("conectividad verificada", extra={"db_role": role, "bypassrls": False})


@asynccontextmanager
async def unscoped_session() -> AsyncIterator[AsyncSession]:
    """Sesión SIN contexto de tenant. Solo para sondas de salud.

    Con RLS activo y sin contexto, cualquier consulta a una tabla de negocio
    devuelve cero filas. Es deliberado: esta sesión no sirve para leer datos.
    """
    maker = _get_sessionmaker()
    async with maker() as session:
        yield session
