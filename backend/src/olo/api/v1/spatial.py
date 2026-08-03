"""Endpoints del explorador espacial. SOLO LECTURA.

El catálogo espacial se escribe por importador transaccional y auditado
(`spatial.import_batches`), no por API: 29.310 ubicaciones creadas de una en una
por HTTP no serían ni idempotentes ni auditables. Cuando exista la edición manual
de una ubicación será un endpoint aparte, con su propio permiso de escritura.

── Permisos ────────────────────────────────────────────────────────────────
Se reutilizan `areas:read` (estructura: resumen, árbol, nodos, plano, alzado) y
`locations:read` (ubicaciones). No se crea un `spatial:read` nuevo porque los dos
existen ya y están asignados a los mismos cinco roles del sistema; añadir un
permiso obligaría a una migración de permisos y a reasignar roles para no ganar
nada. La separación entre estructura y ubicaciones sí es significativa para un rol
personalizado que quiera ver el plano sin ver el detalle.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from olo.api.deps import CurrentContext, Db, require
from olo.api.v1.schemas import (
    Envelope,
    FloorPlanCellOut,
    LocationOut,
    PagedEnvelope,
    PageMeta,
    RackFrontViewOut,
    SpatialNodeOut,
    SpatialTreeNodeOut,
    WarehouseSpatialSummaryOut,
)
from olo.services.spatial import (
    DEFAULT_PAGE_SIZE,
    DEFAULT_TREE_DEPTH,
    MAX_PAGE_SIZE,
    MAX_TREE_DEPTH,
    Page,
    SpatialService,
)

router = APIRouter(prefix="/spatial", tags=["spatial"])


def _meta(page: Page, size: int) -> PageMeta:
    return PageMeta(
        next_cursor=page.next_cursor,
        page_size=size,
        page=page.page,
        total=page.total,
        total_pages=page.total_pages,
    )


# ── 1 · Almacenes con datos espaciales ─────────────────────────────────────
@router.get(
    "/warehouses",
    response_model=Envelope[list[WarehouseSpatialSummaryOut]],
    dependencies=[require("areas:read")],
    summary="Almacenes con su resumen espacial",
)
async def list_spatial_warehouses(
    db: Db, ctx: CurrentContext
) -> Envelope[list[WarehouseSpatialSummaryOut]]:
    """Un KPI por almacén accesible.

    Sin paginar: son decenas de filas por tenant, y el selector de almacén las
    necesita todas para poder ofrecerlas. Devolver un almacén sin importar (con
    todos los recuentos a cero y `last_import_at` nulo) es deliberado: el cliente
    debe poder distinguir «vacío» de «no existe».
    """
    filas = await SpatialService(db, ctx).list_summaries()
    return Envelope[list[WarehouseSpatialSummaryOut]](
        data=[WarehouseSpatialSummaryOut.model_validate(f) for f in filas]
    )


# ── 2 · Resumen de un almacén ──────────────────────────────────────────────
@router.get(
    "/warehouses/{warehouse_id}/summary",
    response_model=Envelope[WarehouseSpatialSummaryOut],
    dependencies=[require("areas:read")],
    summary="Resumen espacial de un almacén",
)
async def get_spatial_summary(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[WarehouseSpatialSummaryOut]:
    fila = await SpatialService(db, ctx).get_summary(warehouse_id)
    return Envelope[WarehouseSpatialSummaryOut](
        data=WarehouseSpatialSummaryOut.model_validate(fila)
    )


# ── 3 · Árbol ──────────────────────────────────────────────────────────────
@router.get(
    "/warehouses/{warehouse_id}/tree",
    response_model=Envelope[list[SpatialTreeNodeOut]],
    dependencies=[require("areas:read")],
    summary="Árbol de nodos de un almacén, por niveles",
)
async def get_spatial_tree(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    depth: Annotated[int, Query(ge=0, le=MAX_TREE_DEPTH)] = DEFAULT_TREE_DEPTH,
    parent_id: Annotated[UUID | None, Query()] = None,
) -> Envelope[list[SpatialTreeNodeOut]]:
    """Subárbol desde las raíces, o desde `parent_id`, hasta `depth` niveles.

    `depth` está acotado a propósito: el almacén real tiene 347 racks y 2.701
    cuerpos, así que un árbol completo son 3.048 nodos. Con `depth=0` se obtienen
    solo las raíces —347 filas, 4,7 ms— y `child_count` en cada una dice si vale
    la pena expandirla, sin una petición extra para averiguarlo.
    """
    filas = await SpatialService(db, ctx).get_tree(
        warehouse_id, depth=depth, parent_id=parent_id
    )
    return Envelope[list[SpatialTreeNodeOut]](
        data=[SpatialTreeNodeOut.model_validate(f) for f in filas]
    )


# ── 4 · Plano de planta ────────────────────────────────────────────────────
@router.get(
    "/warehouses/{warehouse_id}/floor-plan",
    response_model=PagedEnvelope[FloorPlanCellOut],
    dependencies=[require("areas:read")],
    summary="Plano agregado: una fila por rack",
)
async def get_floor_plan(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = MAX_PAGE_SIZE,
    cursor: Annotated[str | None, Query()] = None,
    node_function: Annotated[str | None, Query(max_length=40)] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=40)] = None,
    with_total: Annotated[bool, Query()] = False,
) -> PagedEnvelope[FloorPlanCellOut]:
    """347 filas en lugar de 29.310: el plano no descarga el catálogo.

    `search` busca por PREFIJO de `rack_code` o `rack_external_code`. No es
    «contiene»: con un comodín por delante el índice no se usa y la consulta pasa
    a recorrer la tabla entera. Buscar por substring necesitaría un índice GIN
    con `pg_trgm`, que no está instalado en este proyecto.
    """
    pagina = await SpatialService(db, ctx).get_floor_plan(
        warehouse_id,
        limit=limit,
        cursor=cursor,
        node_function=node_function,
        search=search,
        with_total=with_total,
    )
    return PagedEnvelope[FloorPlanCellOut](
        data=[FloorPlanCellOut.model_validate(f) for f in pagina.items],
        pagination=_meta(pagina, limit),
    )


# ── 5 · Un nodo ────────────────────────────────────────────────────────────
@router.get(
    "/nodes/{node_id}",
    response_model=Envelope[SpatialNodeOut],
    dependencies=[require("areas:read")],
    summary="Obtener un nodo",
)
async def get_node(
    node_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[SpatialNodeOut]:
    fila = await SpatialService(db, ctx).get_node(node_id)
    return Envelope[SpatialNodeOut](data=SpatialNodeOut.model_validate(fila))


# ── 6 · Hijos de un nodo ───────────────────────────────────────────────────
@router.get(
    "/nodes/{node_id}/children",
    response_model=PagedEnvelope[SpatialNodeOut],
    dependencies=[require("areas:read")],
    summary="Hijos directos de un nodo",
)
async def get_node_children(
    node_id: UUID,
    db: Db,
    ctx: CurrentContext,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = MAX_PAGE_SIZE,
    cursor: Annotated[str | None, Query()] = None,
    with_total: Annotated[bool, Query()] = False,
) -> PagedEnvelope[SpatialNodeOut]:
    """Expansión perezosa del árbol: un nivel por petición."""
    pagina = await SpatialService(db, ctx).get_children(
        node_id, limit=limit, cursor=cursor, with_total=with_total
    )
    return PagedEnvelope[SpatialNodeOut](
        data=[SpatialNodeOut.model_validate(f) for f in pagina.items],
        pagination=_meta(pagina, limit),
    )


# ── 7 · Alzado de un rack ──────────────────────────────────────────────────
@router.get(
    "/racks/{rack_id}/front-view",
    response_model=Envelope[RackFrontViewOut],
    dependencies=[require("areas:read")],
    summary="Alzado de un rack: cuerpo x nivel x posición",
)
async def get_rack_front_view(
    rack_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[RackFrontViewOut]:
    """Todas las celdas del alzado, con las dimensiones ya calculadas.

    Sin paginar a propósito: el rack más poblado del catálogo real tiene 486
    huecos, y un alzado partido en páginas no es un alzado. `bay_count`,
    `max_level` y `max_position` vienen resueltos para que el cliente dimensione
    la rejilla antes de recorrer las celdas.
    """
    datos = await SpatialService(db, ctx).get_rack_front_view(rack_id)
    return Envelope[RackFrontViewOut](data=RackFrontViewOut.model_validate(datos))


# ── 8 · Ubicaciones ────────────────────────────────────────────────────────
@router.get(
    "/locations",
    response_model=PagedEnvelope[LocationOut],
    dependencies=[require("locations:read")],
    summary="Listar ubicaciones, paginadas y filtradas",
)
async def list_locations(
    db: Db,
    ctx: CurrentContext,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query()] = None,
    page: Annotated[int | None, Query(ge=1)] = None,
    warehouse_id: Annotated[UUID | None, Query()] = None,
    rack_id: Annotated[UUID | None, Query()] = None,
    bay_id: Annotated[UUID | None, Query()] = None,
    status_filter: Annotated[str | None, Query(alias="status", max_length=20)] = None,
    situation: Annotated[str | None, Query(max_length=12)] = None,
    code_form: Annotated[str | None, Query(max_length=12)] = None,
    level: Annotated[int | None, Query(ge=1, le=99)] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=60)] = None,
    with_total: Annotated[bool, Query()] = False,
) -> PagedEnvelope[LocationOut]:
    """Contrato plano: el cliente no parsea `full_code` para nada.

    DOS formas de paginar, y no se pueden mezclar:
      • `cursor` — la correcta para recorrer. Su coste no crece con la
        profundidad: 166 ms en la página 1 y 166 ms en la 200.
      • `page` — para una tabla que necesita «página 7 de 294». Usa `OFFSET`, así
        que se degrada con la profundidad (245 ms en `OFFSET 20000`) y está
        acotada a 10.000 para que nadie pida un `OFFSET` de mil millones.

    `with_total` es opt-in porque el `count` exacto cuesta una consulta más. Sin
    él, `total` y `total_pages` llegan como `null`, que significa «no se contó» y
    no «no hay nada».
    """
    pagina = await SpatialService(db, ctx).list_locations(
        limit=limit,
        cursor=cursor,
        page=page,
        warehouse_id=warehouse_id,
        rack_id=rack_id,
        bay_id=bay_id,
        status=status_filter,
        situation=situation,
        code_form=code_form,
        level=level,
        search=search,
        with_total=with_total,
    )
    return PagedEnvelope[LocationOut](
        data=[LocationOut.model_validate(f) for f in pagina.items],
        pagination=_meta(pagina, limit),
    )


# ── 9 · Una ubicación ──────────────────────────────────────────────────────
@router.get(
    "/locations/{location_id}",
    response_model=Envelope[LocationOut],
    dependencies=[require("locations:read")],
    summary="Obtener una ubicación",
)
async def get_location(
    location_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[LocationOut]:
    datos = await SpatialService(db, ctx).get_location(location_id)
    return Envelope[LocationOut](data=LocationOut.model_validate(datos))
