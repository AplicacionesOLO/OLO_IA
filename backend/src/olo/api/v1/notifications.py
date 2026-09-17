"""Avisos (0104): la campana de la aplicación.

    GET    /notifications             los mios, mas recientes primero
    POST   /notifications/{id}/read   marcar uno leido
    POST   /notifications/read-all    marcar todos leidos
    DELETE /notifications/{id}        descartar uno

No hay POST de creación aquí a propósito: un aviso lo crea el servicio que lo
origina (entrenamiento, percepción, incidencias), nunca una pantalla a mano. Ver
`services/notifications.py`.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from olo.api.deps import AppSettings, CurrentContext, Db
from olo.api.v1.notification_schemas import NotificationListOut
from olo.api.v1.schemas import Envelope
from olo.repositories import identity
from olo.services.notifications import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get(
    "",
    response_model=Envelope[NotificationListOut],
    summary="Mis avisos, mas recientes primero",
)
async def listar(
    db: Db,
    ctx: CurrentContext,
    settings: AppSettings,
    solo_no_leidas: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> Envelope[NotificationListOut]:
    """RLS ya limita esto a lo propio: no hace falta ningun permiso especial —
    ver un aviso que a uno le mandaron no es un privilegio, es el correo de uno."""
    user_id = await identity.fetch_current_user_id(db)
    datos = await NotificationService(db, ctx, settings).listar(
        user_id=user_id, solo_no_leidas=solo_no_leidas, limit=limit
    )
    return Envelope[NotificationListOut](data=NotificationListOut.model_validate(datos))


@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Marcar un aviso como leido",
)
async def marcar_leida(
    notification_id: UUID, db: Db, ctx: CurrentContext, settings: AppSettings
) -> None:
    user_id = await identity.fetch_current_user_id(db)
    await NotificationService(db, ctx, settings).marcar_leida(
        notif_id=notification_id, user_id=user_id
    )


@router.post(
    "/read-all",
    response_model=Envelope[dict[str, int]],
    summary="Marcar todos los avisos como leidos",
)
async def marcar_todas_leidas(
    db: Db, ctx: CurrentContext, settings: AppSettings
) -> Envelope[dict[str, int]]:
    user_id = await identity.fetch_current_user_id(db)
    tocadas = await NotificationService(db, ctx, settings).marcar_todas_leidas(user_id)
    return Envelope[dict[str, int]](data={"marked": tocadas})


@router.delete(
    "/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Descartar un aviso",
)
async def eliminar(
    notification_id: UUID, db: Db, ctx: CurrentContext, settings: AppSettings
) -> None:
    user_id = await identity.fetch_current_user_id(db)
    await NotificationService(db, ctx, settings).eliminar(
        notif_id=notification_id, user_id=user_id
    )
