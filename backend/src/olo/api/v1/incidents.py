"""Incidencias: el trabajo que sale de los descuadres.

── QUE ES UNA INCIDENCIA Y QUE NO ───────────────────────────────────────────

El sistema ya sabe lo que no cuadra: 2.186 huecos donde el WMS se contradice consigo
mismo, más lo que encuentre la reconciliación de cada inspección. Lo que no tenía es
memoria de qué se hizo con eso.

Una incidencia es un descuadre con nombre, dueño y estado. **No es una corrección del
inventario**: cerrarla registra que una persona fue al pasillo y decidió algo, no
cambia el stock. El WMS sigue siendo el sistema de origen (ADR-009 §3.4).

── LOS PERMISOS ─────────────────────────────────────────────────────────────

    incidents:read    ver la bandeja y el historial   · los cinco roles
    incidents:write   abrir, asignar, cambiar estado  · quien pisa el almacen

`viewer` y `auditor` no escriben: quien audita no debe poder fabricar lo que audita.
Misma regla que en 0069 y 0073.

── EL ALMACEN NO SE VALIDA AQUI ─────────────────────────────────────────────

Lo hace RLS, con la política `solo_su_almacen` que llama a `core.can_access_warehouse()`
—la MISMA función que usa el resto del sistema—. Un operario con acceso solo a OLO-CR
no ve ni cierra las incidencias de otro almacén, y no porque este archivo se acuerde.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query, status

from olo.api.deps import CurrentContext, Db, require
from olo.api.v1.incident_schemas import (
    IncidentAssignIn,
    IncidentCreateIn,
    IncidentEventOut,
    IncidentOut,
    IncidentStatusIn,
    IncidentTrayOut,
)
from olo.api.v1.schemas import Envelope
from olo.repositories import identity
from olo.services.incidents import IncidentService

router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get(
    "",
    response_model=Envelope[IncidentTrayOut],
    dependencies=[require("incidents:read")],
    summary="La bandeja de incidencias de un almacen",
)
async def tray(
    db: Db,
    ctx: CurrentContext,
    warehouse_id: Annotated[UUID, Query(description="El almacén cuyas incidencias se piden")],
    incident_status: Annotated[
        Literal["open", "in_progress", "resolved", "dismissed"] | None,
        Query(alias="status", description="Acota a un estado. Sin él, todas."),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> Envelope[IncidentTrayOut]:
    """Lo más VIEJO primero, al revés que casi todas las listas del producto.

    Una incidencia de hace tres semanas es peor que una de esta mañana: lleva tres
    semanas sin que nadie la toque. Ordenar por «más reciente» la entierra justo cuando
    más urge.

    Los recuentos salen del TOTAL y la lista está acotada: contar las filas de la
    pantalla daría un número menor que el real y nadie lo notaría.
    """
    datos = await IncidentService(db, ctx).bandeja(
        warehouse_id, estado=incident_status, limite=limit
    )
    return Envelope[IncidentTrayOut](data=IncidentTrayOut.model_validate(datos))


@router.get(
    "/open-by-location",
    response_model=Envelope[dict[str, str]],
    dependencies=[require("incidents:read")],
    summary="Que huecos ya tienen una incidencia abierta",
)
async def open_by_location(
    db: Db, ctx: CurrentContext, warehouse_id: Annotated[UUID, Query()]
) -> Envelope[dict[str, str]]:
    """`{codigo_de_hueco: id_de_incidencia}`.

    Lo pide la pantalla de inventario para NO ofrecer «abrir incidencia» donde ya la
    hay. Sin esto, el botón invita a un clic que choca contra `uq_incidencia_abierta` y
    devuelve un 409 que nadie esperaba — y que además obliga a buscar a mano cuál era la
    incidencia que ya existía.
    """
    datos = await IncidentService(db, ctx).abiertas_por_ubicacion(warehouse_id)
    return Envelope[dict[str, str]](data=datos)


@router.post(
    "",
    response_model=Envelope[IncidentOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("incidents:write")],
    summary="Abrir una incidencia",
)
async def open_incident(
    db: Db, ctx: CurrentContext, payload: IncidentCreateIn
) -> Envelope[IncidentOut]:
    """Nace en `open` y con su apertura ya anotada en el historial.

    ⚠ Responde **409** si ese hueco ya tiene una abierta por el mismo motivo, y el error
      lleva el id de la que existe para que la interfaz pueda llevar allí en lugar de
      dejar a la persona buscándola en una lista de cientos.
    """
    actor = await identity.fetch_current_user_id(db)
    creada = await IncidentService(db, ctx).abrir(payload.model_dump(), actor=actor)
    return Envelope[IncidentOut](data=IncidentOut.model_validate(creada))


@router.post(
    "/{incident_id}/status",
    response_model=Envelope[IncidentOut],
    dependencies=[require("incidents:write")],
    summary="Mover el estado de una incidencia",
)
async def change_status(
    db: Db, ctx: CurrentContext, incident_id: UUID, payload: IncidentStatusIn
) -> Envelope[IncidentOut]:
    """Idempotente: mover al estado que ya tiene devuelve 200 sin hacer nada.

    ⚠ **Cerrar exige decir qué pasó** (422 sin `note`). Una incidencia resuelta sin
      explicación no sirve de nada dentro de un mes: nadie puede saber si el trabajo se
      hizo. Lo exige también el CHECK `chk_inc_cerrada` del motor.

    ⚠ De `resolved` solo se puede ir a `open`, no a `in_progress`. Una incidencia cerrada
      que vuelve a dar problemas se REABRE, y esa reapertura queda en el historial: es lo
      que delata algo que se arregla mal una y otra vez.
    """
    actor = await identity.fetch_current_user_id(db)
    datos = await IncidentService(db, ctx).cambiar_estado(
        incident_id, nuevo=payload.to_status, nota=payload.note, actor=actor
    )
    return Envelope[IncidentOut](data=IncidentOut.model_validate(datos))


@router.put(
    "/{incident_id}/assignee",
    response_model=Envelope[IncidentOut],
    dependencies=[require("incidents:write")],
    summary="Asignar la incidencia a alguien, o quitarle el dueno",
)
async def assign(
    db: Db, ctx: CurrentContext, incident_id: UUID, payload: IncidentAssignIn
) -> Envelope[IncidentOut]:
    """`user_id: null` la deja sin dueño. También se anota en el historial: «¿quién se lo
    dio a quién?» es de las primeras preguntas cuando algo lleva semanas parado."""
    actor = await identity.fetch_current_user_id(db)
    datos = await IncidentService(db, ctx).asignar(incident_id, payload.user_id, actor=actor)
    return Envelope[IncidentOut](data=IncidentOut.model_validate(datos))


@router.get(
    "/{incident_id}/events",
    response_model=Envelope[list[IncidentEventOut]],
    dependencies=[require("incidents:read")],
    summary="El historial de una incidencia",
)
async def events(
    db: Db, ctx: CurrentContext, incident_id: UUID
) -> Envelope[list[IncidentEventOut]]:
    """Quién hizo qué y cuándo. **No se puede editar ni borrar**: no hay endpoint, y
    tampoco GRANT de UPDATE ni DELETE sobre `incidents.events`. Un registro de quién
    cerró qué que se pueda reescribir no es un registro."""
    filas = await IncidentService(db, ctx).historial(incident_id)
    return Envelope[list[IncidentEventOut]](
        data=[IncidentEventOut.model_validate(f) for f in filas]
    )
