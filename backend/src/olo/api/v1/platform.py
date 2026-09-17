"""Endpoints de administración de plataforma.

Alcance PLATAFORMA, por encima de los tenants. Todo lo de aquí exige ser Platform
Owner, y ese privilegio **no se otorga por rol**: se concede registrando al
usuario en `platform.owners`.

Conceder y revocar exigen SER Platform Owner —`PlatformOwnerRequired`— y quedan
en `platform.privileged_operation_log` (0024), append-only: es el privilegio
más alto del sistema, y quién se lo dio a quién y por qué no puede desaparecer.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, status

from olo.api.deps import AccessToken, AppSettings, Db, PlatformOwnerRequired
from olo.api.v1.fleet_schemas import FleetModelOut, FleetModelPublishIn
from olo.api.v1.schemas import (
    Envelope,
    PlatformOwnerGrantIn,
    PlatformOwnerOut,
    PlatformOwnerRevokeIn,
)
from olo.api.v1.usage_schemas import QuotaOut, QuotaSetIn
from olo.repositories import identity, platform_owner
from olo.services.fleet_model import FleetModelService
from olo.services.platform_owner import PlatformOwnerService
from olo.services.usage import UsageService

router = APIRouter(prefix="/platform", tags=["platform"])


@router.get(
    "/owners",
    response_model=Envelope[list[PlatformOwnerOut]],
    dependencies=[PlatformOwnerRequired],
    summary="Listar los Platform Owners",
)
async def list_owners(db: Db) -> Envelope[list[PlatformOwnerOut]]:
    """Todos los Platform Owners, incluidos los revocados.

    Los revocados se devuelven a propósito: quién tuvo este privilegio y cuándo
    dejó de tenerlo es justo la información que hace falta al auditar. Se
    distinguen por `revoked_at`.

    Doble puerta, y ninguna de las dos es redundante:
      · `PlatformOwnerRequired` responde 403 NOT_PLATFORM_OWNER con un mensaje
        accionable en lugar de una lista vacía inexplicable;
      · RLS sobre `platform.owners` devolvería cero filas de todos modos, incluso
        si esta dependencia se olvidara.
    """
    rows = await platform_owner.list_all(db)
    return Envelope[list[PlatformOwnerOut]](
        data=[PlatformOwnerOut.model_validate(r) for r in rows]
    )


@router.post(
    "/owners",
    response_model=Envelope[PlatformOwnerOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[PlatformOwnerRequired],
    summary="Conceder Platform Owner a un usuario, por correo",
)
async def grant_owner(cuerpo: PlatformOwnerGrantIn, db: Db) -> Envelope[PlatformOwnerOut]:
    """Solo un Platform Owner puede crear otro. Sin esto, el primero tendría que
    seguir viniendo de una migración para siempre."""
    actor = await identity.fetch_current_user_id(db)
    datos = await PlatformOwnerService(db).grant(
        email=cuerpo.email, reason=cuerpo.reason, actor=actor
    )
    filas = await platform_owner.list_all(db)
    fila = next(f for f in filas if str(f["user_id"]) == str(datos["user_id"]))
    return Envelope[PlatformOwnerOut](data=PlatformOwnerOut.model_validate(fila))


@router.post(
    "/owners/{user_id}/revoke",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[PlatformOwnerRequired],
    summary="Revocar Platform Owner a un usuario",
)
async def revoke_owner(user_id: UUID, cuerpo: PlatformOwnerRevokeIn, db: Db) -> None:
    """Revocación lógica (`revoked_at`), nunca borrado: la fila es el registro de
    que esa persona tuvo el privilegio. Bloqueado si dejaría la plataforma sin
    ningún owner activo — ver `platform.prevent_last_owner_revocation()`."""
    actor = await identity.fetch_current_user_id(db)
    await PlatformOwnerService(db).revoke(user_id=user_id, reason=cuerpo.reason, actor=actor)


@router.put(
    "/tenants/{tenant_id}/quotas",
    response_model=Envelope[QuotaOut],
    dependencies=[PlatformOwnerRequired],
    summary="Fijar la cuota de un tenant -- base de planes/facturacion (0113)",
)
async def set_tenant_quota(
    tenant_id: UUID, cuerpo: QuotaSetIn, db: Db
) -> Envelope[QuotaOut]:
    """`None` en un campo es SIN LIMITE, no "no tocar" -- este PUT reemplaza
    la cuota entera, igual que cualquier otro PUT de este archivo. Doble
    puerta con `core.fijar_cuota_tenant`, que comprueba `is_platform_owner()`
    por su cuenta -- ver la cabecera de la migracion 0113."""
    datos = await UsageService(db).fijar_cuota(
        tenant_id,
        max_detecciones=cuerpo.max_detections_monthly,
        max_dispositivos=cuerpo.max_devices,
        retencion_dias=cuerpo.crop_retention_days,
    )
    return Envelope[QuotaOut](data=QuotaOut.model_validate(datos))


@router.put(
    "/tenants/{tenant_id}/fleet-model",
    response_model=Envelope[FleetModelOut],
    dependencies=[PlatformOwnerRequired],
    summary="Publicar un modelo entrenado a la flota de un tenant (#7 del plan de mejoras SaaS)",
)
async def publish_fleet_model(
    tenant_id: UUID, cuerpo: FleetModelPublishIn, db: Db, settings: AppSettings, token: AccessToken
) -> Envelope[FleetModelOut]:
    """Copia los pesos de una version YA PUBLICADA (catalogo de IA) del bucket
    `ai-assets` -- que exige platform owner para leerse, ver 0045/0077 -- a
    `fleet-models`, donde cualquier dispositivo del tenant los puede
    descargar con su propia credencial (ver la cabecera de la migracion
    0117). Necesita SER platform owner por partida doble: la lectura de
    `ai-assets` lo exige por su propia politica de Storage, y la escritura
    en `core.tenant_fleet_model` la exige `core.fijar_modelo_flota`."""
    datos = await FleetModelService(db, settings, token).publicar(
        tenant_id=tenant_id, model_version_id=cuerpo.model_version_id
    )
    return Envelope[FleetModelOut](data=FleetModelOut.model_validate(datos))
