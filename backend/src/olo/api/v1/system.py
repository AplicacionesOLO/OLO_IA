"""Endpoints de sistema. Sin autenticación, sin lógica de negocio.

Distinción entre las dos sondas, que no es cosmética:

  • /health  — liveness. ¿Está el proceso vivo? NO toca la base de datos: si lo
               hiciera, una caída de la base provocaría el reinicio en bucle de
               un proceso que en realidad está sano.
  • /ready   — readiness. ¿Puede atender tráfico? Sí comprueba la base, porque
               sin ella no puede servir nada útil.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text

from olo.api.deps import get_app_settings
from olo.core.config import Settings
from olo.core.logging import get_logger
from olo.db.session import unscoped_session

router = APIRouter(tags=["system"])
_log = get_logger(__name__)

SettingsDep = Annotated[Settings, Depends(get_app_settings)]


@router.get("/health", status_code=status.HTTP_200_OK, summary="Liveness")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Readiness")
async def ready(response: Response, settings: SettingsDep) -> dict[str, Any]:
    checks: dict[str, str] = {}
    ok = True

    try:
        async with unscoped_session() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = "unavailable"
        ok = False
        _log.warning("readiness: base no disponible", extra={"exc_type": type(exc).__name__})

    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if ok else "not_ready", "checks": checks}


@router.get("/version", summary="Version del servicio")
async def version(settings: SettingsDep) -> dict[str, str]:
    """Versión y entorno. No expone configuración sensible."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "environment": str(settings.environment),
    }
