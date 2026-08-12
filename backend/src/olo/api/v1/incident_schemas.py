"""Contratos de las incidencias.

Archivo aparte por el mismo motivo que `admin_schemas.py`: un cambio en la bandeja de
incidencias y uno en un almacén no deben competir por el mismo archivo.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator

from olo.api.v1.schemas import ApiModel

#: De dónde nace. Los tres caben en la misma bandeja porque el TRABAJO es el mismo —ir
#: al hueco, comprobar, decidir— y separarlos daría tres listas que nadie mira enteras.
IncidentKind = Literal["wms_mismatch", "reconciliation", "manual"]
IncidentStatus = Literal["open", "in_progress", "resolved", "dismissed"]


class IncidentCreateIn(ApiModel):
    """Abrir una incidencia.

    `tenant_id` no está y no puede estar: lo pone el servidor con
    `core.current_tenant_id()` dentro de la propia sentencia.
    """

    warehouse_id: UUID
    kind: IncidentKind = "wms_mismatch"
    """El origen. `wms_mismatch` por omisión porque es el único que hoy produce trabajo
    real: `reconciliation` depende de que el modelo lea los códigos de hueco, y su AP
    medido es 0,00."""
    subkind: Annotated[str, Field(max_length=48)] | None = None
    """Para un descuadre del WMS, su clase: `dice_libre_con_stock` y compañía. Es lo que
    permite contar «cuántas de este tipo llevamos resueltas»."""

    location_id: UUID | None = None
    location_code: Annotated[str, Field(max_length=80)] | None = None
    """El código va aparte del id a propósito: el stock huérfano —773 líneas en el
    almacén real— apunta a huecos que el catálogo no tiene, así que no hay `location_id`
    y sin el texto no habría forma de decir de qué hueco habla."""

    title: Annotated[str, Field(min_length=1, max_length=200)]
    details: Annotated[str, Field(max_length=4000)] | None = None

    source_snapshot_id: UUID | None = None
    """De qué foto del WMS salió. Sin esto no se distingue «sigue mal» de «esto se abrió
    con datos de hace tres semanas»."""
    source_job_id: UUID | None = None

    assigned_to: UUID | None = None

    @field_validator("title")
    @classmethod
    def _titulo_con_contenido(cls, v: str) -> str:
        """`min_length=1` no basta: `"   "` tiene tres caracteres y pasa."""
        limpio = v.strip()
        if not limpio:
            raise ValueError("el título no puede quedar vacío")
        return limpio


class IncidentStatusIn(ApiModel):
    to_status: IncidentStatus
    note: Annotated[str, Field(max_length=4000)] | None = None
    """OBLIGATORIA al cerrar (`resolved` o `dismissed`). Lo exige el servicio y también
    el CHECK `chk_inc_cerrada` del motor: una incidencia resuelta sin explicación no
    sirve de nada dentro de un mes."""


class IncidentAssignIn(ApiModel):
    user_id: UUID | None = None
    """`null` la deja sin dueño."""


class IncidentOut(ApiModel):
    id: UUID
    warehouse_id: UUID
    location_id: UUID | None = None
    location_code: str | None = None
    kind: str
    subkind: str | None = None
    status: str
    title: str
    details: str | None = None
    resolution: str | None = None
    created_at: datetime
    resolved_at: datetime | None = None
    dias_abierta: int
    """Días que lleva —o llevó— abierta. Es el dato que ordena el trabajo: una de hace
    tres semanas dice algo distinto de una de esta mañana."""
    assigned_to: UUID | None = None
    assigned_to_name: str | None = None
    opened_by_name: str | None = None
    resolved_by_name: str | None = None
    source_snapshot_id: UUID | None = None
    snapshot_taken_at: datetime | None = None

    last_seen_at: datetime | None = None
    """Cuándo volvió a verse ESE hueco después de abrirse la incidencia.

    `None` significa que nadie ha vuelto a grabarlo — que es información: una incidencia
    de hace tres semanas que nadie ha vuelto a mirar no es lo mismo que una que se
    reproduce en cada vuelo."""

    last_seen_status: str | None = None
    """Cómo se clasificó esa última lectura.

    Permite a la bandeja decir «el recorrido del 12 ya no ve esto» — o lo contrario, que
    es peor y más útil: «sigue igual tres vuelos después».

    NO cierra la incidencia. Cerrar es afirmar que una persona comprobó algo, y una cámara
    no es una persona: un cierre automático convertiría un fallo de detección —un pallet
    que hoy no se vio— en «arreglado», que es la mentira más cara que este producto puede
    contar."""


class IncidentTrayOut(ApiModel):
    items: list[IncidentOut]
    counts: dict[str, int]
    """Por estado y sobre el TOTAL, no sobre lo listado."""
    open_total: int
    """`open` + `in_progress`. Es el número que va al distintivo del menú: lo pendiente."""
    truncated: bool


class IncidentEventOut(ApiModel):
    id: int
    from_status: str | None = None
    to_status: str
    note: str | None = None
    occurred_at: datetime
    actor_name: str | None = None
