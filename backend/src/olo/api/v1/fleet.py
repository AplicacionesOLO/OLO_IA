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

from olo.api.deps import AccessToken, AppSettings, CurrentContext, Db, require
from olo.api.v1.fleet_schemas import (
    DeviceHeartbeatIn,
    DeviceListOut,
    DeviceOut,
    DeviceProvisionIn,
    DeviceProvisionOut,
    DeviceRetireIn,
    FleetModelUpdateOut,
    FleetOfflineAlertOut,
)
from olo.api.v1.schemas import Envelope
from olo.services.fleet import FleetService
from olo.services.fleet_model import FleetModelService
from olo.services.notifications import NotificationService

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
        current_model_version=cuerpo.current_model_version,
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


@router.get(
    "/model",
    response_model=Envelope[FleetModelUpdateOut],
    dependencies=[require("drones:ingest")],
    summary="La version de modelo vigente para la flota de este tenant, con URL de descarga (#7)",
)
async def fleet_model(
    db: Db, settings: AppSettings, token: AccessToken
) -> Envelope[FleetModelUpdateOut]:
    """Pensada para que el dispositivo la consulte de vez en cuando (no en
    cada latido) y decida SOLO el si comparando `version` contra lo que ya
    trae cargado -- ver `FleetModelService.revisar_actualizacion`. Sin modelo
    publicado a esta flota, `model_available` es `false`: seguir con el que
    trae instalado es una respuesta valida, no un error."""
    datos = await FleetModelService(db, settings, token).revisar_actualizacion()
    return Envelope[FleetModelUpdateOut](data=FleetModelUpdateOut.model_validate(datos))


@router.post(
    "/devices/provision",
    response_model=Envelope[DeviceProvisionOut],
    status_code=201,
    dependencies=[require("drones:write")],
    summary="Dar de alta un dispositivo CON credencial propia (identidad de maquina)",
)
async def provision_device(
    cuerpo: DeviceProvisionIn, db: Db, ctx: CurrentContext, settings: AppSettings
) -> Envelope[DeviceProvisionOut]:
    """A diferencia de `device_heartbeat` -- que solo registra el latido de un
    dispositivo que YA trae su propio `device_key`, tipicamente autenticado
    con el email/password de una persona --, este endpoint crea una identidad
    NUEVA en Supabase Auth solo para el dispositivo (ver `FleetService.
    provision`), con el rol `device`: unicamente `perception:ingest` y
    `drones:ingest`, nunca lectura de ningun otro dato del tenant.

    `refresh_token` viaja en la respuesta UNA sola vez -- es el equivalente de
    una API key: quien la pierde tiene que retirar el dispositivo y
    provisionar uno nuevo, igual que se regenera cualquier credencial de
    maquina que se extravia.

    Exige, ademas de `drones:write`: `roles:assign` (se le asigna un rol) y
    `users:invite` (se crea un usuario) -- las tres las tiene `tenant_admin`
    por defecto; `warehouse_manager` no, a proposito: dar de alta un
    dispositivo con credencial propia es una decision de administrador.
    """
    datos = await FleetService(db, ctx, settings).provision(
        warehouse_id=cuerpo.warehouse_id, kind=cuerpo.kind, name=cuerpo.name
    )
    return Envelope[DeviceProvisionOut](data=DeviceProvisionOut.model_validate(datos))


@router.post(
    "/devices/offline-alert",
    response_model=Envelope[FleetOfflineAlertOut],
    dependencies=[require("drones:write")],
    summary="Avisa a los administradores del tenant de los dispositivos caidos sin retirar (#6)",
)
async def offline_alert(
    db: Db, ctx: CurrentContext, settings: AppSettings
) -> Envelope[FleetOfflineAlertOut]:
    """Pensado para un barrido programado -- mismo patron que `overdue-alert`
    de incidencias y `quota-alert` de uso: no cambia el estado de ningun
    dispositivo, solo notifica, e idempotente por caida (ver `FleetService.
    revisar_dispositivos_offline`)."""
    notificaciones = NotificationService(db, ctx, settings)
    datos = await FleetService(db, ctx).revisar_dispositivos_offline(notificaciones=notificaciones)
    return Envelope[FleetOfflineAlertOut](data=FleetOfflineAlertOut.model_validate(datos))
