"""Flota de dispositivos de borde (0110). Ver ADR-015.

Tres endpoints, mismo reparto de permisos que 0075/0069:
    drones:ingest  latir (registrarse o refrescar)      credencial de MAQUINA
    drones:read    ver la flota y su estado              todos los roles
    drones:write   renombrar/retirar/reactivar           admin/manager/operario
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from olo.api.deps import CurrentContext, Db, require
from olo.api.v1.fleet_schemas import (
    DeviceHeartbeatIn,
    DeviceListOut,
    DeviceOut,
    DeviceRetireIn,
)
from olo.api.v1.schemas import Envelope
from olo.services.fleet import FleetService

router = APIRouter(prefix="/fleet", tags=["fleet"])


@router.post(
    "/devices/heartbeat",
    response_model=Envelope[DeviceOut],
    dependencies=[require("drones:ingest")],
    summary="Registrar un dispositivo de flota o refrescar su latido (extremo del dispositivo)",
)
async def device_heartbeat(
    cuerpo: DeviceHeartbeatIn, db: Db, ctx: CurrentContext
) -> Envelope[DeviceOut]:
    """Registrarse y latir son la misma llamada, a proposito -- ver
    `DeviceHeartbeatIn` y el mismo criterio en `worker_heartbeat`."""
    datos = await FleetService(db, ctx).heartbeat(
        device_key=cuerpo.device_key,
        kind=cuerpo.kind,
        name=cuerpo.name,
        warehouse_id=cuerpo.warehouse_id,
        app_version=cuerpo.app_version,
        device_model=cuerpo.device_model,
        current_job_id=cuerpo.current_job_id,
    )
    return Envelope[DeviceOut](data=DeviceOut.model_validate(datos))


@router.get(
    "/devices",
    response_model=Envelope[DeviceListOut],
    dependencies=[require("drones:read")],
    summary="La flota de dispositivos de borde, con su estado",
)
async def list_devices(
    db: Db,
    ctx: CurrentContext,
    warehouse_id: Annotated[UUID | None, Query(description="Acota a un almacen")] = None,
) -> Envelope[DeviceListOut]:
    """Incluye los retirados y los que llevan rato sin latir a proposito --
    ver `FleetRepository.listar`: "no hay flota" y "hubo flota y se apago"
    son hechos distintos, y la pantalla necesita poder distinguirlos."""
    datos = await FleetService(db, ctx).list_devices(warehouse_id=warehouse_id)
    return Envelope[DeviceListOut](data=DeviceListOut.model_validate(datos))


@router.post(
    "/devices/{device_id}/retire",
    response_model=Envelope[DeviceOut],
    dependencies=[require("drones:write")],
    summary="Marcar un dispositivo fuera de uso",
)
async def retire_device(
    device_id: UUID, cuerpo: DeviceRetireIn, db: Db, ctx: CurrentContext
) -> Envelope[DeviceOut]:
    """Una decision humana que el latido no puede anular por si solo -- ver
    la cabecera de la migracion 0110."""
    datos = await FleetService(db, ctx).retire(device_id, reason=cuerpo.reason)
    return Envelope[DeviceOut](data=DeviceOut.model_validate(datos))


@router.post(
    "/devices/{device_id}/reactivate",
    response_model=Envelope[DeviceOut],
    dependencies=[require("drones:write")],
    summary="Reactivar un dispositivo retirado",
)
async def reactivate_device(device_id: UUID, db: Db, ctx: CurrentContext) -> Envelope[DeviceOut]:
    datos = await FleetService(db, ctx).reactivate(device_id)
    return Envelope[DeviceOut](data=DeviceOut.model_validate(datos))
