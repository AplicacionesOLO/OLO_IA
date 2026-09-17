"""Medicion de uso del tenant (0112)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from olo.api.deps import AccessToken, AppSettings, CurrentContext, Db, require
from olo.api.v1.schemas import Envelope
from olo.api.v1.usage_schemas import CropCleanupOut, QuotaAlertOut, QuotaOut, UsageSummaryOut
from olo.services.notifications import NotificationService
from olo.services.usage import UsageService

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get(
    "/summary",
    response_model=Envelope[UsageSummaryOut],
    dependencies=[require("usage:read")],
    summary="Cuanto consume el tenant en el periodo -- base de cuotas y facturacion",
)
async def usage_summary(
    db: Db,
    desde: Annotated[
        datetime | None, Query(description="Inicio del periodo. Sin esto: el mes en curso")
    ] = None,
    hasta: Annotated[
        datetime | None, Query(description="Fin del periodo. Sin esto: ahora mismo")
    ] = None,
) -> Envelope[UsageSummaryOut]:
    datos = await UsageService(db).resumen(desde=desde, hasta=hasta)
    return Envelope[UsageSummaryOut](data=UsageSummaryOut.model_validate(datos))


@router.get(
    "/quotas",
    response_model=Envelope[QuotaOut],
    dependencies=[require("usage:read")],
    summary="La cuota del tenant actual -- NULL en un campo es sin limite",
)
async def get_quota(db: Db) -> Envelope[QuotaOut]:
    """Fijarla es cosa de un platform owner (`PUT /v1/platform/tenants/{id}/quotas`) --
    esto es solo la lectura, la misma que ya hace `verificar_cupo_*` internamente."""
    datos = await UsageService(db).cuota()
    return Envelope[QuotaOut](data=QuotaOut.model_validate(datos))


@router.post(
    "/cleanup/crops",
    response_model=Envelope[CropCleanupOut],
    dependencies=[require("usage:write")],
    summary="Borra de Storage los recortes mas viejos que la cuota de retencion (0115)",
)
async def cleanup_crops(
    db: Db, settings: AppSettings, token: AccessToken
) -> Envelope[CropCleanupOut]:
    """Pensado para llamarse desde una tarea programada -- ver
    `backend/tools/limpiar_recortes.py` -- no desde la pantalla: es un borrado
    de bytes real, no una lectura. Sin `crop_retention_days` fijado, no hace
    nada (ver `UsageService.limpiar_recortes_vencidos`)."""
    datos = await UsageService(db, settings, token).limpiar_recortes_vencidos()
    return Envelope[CropCleanupOut](data=CropCleanupOut.model_validate(datos))


@router.post(
    "/quota-alert",
    response_model=Envelope[QuotaAlertOut],
    dependencies=[require("usage:write")],
    summary="Avisa a los administradores del tenant si la cuota esta cerca del limite (#6)",
)
async def quota_alert(
    db: Db, ctx: CurrentContext, settings: AppSettings
) -> Envelope[QuotaAlertOut]:
    """Pensado para un barrido programado -- mismo patron que el `overdue-
    alert` de incidencias: no cambia ni cierra nada, solo notifica, e
    idempotente por periodo (ver `UsageService.revisar_alertas_cuota`)."""
    notificaciones = NotificationService(db, ctx, settings)
    datos = await UsageService(db).revisar_alertas_cuota(notificaciones=notificaciones)
    return Envelope[QuotaAlertOut](data=QuotaAlertOut.model_validate(datos))
