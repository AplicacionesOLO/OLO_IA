"""Endpoints del inventario y la ocupación.

── SOLO LECTURA, Y NO POR FALTA DE TIEMPO ───────────────────────────────────

El WMS es el sistema de origen y esto es su espejo (ADR-009 §3.4). La única escritura
del inventario es importar una foto nueva, y eso lo hace
`tools/import_inventory_snapshot.py` por fuera de la API: con el hash del archivo, un
snapshot en estado `loading` hasta que termina, y todo en una transacción.

Un endpoint que permitiera «corregir» una cantidad crearía una segunda verdad sobre lo
que hay en un hueco, y la de este lado sería la equivocada: el operario que va al
pasillo y cuenta lo que hay no está corrigiendo el inventario, está OBSERVANDO —y eso
tiene su propio sitio en 0067—.

── PERMISO ──────────────────────────────────────────────────────────────────

`inventory:read`, que ya existe desde 0013 y ya está asignado a los cinco roles. No
hace falta uno nuevo: leer la ocupación es leer inventario.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query, status

from olo.api.deps import CurrentContext, Db, require
from olo.api.v1.schemas import (
    ClusterCreateIn,
    ClusterMemberIn,
    ClusterMemberOut,
    ClusterOut,
    Envelope,
    FindOut,
    InventorySummaryOut,
    LocationContentOut,
    LocationOccupancyOut,
    MismatchReportOut,
    RackOccupancyListOut,
    SnapshotHistoryOut,
    ZoneOut,
)
from olo.repositories import identity
from olo.services.inventory import InventoryService

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get(
    "/warehouses/{warehouse_id}/summary",
    response_model=Envelope[InventorySummaryOut],
    dependencies=[require("inventory:read")],
    summary="Ocupación del almacén, con la foto de la que sale",
)
async def inventory_summary(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[InventorySummaryOut]:
    """`snapshot: null` cuando nadie ha importado inventario.

    NO es un 404: el explorador necesita distinguir «nadie lo ha subido» de «no puedo
    leerlo», y un almacén sin inventario está perfectamente sano.
    """
    datos = await InventoryService(db, ctx).summary(warehouse_id)
    return Envelope[InventorySummaryOut](data=InventorySummaryOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/snapshots",
    response_model=Envelope[list[SnapshotHistoryOut]],
    dependencies=[require("inventory:read")],
    summary="Histórico de fotos del inventario, lo más reciente primero",
)
async def inventory_snapshots(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[list[SnapshotHistoryOut]]:
    """Incluye las importaciones que FALLARON, a propósito.

    Alguien lo intentó y no salió: esconderlo haría que repitiera el intento sin saber
    que ya había fallado antes.
    """
    filas = await InventoryService(db, ctx).snapshots(warehouse_id)
    return Envelope[list[SnapshotHistoryOut]](
        data=[SnapshotHistoryOut.model_validate(f) for f in filas]
    )


@router.get(
    "/warehouses/{warehouse_id}/rack-occupancy",
    response_model=Envelope[RackOccupancyListOut],
    dependencies=[require("inventory:read")],
    summary="Ocupación por rack: alimenta el mapa de calor y el color del visor 3D",
)
async def rack_occupancy(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[RackOccupancyListOut]:
    """Los 347 racks, sin paginar, y es correcto.

    El mapa de calor los necesita TODOS para colorear: paginar obligaría a pintar el
    almacén por trozos, y un mapa a medias colorea de «vacío» lo que aún no ha llegado.
    Son 347 filas agregadas en la base, no las 29.312 ubicaciones.
    """
    datos = await InventoryService(db, ctx).rack_occupancy(warehouse_id)
    return Envelope[RackOccupancyListOut](data=RackOccupancyListOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/location-occupancy",
    response_model=Envelope[list[LocationOccupancyOut]],
    dependencies=[require("inventory:read")],
    summary="Ocupación hueco a hueco, acotada por rack",
)
async def location_occupancy(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    rack_id: Annotated[UUID | None, Query(description="Acota a un rack")] = None,
    occupied: Annotated[
        bool | None, Query(description="`true` solo ocupadas, `false` solo libres")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> Envelope[list[LocationOccupancyOut]]:
    """Incluye los huecos LIBRES, que son la mitad del dato.

    Parte del catálogo y no del stock: partiendo del stock solo se verían los huecos
    llenos, y «¿qué queda libre?» no tendría respuesta.
    """
    filas = await InventoryService(db, ctx).location_occupancy(
        warehouse_id, rack_id=rack_id, occupied=occupied, limit=limit
    )
    return Envelope[list[LocationOccupancyOut]](
        data=[LocationOccupancyOut.model_validate(f) for f in filas]
    )


@router.get(
    "/warehouses/{warehouse_id}/locations/{location_id}/content",
    response_model=Envelope[LocationContentOut],
    dependencies=[require("inventory:read")],
    summary="Qué hay en un hueco, según la foto vigente",
)
async def location_content(
    warehouse_id: UUID, location_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[LocationContentOut]:
    """`lines: []` significa vacío; un uuid que no existe da 404.

    Distinguirlos importa: sin el 404, quien consulta no sabría si el hueco está libre
    o si se equivocó de identificador.
    """
    datos = await InventoryService(db, ctx).location_content(warehouse_id, location_id)
    return Envelope[LocationContentOut](data=LocationContentOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/find",
    response_model=Envelope[FindOut],
    dependencies=[require("inventory:read")],
    summary="Buscar un pallet o un artículo en el almacén",
)
async def find_stock(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    pallet: Annotated[str | None, Query(description="Código del pallet")] = None,
    sku: Annotated[str | None, Query(description="Código del artículo")] = None,
) -> Envelope[FindOut]:
    """Es la consulta del pasillo: «¿dónde está esto?».

    Uno de los dos parámetros, no los dos: «el pallet X del artículo Y» es una
    intersección que nadie pide, y aceptarla obligaría a decidir qué significa que no
    coincidan.
    """
    datos = await InventoryService(db, ctx).find(warehouse_id, pallet=pallet, sku=sku)
    return Envelope[FindOut](data=FindOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/mismatches",
    response_model=Envelope[MismatchReportOut],
    dependencies=[require("inventory:read")],
    summary="Descuadres del WMS: se contradice consigo mismo",
)
async def mismatches(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    kind: Annotated[
        Literal["dice_ocupado_sin_stock", "dice_libre_con_stock", "bloqueado_con_stock"]
        | None,
        Query(description="Acota la LISTA a una clase. Los recuentos siguen siendo del total."),
    ] = None,
    zone: Annotated[
        str | None,
        Query(
            max_length=24,
            description="Prefijo de nomenclatura: acota a una zona («RCL», «CANT»...)",
        ),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Envelope[MismatchReportOut]:
    """Huecos que el WMS dice ocupados sin stock, libres con stock, o bloqueados con
    carga; más las líneas cuyo código de ubicación no existe en el catálogo.

    Medido en el almacén real: 1.178 + 716 + 292 descuadres y 773 líneas huérfanas. Es
    el tipo de dato que nadie mira hasta que algo no cuadra, y entonces hay que poder
    mirarlo sin escribir una consulta.

    `counts` sale del TOTAL y `listed` está acotada: contar la lista daría un número
    menor que el real y nadie lo notaría.

    ⚠ `kind` no es un lujo. Sin él, `ORDER BY mismatch` + el tope de la lista se llevan
      las 200 filas de UNA sola clase —`bloqueado_con_stock`, que va primera por
      alfabeto— y las otras dos no aparecen nunca. Medido: el recuento decía 716 «libre
      con stock» y filtrar en el cliente sobre lo listado daba CERO. Filtrar por arriba
      solo funciona si se le pide al motor.
    """
    datos = await InventoryService(db, ctx).mismatches(
        warehouse_id, clase=kind, pagina=page, por_pagina=page_size, prefijo=zone
    )
    return Envelope[MismatchReportOut](data=MismatchReportOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/zones",
    response_model=Envelope[list[ZoneOut]],
    dependencies=[require("inventory:read")],
    summary="Las zonas por nomenclatura del codigo de rack",
)
async def zones(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[list[ZoneOut]]:
    """Agrupa los racks por el prefijo alfabetico de su codigo: `RCL`, `CANT`, `MZ`...

    ⚠ El reparto real esta MUY sesgado. Medido en OLO-CR: `RCL` son 209 racks y 27.090
      huecos —el 92 % del almacen— y de los otros 41 prefijos la mayoria tiene UNO.

      O sea que esto sirve para la vista gruesa y para acotar busquedas, pero no
      describe las zonas de trabajo reales. Trocear RCL en pasillos es lo que hacen los
      clusters que define una persona.
    """
    filas = await InventoryService(db, ctx).zonas(warehouse_id)
    return Envelope[list[ZoneOut]](data=[ZoneOut.model_validate(f) for f in filas])


# ══════════════════════════════════════════════════════════════════════════════
# ZONAS DEFINIDAS A MANO
#
# Agrupar por nomenclatura sale gratis pero no describe el almacen: `RCL` son 27.090
# de los 29.312 huecos. Estas son las zonas que dibuja alguien que conoce el edificio.
#
# `inventory:zones` para definirlas —lo tienen `tenant_admin` y `warehouse_manager`—
# y `inventory:read` para verlas: quien ve el inventario ve sus zonas.
# ══════════════════════════════════════════════════════════════════════════════


@router.get(
    "/warehouses/{warehouse_id}/clusters",
    response_model=Envelope[list[ClusterOut]],
    dependencies=[require("inventory:read")],
    summary="Las zonas definidas a mano, con su ocupacion",
)
async def clusters(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[list[ClusterOut]]:
    """La ocupacion viene ya sumada y DEDUPLICADA.

    Un rack puede pertenecer a una zona por su prefijo Y estar añadido a mano; contarlo
    dos veces haria que la zona dijera tener mas capacidad de la que hay.
    """
    filas = await InventoryService(db, ctx).clusters(warehouse_id)
    return Envelope[list[ClusterOut]](data=[ClusterOut.model_validate(f) for f in filas])


@router.post(
    "/warehouses/{warehouse_id}/clusters",
    response_model=Envelope[ClusterOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("inventory:zones")],
    summary="Crear una zona",
)
async def create_cluster(
    warehouse_id: UUID, db: Db, ctx: CurrentContext, payload: ClusterCreateIn
) -> Envelope[ClusterOut]:
    """Nace VACIA. Los miembros se añaden despues, uno a uno.

    Crear y llenar en la misma llamada obligaria a decidir que pasa si el tercer miembro
    falla: ¿se queda la zona a medias, o se pierde el trabajo? Vacia es un estado
    legitimo y visible.

    Responde **409** si ya hay una zona con ese nombre en el almacen: dos zonas
    homonimas serian indistinguibles en cualquier lista.
    """
    actor = await identity.fetch_current_user_id(db)
    creada = await InventoryService(db, ctx).crear_cluster(
        warehouse_id, payload.name, payload.notes, actor=actor
    )
    return Envelope[ClusterOut](data=ClusterOut.model_validate(creada))


@router.delete(
    "/clusters/{cluster_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("inventory:zones")],
    summary="Borrar una zona",
)
async def delete_cluster(cluster_id: UUID, db: Db, ctx: CurrentContext) -> None:
    """El catalogo espacial NO se toca. Una zona es una etiqueta encima del almacen:
    quitarla deja el edificio, los racks y los huecos exactamente como estaban."""
    await InventoryService(db, ctx).borrar_cluster(cluster_id)


@router.get(
    "/clusters/{cluster_id}/members",
    response_model=Envelope[list[ClusterMemberOut]],
    dependencies=[require("inventory:read")],
    summary="Que contiene una zona",
)
async def cluster_members(
    cluster_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[list[ClusterMemberOut]]:
    filas = await InventoryService(db, ctx).miembros(cluster_id)
    return Envelope[list[ClusterMemberOut]](
        data=[ClusterMemberOut.model_validate(f) for f in filas]
    )


@router.post(
    "/clusters/{cluster_id}/members",
    response_model=Envelope[list[ClusterMemberOut]],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("inventory:zones")],
    summary="Añadir un prefijo o un rack a la zona",
)
async def add_cluster_member(
    cluster_id: UUID, db: Db, ctx: CurrentContext, payload: ClusterMemberIn
) -> Envelope[list[ClusterMemberOut]]:
    """Un prefijo O un rack, nunca los dos.

    Los dos hacen falta y por motivos distintos: el PREFIJO sobrevive a que se añadan
    racks nuevos —un CANT9 que se dé de alta mañana entra solo— y el RACK suelto es la
    unica forma de trocear `RCL`, donde el prefijo no distingue nada.

    Con los dos rellenos no se sabria si la zona incluye ese rack o todos los de su
    prefijo, asi que se rechaza con 422.
    """
    filas = await InventoryService(db, ctx).anadir_miembro(
        cluster_id, prefijo=payload.prefix, rack_id=payload.rack_id
    )
    return Envelope[list[ClusterMemberOut]](
        data=[ClusterMemberOut.model_validate(f) for f in filas]
    )


@router.delete(
    "/clusters/{cluster_id}/members/{member_id}",
    response_model=Envelope[list[ClusterMemberOut]],
    dependencies=[require("inventory:zones")],
    summary="Quitar algo de la zona",
)
async def remove_cluster_member(
    cluster_id: UUID, member_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[list[ClusterMemberOut]]:
    filas = await InventoryService(db, ctx).quitar_miembro(cluster_id, member_id)
    return Envelope[list[ClusterMemberOut]](
        data=[ClusterMemberOut.model_validate(f) for f in filas]
    )
