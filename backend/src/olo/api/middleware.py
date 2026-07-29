"""Middleware de correlación, cabeceras de seguridad y log de acceso."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from olo.core.context import set_request_ids
from olo.core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.requests import Request
    from starlette.responses import Response

_log = get_logger("olo.access")


class CorrelationMiddleware(BaseHTTPMiddleware):
    """Genera `request_id` y resuelve `correlation_id`.

    `request_id` se genera SIEMPRE aquí y nunca se toma del cliente: si se
    aceptara, un cliente podría colisionar identificadores y ensuciar la
    correlación de otro. `correlation_id` sí se acepta del cliente, porque su
    propósito es precisamente encadenar operaciones a través de servicios.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = str(uuid4())
        correlation_id = request.headers.get("X-Correlation-Id") or request_id
        set_request_ids(request_id, correlation_id)

        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000

        response.headers["X-Request-Id"] = request_id
        response.headers["X-Correlation-Id"] = correlation_id

        _log.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round(elapsed_ms, 2),
            },
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Cabeceras de seguridad en toda respuesta.

    No incluye HSTS: la termina el proveedor de despliegue, y emitirla desde la
    aplicación sobre una conexión HTTP local sería incorrecto.
    """

    _HEADERS = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cache-Control": "no-store",
    }

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for key, value in self._HEADERS.items():
            response.headers.setdefault(key, value)
        return response


def register_middleware(app: ASGIApp) -> None:
    # Orden inverso al de ejecución: el último añadido es el más externo, así
    # que la correlación debe registrarse al final para envolver a todos.
    app.add_middleware(SecurityHeadersMiddleware)  # type: ignore[arg-type]
    app.add_middleware(CorrelationMiddleware)  # type: ignore[arg-type]
