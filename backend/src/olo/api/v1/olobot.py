"""Endpoints de OLOBOT (0073).

    GET    /v1/olobot/status                     ¿hay bot para mí, y qué puede hacer?
    POST   /v1/olobot/messages                   un turno de conversación
    GET    /v1/olobot/conversations              mis hilos
    GET    /v1/olobot/conversations/{id}         el historial de uno
    DELETE /v1/olobot/conversations/{id}         retirarlo
    POST   /v1/olobot/actions/{id}/confirm       ejecutar una escritura propuesta
    POST   /v1/olobot/actions/{id}/reject        descartarla
    GET    /v1/olobot/actions                    el registro de auditoría

    GET    /v1/olobot/access                     quién tiene bot y con qué nivel
    PUT    /v1/olobot/access/{user_id}           conceder o cambiar un nivel
    DELETE /v1/olobot/access/{user_id}           retirar el acceso

── POR QUÉ `status` NO EXIGE `olobot:use` ───────────────────────────────────

Es la pregunta «¿tengo asistente?», y a quien no lo tiene hay que poder responderle
que no. Con el permiso exigido, el usuario sin acceso recibiría un 403 y la interfaz
tendría que interpretarlo, que es peor que un 200 diciendo `available: false` con el
motivo escrito.

── POR QUÉ CONFIRMAR ES UN POST Y NO PARTE DEL TURNO ───────────────────────

Porque la confirmación tiene que ser una decisión SEPARADA, tomada después de leer qué
va a cambiar. Si el turno pudiera ejecutar, «con confirmación» sería una promesa del
prompt en vez de una propiedad del sistema. Ver la cabecera de `services/olobot/chat`.

── LA ASIMETRÍA DE `access` ─────────────────────────────────────────────────

Leer la lista de niveles exige `olobot:admin`, igual que escribirla. No es un descuido:
la lista dice qué puede hacer el asistente de cada compañero, y eso es información de
administración. Cada usuario ve SU nivel en `status`, que no exige nada.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, status

from olo.api.deps import AppSettings, CurrentContext, Db, require
from olo.api.v1.olobot_schemas import MensajeIn, NivelIn
from olo.api.v1.schemas import Envelope
from olo.repositories import identity
from olo.services.olobot import AccesoService, OlobotService

router = APIRouter(prefix="/olobot", tags=["olobot"])


# ── Estado ────────────────────────────────────────────────────────────────
@router.get(
    "/status",
    response_model=Envelope[dict[str, Any]],
    summary="Si OLOBOT está disponible para este usuario",
)
async def status_olobot(
    db: Db, ctx: CurrentContext, settings: AppSettings
) -> Envelope[dict[str, Any]]:
    """No exige `olobot:use`: ver la cabecera del módulo."""
    user_id = await identity.fetch_current_user_id(db)
    datos = await OlobotService(db, ctx, settings).estado(user_id)
    return Envelope[dict[str, Any]](data=datos)


# ── Conversación ──────────────────────────────────────────────────────────
@router.post(
    "/messages",
    response_model=Envelope[dict[str, Any]],
    dependencies=[require("olobot:use")],
    summary="Hablar con OLOBOT",
)
async def hablar(
    db: Db, ctx: CurrentContext, settings: AppSettings, payload: MensajeIn
) -> Envelope[dict[str, Any]]:
    """Un turno. Puede tardar: el bot consulta la base antes de contestar.

    Responde 503 si no hay clave del modelo y 403 si el usuario no tiene nivel. Las
    escrituras que proponga vuelven en `pending_actions` SIN aplicarse.
    """
    user_id = await identity.fetch_current_user_id(db)
    datos = await OlobotService(db, ctx, settings).hablar(
        user_id=user_id,
        mensaje=payload.message,
        conversacion_id=payload.conversation_id,
        warehouse_id=payload.warehouse_id,
    )
    return Envelope[dict[str, Any]](data=datos)


@router.get(
    "/conversations",
    response_model=Envelope[dict[str, Any]],
    dependencies=[require("olobot:use")],
    summary="Mis conversaciones",
)
async def conversaciones(
    db: Db, ctx: CurrentContext, settings: AppSettings
) -> Envelope[dict[str, Any]]:
    """Solo las propias: RLS no deja ver las de nadie más, ni a un administrador."""
    datos = await OlobotService(db, ctx, settings).conversaciones()
    return Envelope[dict[str, Any]](data=datos)


@router.get(
    "/conversations/{conversation_id}",
    response_model=Envelope[dict[str, Any]],
    dependencies=[require("olobot:use")],
    summary="El historial de una conversación",
)
async def historial(
    db: Db, ctx: CurrentContext, settings: AppSettings, conversation_id: UUID
) -> Envelope[dict[str, Any]]:
    datos = await OlobotService(db, ctx, settings).historial(conversation_id)
    return Envelope[dict[str, Any]](data=datos)


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("olobot:use")],
    summary="Retirar una conversación",
)
async def retirar(
    db: Db, ctx: CurrentContext, settings: AppSettings, conversation_id: UUID
) -> None:
    """Pone `deleted_at`. Los mensajes y las acciones se conservan: ver 0073."""
    await OlobotService(db, ctx, settings).retirar(conversation_id)


# ── Escrituras propuestas ─────────────────────────────────────────────────
@router.post(
    "/actions/{action_id}/confirm",
    response_model=Envelope[dict[str, Any]],
    dependencies=[require("olobot:write")],
    summary="Confirmar y ejecutar una escritura propuesta por OLOBOT",
)
async def confirmar(
    db: Db, ctx: CurrentContext, settings: AppSettings, action_id: UUID
) -> Envelope[dict[str, Any]]:
    """Aquí, y solo aquí, se escribe.

    Vuelve a comprobar el permiso de la herramienta: entre la propuesta y este
    momento pueden haber pasado minutos y un rol puede haberse retirado.

    Confirmar dos veces responde 422, no ejecuta dos veces: el UPDATE exige que la
    acción siga en `proposed`.
    """
    user_id = await identity.fetch_current_user_id(db)
    datos = await OlobotService(db, ctx, settings).confirmar(
        accion_id=action_id, user_id=user_id
    )
    return Envelope[dict[str, Any]](data=datos)


@router.post(
    "/actions/{action_id}/reject",
    response_model=Envelope[dict[str, Any]],
    dependencies=[require("olobot:use")],
    summary="Descartar una escritura propuesta",
)
async def rechazar(
    db: Db, ctx: CurrentContext, settings: AppSettings, action_id: UUID
) -> Envelope[dict[str, Any]]:
    """Exige `olobot:use` y no `olobot:write`: decir «no» a un cambio nunca debe
    necesitar más permiso que el que hizo falta para verlo propuesto.

    Queda registrada como `rejected`, no se borra: un intento rechazado también es
    información. Ver 0073.
    """
    user_id = await identity.fetch_current_user_id(db)
    datos = await OlobotService(db, ctx, settings).rechazar(
        accion_id=action_id, user_id=user_id
    )
    return Envelope[dict[str, Any]](data=datos)


@router.get(
    "/actions",
    response_model=Envelope[dict[str, Any]],
    dependencies=[require("olobot:use")],
    summary="Registro de lo que OLOBOT ha propuesto y escrito",
)
async def registro(
    db: Db, ctx: CurrentContext, settings: AppSettings
) -> Envelope[dict[str, Any]]:
    """De TODO el operador, a diferencia de las conversaciones.

    La asimetría es deliberada: auditar los cambios es necesario, leer los chats de
    tu equipo es vigilancia. Ver la nota de privacidad de 0073.
    """
    datos = await OlobotService(db, ctx, settings).registro()
    return Envelope[dict[str, Any]](data=datos)


# ── Niveles ───────────────────────────────────────────────────────────────
@router.get(
    "/access",
    response_model=Envelope[dict[str, Any]],
    dependencies=[require("olobot:admin")],
    summary="Quién tiene OLOBOT y con qué nivel",
)
async def niveles(db: Db, ctx: CurrentContext) -> Envelope[dict[str, Any]]:
    """Incluye a los usuarios SIN nivel: para conceder uno hay que ver a quién falta."""
    datos = await AccesoService(db, ctx).listar()
    return Envelope[dict[str, Any]](data=datos)


@router.put(
    "/access/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("olobot:admin")],
    summary="Conceder o cambiar el nivel de OLOBOT de un usuario",
)
async def poner_nivel(
    db: Db, ctx: CurrentContext, user_id: UUID, payload: NivelIn
) -> None:
    """PUT y no PATCH: se fija el nivel completo, no se parchea un campo.

    Responde 422 si intentas cambiar el TUYO. Nadie se concede su propio nivel: es lo
    que hace que `granted_by` signifique algo. Ver `services/olobot/acceso`.
    """
    actor = await identity.fetch_current_user_id(db)
    await AccesoService(db, ctx).poner(
        user_id=user_id, nivel=payload.level, nota=payload.note, actor=actor
    )


@router.delete(
    "/access/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("olobot:admin")],
    summary="Retirar el acceso a OLOBOT",
)
async def quitar_nivel(db: Db, ctx: CurrentContext, user_id: UUID) -> None:
    """Las conversaciones se conservan: retirar el acceso no borra lo que se dijo."""
    actor = await identity.fetch_current_user_id(db)
    await AccesoService(db, ctx).quitar(user_id=user_id, actor=actor)
