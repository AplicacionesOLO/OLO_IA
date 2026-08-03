"""Traducción de excepciones a respuestas HTTP con envoltorio unificado.

Formato único de error, para todos los códigos:

    {"error": {"code": "...", "message": "...", "details": {...},
               "request_id": "...", "correlation_id": "..."}}

El `request_id` va en el cuerpo a propósito: es lo que permite que un usuario
copie el mensaje de error y el equipo encuentre la traza exacta sin pedirle nada
más.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError

from olo.core.context import get_correlation_id, get_request_id
from olo.core.errors import ConflictError, OloError
from olo.core.logging import get_logger

_log = get_logger(__name__)

# Códigos SQLSTATE que la capa de datos usa como señal de negocio.
_SQLSTATE_MAP: dict[str, tuple[int, str, str]] = {
    "23505": (status.HTTP_409_CONFLICT, "DUPLICATE_RESOURCE",
              "A resource with the same business key already exists"),
    "23503": (status.HTTP_422_UNPROCESSABLE_ENTITY, "INVALID_REFERENCE",
              "A referenced resource does not exist or belongs to another scope"),
    "23514": (status.HTTP_422_UNPROCESSABLE_ENTITY, "CONSTRAINT_VIOLATION",
              "The operation violates a data constraint"),
    "42501": (status.HTTP_403_FORBIDDEN, "OPERATION_NOT_PERMITTED",
              "The operation is not permitted in this context"),
}


def _envelope(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if details:
        body["details"] = details
    if rid := get_request_id():
        body["request_id"] = rid
    if cid := get_correlation_id():
        body["correlation_id"] = cid
    return {"error": body}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(OloError)
    async def _olo(_: Request, exc: OloError) -> JSONResponse:
        # 5xx se registran con traza; 4xx son esperables y no ensucian el log.
        if exc.http_status >= 500:
            _log.exception("error interno", extra={"code": exc.code})
        else:
            _log.info("error de cliente", extra={"code": exc.code, "status": exc.http_status})
        return JSONResponse(
            status_code=exc.http_status,
            content=_envelope(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {
                "field": ".".join(str(p) for p in err.get("loc", ()) if p != "body"),
                "message": err.get("msg", ""),
                "type": err.get("type", ""),
            }
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=_envelope("VALIDATION_ERROR", "Request validation failed", {"errors": errors}),
        )

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        return _from_sqlstate(exc)

    @app.exception_handler(DBAPIError)
    async def _dbapi(_: Request, exc: DBAPIError) -> JSONResponse:
        return _from_sqlstate(exc)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        # Nunca se expone el detalle interno al cliente: solo el request_id,
        # que es lo que permite correlacionar con el log del servidor.
        _log.exception("excepcion no controlada", extra={"exc_type": type(exc).__name__})
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("INTERNAL_ERROR", "An unexpected error occurred"),
        )


def _from_sqlstate(exc: DBAPIError) -> JSONResponse:
    sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
    http_status, code, message = _SQLSTATE_MAP.get(
        str(sqlstate),
        (status.HTTP_500_INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Database error"),
    )
    if http_status >= 500:
        _log.exception("error de base de datos", extra={"sqlstate": str(sqlstate)})
    else:
        _log.info("restriccion de datos", extra={"sqlstate": str(sqlstate), "code": code})
    return JSONResponse(status_code=http_status, content=_envelope(code, message))


__all__ = ["ConflictError", "register_error_handlers"]
