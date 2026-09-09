"""Endpoints de administración de plataforma.

Alcance PLATAFORMA, por encima de los tenants. Todo lo de aquí exige ser Platform
Owner, y ese privilegio **no se otorga por rol**: se concede registrando al
usuario en `platform.owners`.

En el Bloque 0 solo existe la lectura. Conceder y revocar llegan con el CRUD del
módulo, y cuando lleguen deben escribir en `platform.privileged_operation_log`.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter

from olo.api.deps import Db, PlatformOwnerRequired
from olo.api.v1.schemas import Envelope, PlatformOwnerOut
from olo.api.v1.usage_schemas import QuotaOut, QuotaSetIn
from olo.repositories import platform_owner
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
