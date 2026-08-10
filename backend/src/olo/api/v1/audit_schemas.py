"""Formas de salida del registro de auditoría.

No hay ni un esquema de ENTRADA con cuerpo, y es la propiedad que define el módulo: por
aquí no se escribe nada. `olo_app` no tiene INSERT sobre `audit.entries` (0085).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from olo.api.v1.schemas import ApiModel


class AuditEntryOut(ApiModel):
    id: int
    occurred_at: datetime
    schema_name: str
    table_name: str
    row_id: str | None = None
    operation: str

    actor_user_id: UUID | None = None
    actor_name: str | None = None
    actor_email: str | None = None
    """`None` cuando no hubo persona detrás: lo hizo una migracion o una herramienta.
    Quien decide como llamar a eso en pantalla es la interfaz, no la API."""

    db_role: str
    """El rol del motor. Distingue «lo hizo una herramienta» de «lo hizo alguien y no
    tengo permiso para ver quien»."""

    is_test: bool = False
    """La escritura venia de la suite de tests. Es una PISTA, no un control: la entrada
    se guarda completa y nunca se borra. Ver la migracion 0086."""

    changed: list[str] | None = None
    diff: list[dict[str, Any]] = Field(default_factory=list)
    """Una entrada por columna que cambio: `{field, from, to}`. Se calcula en el
    servidor —no se manda la fila entera dos veces para compararla en el navegador—, y
    va como dict suelto porque `from` es palabra reservada de Python: un modelo con
    alias solo para eso añadiria una capa que no aporta validacion."""
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


class AuditSummaryRow(ApiModel):
    tabla: str
    operation: str
    n: int
    ultima: datetime


class AuditActorOut(ApiModel):
    actor_user_id: UUID | None = None
    actor_name: str | None = None
    email: str | None = None
    db_role: str
    n: int
    ultima: datetime


class WatchedTableOut(ApiModel):
    """Una tabla con el trigger puesto.

    Sale de `pg_trigger`, no de una lista en el codigo: si alguien desactiva el trigger,
    `activo` lo dice en vez de seguir prometiendo cobertura.
    """

    schema_name: str
    table_name: str
    activo: bool


class AuditLogOut(ApiModel):
    entries: list[AuditEntryOut]
    total: int
    page: int
    page_size: int
    pages: int

    summary: list[AuditSummaryRow] = Field(default_factory=list)
    actors: list[AuditActorOut] = Field(default_factory=list)

    test_total: int = 0
    """Cuantas entradas de la suite de tests hay. Va SIEMPRE, tambien cuando se estan
    incluyendo: un filtro que quita filas sin contarlas es lo mismo que perderlas."""

    including_tests: bool = False

    watched: list[WatchedTableOut] = Field(default_factory=list)
    """Que se audita. Va en la MISMA respuesta que el registro a proposito: el silencio
    de un registro de auditoria se lee como «no paso nada», y aqui hay cosas que
    deliberadamente no se auditan —41.055 filas de stock por importacion—. Sin esta
    lista, un registro sin entradas de inventario parece decir que nadie importo nada."""
