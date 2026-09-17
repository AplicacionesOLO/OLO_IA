"""Middleware de correlación, cabeceras de seguridad, captura de excepciones y
log de acceso."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, ClassVar
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from olo.core.context import get_correlation_id, get_request_id, set_request_ids
from olo.core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.types import ASGIApp

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

    _HEADERS: ClassVar[dict[str, str]] = {
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


class UnhandledExceptionMiddleware(BaseHTTPMiddleware):
    """Convierte una excepción sin capturar en la MISMA respuesta JSON que
    `api/errors.py`, pero devuelta como un `Response` normal en vez de a través
    del handler que Starlette registra para la clase `Exception`.

    ── POR QUÉ NO BASTA CON `@app.exception_handler(Exception)` ─────────────

    Starlette coloca ese handler en `ServerErrorMiddleware`, que construye
    SIEMPRE como la capa más externa de toda la aplicación —por delante de
    cualquier middleware añadido con `add_middleware()`, CORS incluido, sin
    que importe en qué orden se registren—. Una respuesta que sale por ahí
    nunca lleva `Access-Control-Allow-Origin`, y el navegador la bloquea antes
    de que el código de la aplicación llegue a verla: `fetch()` la reporta
    como fallo de red, no como el error 500 que de verdad ocurrió.

    Se vio en vivo con OLOBOT: un 500 por cuota agotada del proveedor del
    modelo llegaba al cliente como «Sin conexión con el servidor» — CORS
    bloqueaba la respuesta, no la red.

    Capturando la excepción AQUÍ, dentro de un middleware normal, la respuesta
    fluye como cualquier otra: si `CORSMiddleware` está registrado por fuera de
    este —y lo está, ver `main.py`—, sí le añade sus cabeceras.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        try:
            return await call_next(request)
        except Exception:
            _log.exception("excepcion no controlada")
            body: dict[str, object] = {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
            }
            if rid := get_request_id():
                body["request_id"] = rid
            if cid := get_correlation_id():
                body["correlation_id"] = cid
            return JSONResponse(status_code=500, content={"error": body})


def register_middleware(app: ASGIApp) -> None:
    # El orden de alta ES el orden externo→interno: el primero que se añade
    # queda más CERCA de la ruta, y cada uno despues envuelve al anterior.
    #
    # `UnhandledExceptionMiddleware` va PRIMERO —la capa mas interna de las
    # tres— a proposito: si capturara la excepcion estando por FUERA de
    # `SecurityHeadersMiddleware`/`CorrelationMiddleware`, la respuesta que
    # devuelve nunca pasaria por el `call_next()` de esos dos, y sus cabeceras
    # tampoco saldrian en un 500 — el mismo problema que motivo este
    # middleware, un nivel mas abajo. Puesto por dentro, los dos lo envuelven
    # con normalidad: reciben un `Response` limpio de vuelta, no una
    # excepcion, y le anaden sus cabeceras igual que a cualquier otra
    # respuesta.
    #
    # `CorrelationMiddleware` se registra al final de los tres para envolver
    # tambien a `SecurityHeadersMiddleware`. `CORSMiddleware`, en `main.py`, se
    # añade DESPUÉS de esta función entera — así que envuelve a los tres.
    app.add_middleware(UnhandledExceptionMiddleware)  # type: ignore[attr-defined]
    app.add_middleware(SecurityHeadersMiddleware)  # type: ignore[attr-defined]
    app.add_middleware(CorrelationMiddleware)  # type: ignore[attr-defined]
