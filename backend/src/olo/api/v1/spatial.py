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

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from olo.api.deps import AccessToken, AppSettings, CurrentContext, Db, require
from olo.api.v1.schemas import (
    AssetInstanceOut,
    AssetMoveIn,
    AssetOut,
    AssetPlaceIn,
    AssetPrepareIn,
    AssetPrepareOut,
    AssetRegisterIn,
    CoverageOut,
    Envelope,
    FloorPlanCellOut,
    IngestOut,
    InspectionChangeOut,
    InspectionCoverageOut,
    LayoutOut,
    LayoutPublishIn,
    LocationInspectionOut,
    LocationOut,
    ObservationBatchIn,
    ObservationOut,
    ObservationSourceOut,
    PagedEnvelope,
    PageMeta,
    RackFrontViewOut,
    RoutesOut,
    SpatialNodeOut,
    SpatialTreeNodeOut,
    WarehouseMetricsIn,
    WarehouseMetricsOut,
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
from olo.services.spatial_layout import SpatialLayoutService
from olo.services.spatial_observations import SpatialObservationService

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


@router.get(
    "/warehouses/{warehouse_id}/inspection",
    response_model=Envelope[list[LocationInspectionOut]],
    dependencies=[require("areas:read")],
    summary="Lo último que se vio en cada hueco, frente a lo que el WMS declara",
)
async def get_warehouse_inspection(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    settings: AppSettings,
    token: AccessToken,
    rack_id: Annotated[UUID | None, Query(description="Solo los huecos de ese rack")] = None,
) -> Envelope[list[LocationInspectionOut]]:
    """La capa «Inspección» del visor, que hasta ahora no tenía de dónde salir.

    ── POR QUÉ ESTÁ EN `spatial` Y NO EN `perception` ────────────────────────

    Percepción ya devuelve la reconciliación, pero POR RECORRIDO: «esto vio el vuelo del
    martes». Esta pregunta es otra y es la que hace el mapa: «¿qué se sabe HOY de cada
    hueco de este almacén?». La respuesta cruza recorridos —cada hueco con el suyo más
    reciente— y se indexa por ubicación, que es como el visor pinta.

    Sin paginar, por el mismo motivo que el alzado: un mapa a medio colorear miente más
    que uno vacío. Solo devuelve huecos CON lectura, así que su tamaño lo marca lo
    inspeccionado y no las 29.310 ubicaciones del catálogo.

    Exige `areas:read` y no `inventory:read`: esto no afirma stock, describe lo que una
    cámara vio de una estantería. Quien puede ver el mapa puede ver esto.
    """
    #  Con credenciales de Storage: hacen falta para FIRMAR los recortes. Sin ellas la
    #  capa sigue funcionando, solo que sin imagenes.
    filas = await SpatialService(db, ctx, settings, token).get_estado_observado(
        warehouse_id, rack_id
    )
    return Envelope[list[LocationInspectionOut]](
        data=[LocationInspectionOut.model_validate(f) for f in filas]
    )


@router.get(
    "/warehouses/{warehouse_id}/inspection/coverage",
    response_model=Envelope[InspectionCoverageOut],
    dependencies=[require("areas:read")],
    summary="Cuánto del almacén se ha inspeccionado, y cuándo",
)
async def get_inspection_coverage(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[InspectionCoverageOut]:
    """El número que impide leer el silencio como salud.

    Cero discrepancias significa «todo cuadra» o «no has mirado», y son la conclusión
    contraria. Esto separa las dos: medido hoy, 4 huecos con lectura de 29.312.

    Va con la FECHA porque un almacén inspeccionado al 100 % hace tres meses no está
    inspeccionado, está fotografiado.
    """
    datos = await SpatialService(db, ctx).get_cobertura_inspeccion(warehouse_id)
    return Envelope[InspectionCoverageOut](
        data=InspectionCoverageOut.model_validate(datos)
    )


@router.get(
    "/warehouses/{warehouse_id}/inspection/changes",
    response_model=Envelope[list[InspectionChangeOut]],
    dependencies=[require("areas:read")],
    summary="Qué cambió entre el último recorrido y el anterior",
)
async def get_inspection_changes(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    rack_id: Annotated[UUID | None, Query(description="Solo los huecos de ese rack")] = None,
) -> Envelope[list[InspectionChangeOut]]:
    """La memoria del producto: sin esto cada recorrido es una foto suelta.

    Devuelve solo los huecos vistos en DOS recorridos distintos y donde algo cambió —o
    donde sigue sin cuadrar, que es el caso que nadie mide y el que más dice: una
    discrepancia que aguanta tres vuelos no es un hallazgo, es un proceso roto—.
    """
    filas = await SpatialService(db, ctx).get_cambios_inspeccion(warehouse_id, rack_id)
    return Envelope[list[InspectionChangeOut]](
        data=[InspectionChangeOut.model_validate(f) for f in filas]
    )


# ── 7 ter · Data Almacén: las medidas reales ──────────────────────────────
@router.get(
    "/warehouses/{warehouse_id}/metrics",
    response_model=Envelope[list[WarehouseMetricsOut]],
    dependencies=[require("areas:read")],
    summary="Las medidas reales del almacén, y las excepciones por familia",
)
async def get_warehouse_metrics(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[list[WarehouseMetricsOut]]:
    """Lo que separa un dibujo proporcionado de un modelo a escala.

    Devuelve la fila por defecto DELANTE y luego las excepciones por familia. Vacío
    significa que nadie ha medido nada todavía, y el visor lo dice cuando dibuja.
    """
    filas = await SpatialService(db, ctx).get_medidas(warehouse_id)
    return Envelope[list[WarehouseMetricsOut]](
        data=[WarehouseMetricsOut.model_validate(f) for f in filas]
    )


@router.put(
    "/warehouses/{warehouse_id}/metrics",
    response_model=Envelope[WarehouseMetricsOut],
    dependencies=[require("areas:write")],
    summary="Medir: crear o corregir las medidas de un ámbito",
)
async def put_warehouse_metrics(
    warehouse_id: UUID, cuerpo: WarehouseMetricsIn, db: Db, ctx: CurrentContext
) -> Envelope[WarehouseMetricsOut]:
    """PUT y no PATCH aunque sea parcial, porque el ÁMBITO es idempotente: mandar dos veces
    las medidas de `RCL` corrige, no crea una segunda fila.

    Solo se tocan los campos presentes: exigir el objeto entero obligaría a reenviar las
    trece medidas para corregir una, y el primer despiste borraría las demás.

    `areas:write` y no `inventory:write`: esto describe el EDIFICIO, no lo que hay dentro.
    """
    fila = await SpatialService(db, ctx).guardar_medidas(
        warehouse_id, cuerpo.rack_family, cuerpo.medidas()
    )
    return Envelope[WarehouseMetricsOut](data=WarehouseMetricsOut.model_validate(fila))


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


# ── 10 · Layout del plano ──────────────────────────────────────────────────
#
# El resto de este router es de solo lectura porque el catálogo espacial se
# escribe por importador. El layout es la excepción, y la razón es la contraria:
# NADIE puede importarlo. El DWG del almacén no contiene los códigos del WMS —se
# verificó buscando RCL, PURT y CHEQ en el DXF: cero coincidencias—, así que «esta
# hilera del plano es RCL01» solo lo sabe una persona colocándolo.
#
# Permiso: `areas:write`, que ya existe y ya está asignado a los mismos roles que
# `areas:read`. Colocar racks es editar la estructura del almacén.
@router.get(
    "/warehouses/{warehouse_id}/layout",
    response_model=Envelope[LayoutOut],
    dependencies=[require("areas:read")],
    summary="Layout publicado de un almacén, con la colocación de sus racks",
)
async def get_layout(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[LayoutOut]:
    datos = await SpatialLayoutService(db, ctx).get(warehouse_id)
    return Envelope[LayoutOut](data=LayoutOut.model_validate(datos))


@router.put(
    "/warehouses/{warehouse_id}/layout",
    response_model=Envelope[LayoutOut],
    dependencies=[require("areas:write")],
    summary="Publicar el layout completo de un almacén",
)
async def publish_layout(
    warehouse_id: UUID, cuerpo: LayoutPublishIn, db: Db, ctx: CurrentContext
) -> Envelope[LayoutOut]:
    """Reemplaza el layout y TODAS las colocaciones del almacén.

    Es PUT y no PATCH porque el cuerpo es el estado completo: publicar significa
    «el layout de este almacén es este». Enviar un subconjunto borraría el resto,
    y por eso no se acepta un delta.
    """
    datos = await SpatialLayoutService(db, ctx).publish(
        warehouse_id,
        plan_name=cuerpo.plan_name,
        plan_width_px=cuerpo.plan_width_px,
        plan_height_px=cuerpo.plan_height_px,
        pixels_per_meter=cuerpo.pixels_per_meter,
        origin_x_px=cuerpo.origin_x_px,
        origin_y_px=cuerpo.origin_y_px,
        is_calibrated=cuerpo.is_calibrated,
        placements=[p.model_dump() for p in cuerpo.placements],
    )
    return Envelope[LayoutOut](data=LayoutOut.model_validate(datos))


@router.delete(
    "/warehouses/{warehouse_id}/layout",
    status_code=204,
    dependencies=[require("areas:write")],
    summary="Retirar el layout publicado de un almacén",
)
async def delete_layout(warehouse_id: UUID, db: Db, ctx: CurrentContext) -> None:
    await SpatialLayoutService(db, ctx).delete(warehouse_id)


# ── 11 · Observaciones y rutas ─────────────────────────────────────────────
#
# El extremo RECEPTOR de la vision por computador. Un dron, un movil o una camara
# graban el almacen; algo reconoce codigos de rack en los fotogramas; cada
# reconocimiento entra aqui como «la fuente S vio el rack R a las T».
#
# La RUTA no se envia: se DERIVA uniendo las observaciones ordenadas con la
# colocacion en metros de 0065. Por eso este bloque no existia antes de F2: sin la
# colocacion, «vi MZ04» no dice donde estaba nadie.
#
# ── LOS DOS PERMISOS ───────────────────────────────────────────────────────
#
# `observations:write` es NUEVO (0067) y no se reutiliza `areas:write`. Un dron que
# reporta lo que ve no debe poder mover racks: con `areas:write`, la credencial de
# un dispositivo en el pasillo podria reescribir la colocacion de los 347 racks.
@router.get(
    "/warehouses/{warehouse_id}/observation-sources",
    response_model=Envelope[list[ObservationSourceOut]],
    dependencies=[require("observations:read")],
    summary="Fuentes de observacion de un almacen: drones, moviles, camaras",
)
async def list_observation_sources(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[list[ObservationSourceOut]]:
    filas = await SpatialObservationService(db, ctx).list_sources(warehouse_id)
    return Envelope[list[ObservationSourceOut]](
        data=[ObservationSourceOut.model_validate(f) for f in filas]
    )


@router.post(
    "/warehouses/{warehouse_id}/observations",
    response_model=Envelope[IngestOut],
    dependencies=[require("observations:write")],
    summary="Registrar un lote de observaciones de racks",
)
async def ingest_observations(
    warehouse_id: UUID, cuerpo: ObservationBatchIn, db: Db, ctx: CurrentContext
) -> Envelope[IngestOut]:
    """Registra lo que una fuente vio. IDEMPOTENTE.

    Es POST y no PUT porque cada lote AÑADE hechos observados: no reemplaza nada.
    Reintentar un lote entero —lo que hace un dron cuando se le corta la conexion—
    devuelve 200 con `stored: 0` en lugar de duplicar el recorrido, porque la
    unicidad `(fuente, rack, instante)` lo impide.
    """
    datos = await SpatialObservationService(db, ctx).ingest(
        warehouse_id,
        source_code=cuerpo.source_code,
        source_name=cuerpo.source_name,
        source_kind=cuerpo.source_kind,
        observations=[o.model_dump() for o in cuerpo.observations],
    )
    return Envelope[IngestOut](data=IngestOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/routes",
    response_model=Envelope[RoutesOut],
    dependencies=[require("observations:read")],
    summary="Rutas derivadas de las observaciones, una por fuente",
)
async def get_routes(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    source: Annotated[str | None, Query(description="Codigo de la fuente")] = None,
    desde: Annotated[datetime | None, Query(description="Inicio de la ventana")] = None,
    hasta: Annotated[datetime | None, Query(description="Fin de la ventana")] = None,
) -> Envelope[RoutesOut]:
    """Una polilinea POR FUENTE, no una lista plana.

    Aplanarlas dejaria al cliente uniendo el ultimo punto de un dron con el primero
    del siguiente, que es un zigzag que nadie recorrio.
    """
    datos = await SpatialObservationService(db, ctx).routes(
        warehouse_id, source_code=source, desde=desde, hasta=hasta
    )
    return Envelope[RoutesOut](data=RoutesOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/observations",
    response_model=Envelope[list[ObservationOut]],
    dependencies=[require("observations:read")],
    summary="Historial de observaciones, lo mas reciente primero",
)
async def list_observations(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    source: Annotated[str | None, Query(description="Codigo de la fuente")] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> Envelope[list[ObservationOut]]:
    """Incluye las observaciones de racks SIN colocar, que no salen en la ruta.

    Es la unica forma de ver esas: la ruta no puede dibujarlas porque no tienen
    punto, y sin este historial desaparecerian sin dejar rastro.
    """
    filas = await SpatialObservationService(db, ctx).observations(
        warehouse_id, source_code=source, limite=limit
    )
    return Envelope[list[ObservationOut]](
        data=[ObservationOut.model_validate(f) for f in filas]
    )


@router.get(
    "/warehouses/{warehouse_id}/observation-coverage",
    response_model=Envelope[CoverageOut],
    dependencies=[require("observations:read")],
    summary="Cuanto del almacen se ha visto, y cuando",
)
async def observation_coverage(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[CoverageOut]:
    datos = await SpatialObservationService(db, ctx).coverage(warehouse_id)
    return Envelope[CoverageOut](data=CoverageOut.model_validate(datos))


@router.delete(
    "/warehouses/{warehouse_id}/observations",
    status_code=204,
    dependencies=[require("observations:write")],
    summary="Borrar las observaciones de una fuente",
)
async def purge_observations(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    source: Annotated[str, Query(description="Codigo de la fuente")],
) -> None:
    """Exige `source`: no hay forma de borrar el historial completo del almacen de
    un tirón. Un vuelo mal reconocido se borra por fuente; borrarlo todo tendria
    que ser una decision deliberada y no un parametro que se olvida."""
    await SpatialObservationService(db, ctx).purge_source(warehouse_id, source)


# ── FIGURAS 3D (0093) ────────────────────────────────────────────────────────


@router.post(
    "/assets/prepare",
    response_model=Envelope[AssetPrepareOut],
    dependencies=[require("areas:write")],
    summary="Reservar sitio en el bucket para subir una figura",
)
async def prepare_asset(
    cuerpo: AssetPrepareIn, db: Db, ctx: CurrentContext,
    settings: AppSettings, token: AccessToken,
) -> Envelope[AssetPrepareOut]:
    """Primer paso de tres: preparar, subir directo, registrar.

    No crea ninguna fila. Una fila de catalogo sin bytes es una figura que sale en el
    selector y no se puede dibujar; si la subida se abandona, mejor que no quede nada.
    """
    datos = await SpatialService(db, ctx, settings, token).preparar_figura(
        original_filename=cuerpo.original_filename,
        content_type=cuerpo.content_type,
        byte_count=cuerpo.bytes,
        para_plataforma=cuerpo.for_platform,
    )
    return Envelope[AssetPrepareOut](data=AssetPrepareOut.model_validate(datos))


@router.post(
    "/assets",
    response_model=Envelope[AssetOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("areas:write")],
    summary="Registrar una figura ya subida",
)
async def register_asset(
    cuerpo: AssetRegisterIn, db: Db, ctx: CurrentContext,
    settings: AppSettings, token: AccessToken,
) -> Envelope[AssetOut]:
    """Tercer paso. Comprueba que el archivo ESTE antes de escribir la fila.

    La ruta se recalcula con el mismo id, nombre y tipo: no se acepta la que mande el
    cliente, porque es la frontera del aislamiento entre operadores.
    """
    datos = await SpatialService(db, ctx, settings, token).registrar_figura(
        model_id=cuerpo.model_id,
        original_filename=cuerpo.original_filename,
        content_type=cuerpo.content_type,
        para_plataforma=cuerpo.for_platform,
        datos=cuerpo.model_dump(
            exclude={"model_id", "original_filename", "content_type", "for_platform"},
            exclude_none=True,
        ),
    )
    return Envelope[AssetOut](data=AssetOut.model_validate(datos))


@router.get(
    "/assets",
    response_model=Envelope[list[AssetOut]],
    dependencies=[require("areas:read")],
    summary="El catalogo de figuras: la biblioteca comun y la propia",
)
async def list_assets(
    db: Db, ctx: CurrentContext, settings: AppSettings, token: AccessToken
) -> Envelope[list[AssetOut]]:
    filas = await SpatialService(db, ctx, settings, token).catalogo_de_figuras()
    return Envelope[list[AssetOut]](data=[AssetOut.model_validate(f) for f in filas])


@router.delete(
    "/assets/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("areas:write")],
    summary="Retirar una figura del catalogo",
)
async def delete_asset(model_id: UUID, db: Db, ctx: CurrentContext) -> Response:
    """Baja LOGICA. Una figura retirada desaparece de los planos que la usaban, sin dejar
    apariciones apuntando a nada, y se puede deshacer."""
    await SpatialService(db, ctx).borrar_del_catalogo(model_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/warehouses/{warehouse_id}/assets",
    response_model=Envelope[list[AssetInstanceOut]],
    dependencies=[require("areas:read")],
    summary="Las figuras colocadas en ese plano",
)
async def list_placed_assets(
    warehouse_id: UUID, db: Db, ctx: CurrentContext,
    settings: AppSettings, token: AccessToken,
) -> Envelope[list[AssetInstanceOut]]:
    filas = await SpatialService(db, ctx, settings, token).figuras_de_almacen(warehouse_id)
    return Envelope[list[AssetInstanceOut]](
        data=[AssetInstanceOut.model_validate(f) for f in filas]
    )


@router.post(
    "/warehouses/{warehouse_id}/assets",
    response_model=Envelope[AssetInstanceOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("areas:write")],
    summary="Colocar una figura en el plano",
)
async def place_asset(
    warehouse_id: UUID, cuerpo: AssetPlaceIn, db: Db, ctx: CurrentContext,
    settings: AppSettings, token: AccessToken,
) -> Envelope[AssetInstanceOut]:
    datos = await SpatialService(db, ctx, settings, token).colocar_figura(
        warehouse_id=warehouse_id,
        model_id=cuerpo.model_id,
        valores=cuerpo.model_dump(exclude={"model_id"}),
    )
    return Envelope[AssetInstanceOut](data=AssetInstanceOut.model_validate(datos))


@router.patch(
    "/assets/instances/{instance_id}",
    response_model=Envelope[AssetInstanceOut],
    dependencies=[require("areas:write")],
    summary="Mover, girar o reetiquetar una figura colocada",
)
async def move_asset(
    instance_id: UUID, cuerpo: AssetMoveIn, db: Db, ctx: CurrentContext,
    settings: AppSettings, token: AccessToken,
) -> Envelope[AssetInstanceOut]:
    datos = await SpatialService(db, ctx, settings, token).mover_figura(
        instance_id=instance_id,
        valores=cuerpo.model_dump(exclude_unset=True),
    )
    return Envelope[AssetInstanceOut](data=AssetInstanceOut.model_validate(datos))


@router.delete(
    "/assets/instances/{instance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("areas:write")],
    summary="Quitar una figura del plano",
)
async def remove_asset(instance_id: UUID, db: Db, ctx: CurrentContext) -> Response:
    await SpatialService(db, ctx).quitar_figura(instance_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
