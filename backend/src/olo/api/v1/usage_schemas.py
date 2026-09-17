"""Esquemas de medicion de uso (0112) y cuotas (0113)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import Field

from olo.api.v1.schemas import ApiModel


class UsageSummaryOut(ApiModel):
    period_start: datetime
    period_end: datetime
    detecciones: int
    trabajos_de_inspeccion: int
    dispositivos_nuevos: int
    dispositivos_registrados: int


class QuotaOut(ApiModel):
    #: Solo viene en la respuesta de fijar la cuota (confirma A QUIEN se le
    #: aplico) -- `GET /usage/quotas` la omite: es siempre la del tenant de
    #: la sesion, y repetirla ahi no le diria nada nuevo a quien pregunta.
    tenant_id: UUID | None = None
    max_detections_monthly: int | None
    max_devices: int | None
    #: Dias que se conserva un recorte antes de ser candidato a borrado
    #: (0115). NULL = para siempre.
    crop_retention_days: int | None
    updated_at: datetime | None


class QuotaSetIn(ApiModel):
    #: `None` = sin limite. Se manda explicito y no se omite el campo: omitirlo
    #: en un PUT dejaria ambiguo si es "quitar el limite" o "no tocar este campo".
    max_detections_monthly: Annotated[int, Field(gt=0)] | None = None
    max_devices: Annotated[int, Field(gt=0)] | None = None
    crop_retention_days: Annotated[int, Field(gt=0)] | None = None


class CropCleanupOut(ApiModel):
    borrados: int
    retencion_dias: int | None
    fallo: bool = False


class QuotaAlertOut(ApiModel):
    #: `"detections"` y/o `"devices"` -- vacio si ningun rubro esta cerca de
    #: su cuota, o si ya se habia avisado de este mismo periodo (idempotente).
    avisos_enviados: list[str]
