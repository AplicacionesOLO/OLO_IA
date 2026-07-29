"""Endpoints de administración de plataforma.

Alcance PLATAFORMA, por encima de los tenants. Todo lo de aquí exige ser Platform
Owner, y ese privilegio **no se otorga por rol**: se concede registrando al
usuario en `platform.owners`.

En el Bloque 0 solo existe la lectura. Conceder y revocar llegan con el CRUD del
módulo, y cuando lleguen deben escribir en `platform.privileged_operation_log`.
"""

from __future__ import annotations

from fastapi import APIRouter

from olo.api.deps import Db, PlatformOwnerRequired
from olo.api.v1.schemas import Envelope, PlatformOwnerOut
from olo.repositories import platform_owner

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
