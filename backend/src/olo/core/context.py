"""Contexto de petición y de tenant.

`request_id` y `correlation_id` son conceptos DISTINTOS y ambos permanecen
(DEC-10):

  • request_id     — identifica UNA petición HTTP. Se genera siempre aquí.
  • correlation_id — identifica una CADENA de operaciones que puede atravesar
                     varias peticiones, workers y jobs. Llega en la cabecera
                     X-Correlation-Id si el llamante la envía; si no, se
                     inicializa con el request_id.

Ambos viajan a PostgreSQL como GUCs (`app.request_id`, `app.correlation_id`)
para que la auditoría los registre sin que la capa de dominio tenga que
propagarlos a mano.
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from uuid import UUID

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)


def set_request_ids(request_id: str, correlation_id: str) -> None:
    _request_id.set(request_id)
    _correlation_id.set(correlation_id)


def get_request_id() -> str | None:
    return _request_id.get()


def get_correlation_id() -> str | None:
    return _correlation_id.get()


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Contexto de seguridad de una petición autenticada.

    Se construye EXCLUSIVAMENTE a partir de claims del JWT ya verificado.
    El cliente nunca puede fijar `tenant_id`: si lo envía en el cuerpo, en la
    query o en una cabecera, se ignora.
    """

    auth_user_id: UUID
    """Identidad externa: claim `sub` = auth.users.id."""

    tenant_id: UUID
    """Tenant activo. Claim app_metadata.tenant_id."""

    tenant_wide_access: bool = False
    """Acceso a todos los almacenes del tenant. Explícito, default False."""

    warehouse_id: UUID | None = None
    """Almacén seleccionado (cabecera X-Warehouse-Id), ya VALIDADO contra
    core.accessible_warehouse_ids(). Es contexto de consulta, no de seguridad:
    RLS ya limita a los almacenes accesibles."""

    def as_gucs(self) -> dict[str, str]:
        """Los cuatro GUCs de DEC-02, listos para `set_config`."""
        return {
            "app.auth_user_id": str(self.auth_user_id),
            "app.tenant_id": str(self.tenant_id),
            "app.tenant_wide_access": "true" if self.tenant_wide_access else "false",
            "app.request_id": get_request_id() or "",
            "app.correlation_id": get_correlation_id() or "",
        }
