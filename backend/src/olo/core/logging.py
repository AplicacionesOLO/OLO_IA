"""Logging estructurado en JSON con request_id y correlation_id automáticos.

Sin dependencias externas: un `Formatter` de la biblioteca estándar basta y
evita añadir un paquete solo para esto.

Regla no negociable: NUNCA se registran tokens, contraseñas ni DSNs. El campo
`extra` es para identificadores y métricas, no para payloads.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from olo.core.context import get_correlation_id, get_request_id

_RESERVED = frozenset(
    {
        "args", "asctime", "created", "exc_info", "exc_text", "filename",
        "funcName", "levelname", "levelno", "lineno", "module", "msecs",
        "message", "msg", "name", "pathname", "process", "processName",
        "relativeCreated", "stack_info", "thread", "threadName", "taskName",
    }
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }

        # Correlación: presente en TODA línea, sin que el llamante la pase.
        if rid := get_request_id():
            payload["request_id"] = rid
        if cid := get_correlation_id():
            payload["correlation_id"] = cid

        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str, ensure_ascii=False)


class PlainFormatter(logging.Formatter):
    """Formato legible para desarrollo local."""

    def format(self, record: logging.LogRecord) -> str:
        rid = get_request_id()
        prefix = f"[{rid[:8]}] " if rid else ""
        return f"{record.levelname:<8} {prefix}{record.name}: {record.getMessage()}"


def configure_logging(*, level: str = "INFO", json_output: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if json_output else PlainFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # uvicorn duplica el log de acceso: nuestro middleware ya lo cubre y con
    # más contexto (request_id, tenant, duración).
    logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("uvicorn.error").propagate = True
    # SQLAlchemy en INFO imprime cada sentencia; solo en debug explícito.
    logging.getLogger("sqlalchemy.engine").setLevel("WARNING")


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
