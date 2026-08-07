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

from fastapi import APIRouter, Query

from olo.api.deps import CurrentContext, Db, require
from olo.api.v1.schemas import (
    Envelope,
    FindOut,
    InventorySummaryOut,
    LocationContentOut,
    LocationOccupancyOut,
    MismatchReportOut,
    RackOccupancyListOut,
    SnapshotHistoryOut,
)
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
    summary="Lo que el WMS no cuadra consigo mismo",
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
    datos = await InventoryService(db, ctx).mismatches(warehouse_id, clase=kind)
    return Envelope[MismatchReportOut](data=MismatchReportOut.model_validate(datos))
