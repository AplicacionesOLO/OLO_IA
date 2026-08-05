"""Fábrica de la aplicación FastAPI.

Sin endpoints de negocio: solo infraestructura. Los routers de dominio se
registran en `_register_routers` a medida que existan.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from olo.api.errors import register_error_handlers
from olo.api.middleware import register_middleware
from olo.api.v1 import (
    admin,
    ai_annotations,
    ai_assets,
    ai_catalog,
    ai_classes,
    ai_datasets,
    ai_models,
    ai_projects,
    ai_training,
    auth,
    inventory,
    olobot,
    perception,
    spatial,
    system,
    warehouses,
)
from olo.api.v1 import platform as platform_api
from olo.core.config import Settings, get_settings
from olo.core.logging import configure_logging, get_logger
from olo.db.session import dispose_engine, init_engine, verify_connectivity

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

_log = get_logger(__name__)


def _verify_timezone_database() -> None:
    """Aborta el arranque si el entorno no tiene base de datos de zonas horarias.

    `zoneinfo` no incluye las zonas: las lee del sistema operativo, y si no las
    encuentra recurre al paquete `tzdata`. Sin ninguno de los dos,
    `available_timezones()` devuelve el conjunto vacío y **toda** cadena de zona
    resulta desconocida. El síntoma es engañoso: la API sigue en pie y responde
    `400 VALIDATION_ERROR · Zona horaria desconocida` a peticiones impecables,
    de modo que el fallo parece del cliente. Se detectó exactamente así, al
    crear un almacén con `America/Costa_Rica`.

    Por eso se comprueba al arrancar y no en cada petición: un entorno sin zonas
    no puede atender el CRUD de almacenes, y es mejor que lo diga al desplegar
    que que lo descubra el primer usuario.
    """
    from zoneinfo import available_timezones

    if not available_timezones():
        msg = (
            "No hay base de datos de zonas horarias disponible: zoneinfo no encontró "
            "ninguna zona. Instala el paquete `tzdata` (pip install tzdata) o, en "
            "contenedores basados en Debian/Alpine, el paquete tzdata del sistema. "
            "Sin ella se rechaza cualquier timezone válido y no se puede crear ni "
            "actualizar almacenes."
        )
        raise RuntimeError(msg)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    init_engine(settings)
    _log.info("arranque", extra=settings.safe_summary())

    _verify_timezone_database()

    # Falla rápido y con mensaje claro si la credencial de `olo_app` no está
    # configurada o no sirve. Arrancar sin base solo desplaza el fallo al
    # primer usuario que entre.
    await verify_connectivity()

    try:
        yield
    finally:
        await dispose_engine()
        _log.info("parada limpia")


def _register_routers(app: FastAPI, settings: Settings) -> None:
    # Sondas en la raíz: los balanceadores y PaaS las esperan sin versionar.
    app.include_router(system.router)

    v1 = APIRouter(prefix=settings.api_v1_prefix)
    v1.include_router(auth.router)
    v1.include_router(warehouses.router)
    v1.include_router(platform_api.router)
    v1.include_router(admin.router)
    v1.include_router(spatial.router)
    v1.include_router(inventory.router)
    v1.include_router(perception.router)
    v1.include_router(olobot.router)
    # Los del módulo de IA. `ai_projects` antes que `ai_models` y `ai_classes`
    # porque sus rutas comparten prefijo y FastAPI resuelve por orden de registro.
    v1.include_router(ai_catalog.router)
    v1.include_router(ai_projects.router)
    v1.include_router(ai_models.router)
    v1.include_router(ai_training.router)
    v1.include_router(ai_classes.router)
    v1.include_router(ai_assets.router)
    v1.include_router(ai_annotations.router)
    v1.include_router(ai_datasets.router)
    app.include_router(v1)


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    configure_logging(level=cfg.log_level, json_output=cfg.log_json)

    app = FastAPI(
        title="OLO_IA API",
        version=cfg.app_version,
        # La documentación interactiva queda fuera de producción.
        docs_url=None if cfg.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if cfg.is_production else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = cfg

    if cfg.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cfg.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=[
                "Authorization", "Content-Type", "X-Warehouse-Id",
                "X-Correlation-Id", "Idempotency-Key", "If-Match",
            ],
            expose_headers=["X-Request-Id", "X-Correlation-Id", "ETag"],
        )

    register_middleware(app)
    register_error_handlers(app)
    _register_routers(app, cfg)
    return app


# Sin `app = create_app()` a nivel de módulo: eso obligaría a tener el entorno
# completo configurado solo para importar `olo.main`, y haría que cualquier
# error de configuración apareciera como fallo de importación en lugar de como
# lo que es. Se arranca con el patrón factory:
#
#     uvicorn --factory olo.main:create_app
