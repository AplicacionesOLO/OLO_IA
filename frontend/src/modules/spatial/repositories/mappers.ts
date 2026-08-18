/**
 * MAPEADORES — DTO del backend → tipos internos del modulo.
 *
 * Funciones puras, testeables sin red. Si el backend cambia un campo, se corrige
 * aqui y no en doce componentes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOBRE LA VALIDACION
 *
 * La version anterior hacia `VALID_STATUSES.has(x) ? x : 'available'`: un valor
 * desconocido se convertia en `available` **en silencio**. Eso es lo peor
 * posible en un modulo de almacen — una ubicacion bloqueada que se muestra como
 * disponible— y era invisible porque no dejaba rastro.
 *
 * Aqui un vocabulario CERRADO que llega con un valor inesperado lanza
 * `SpatialContractError`. El backend lo protege con un CHECK, asi que si ocurre
 * es que el contrato cambio, y eso hay que verlo, no absorberlo.
 *
 * Un vocabulario ABIERTO —`situation`, `nodeFunction`— pasa tal cual: ahi un
 * valor nuevo es normal, y rechazarlo tumbaria la pantalla por un dato que solo
 * se muestra.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FiguraColocada, FiguraDelCatalogo } from '../figuras';
import { urlDeFigura } from '../figuras';
import type { OcupacionDeHuecos } from '../ocupacion';
import type { ParadaDeRecorrido, Recorrido, RecorridoResumen } from '../simulacion/tipos';
import type { InspectionStatus, LocationInspectionOverlay } from '../inspection';
import type {
  AssetInstanceDto,
  AssetModelDto,
  OccupancyDto,
  TripDto,
  TripListItemDto,
  TripStopDto,
} from './dto';
import type {
  CapacityState,
  CodeForm,
  FloorPlanCell,
  LocationCapacity,
  LocationOrigin,
  LocationStatus,
  Paginated,
  RackFrontCell,
  RackFrontView,
  SpatialLocation,
  SpatialNode,
  SpatialSummary,
  WarehouseMetrics,
  WarehouseOption,
} from '../types/index';
import type {
  FloorPlanCellDto,
  LocationDto,
  LocationInspectionDto,
  PageMetaDto,
  RackFrontCellDto,
  RackFrontViewDto,
  SpatialNodeDto,
  SpatialTreeNodeDto,
  WarehouseSummaryDto,
} from './dto';

/**
 * El backend devolvio algo que el contrato no admite.
 *
 * Es un error distinto de un fallo de red o de permisos: no se arregla
 * reintentando ni volviendo a entrar. Se distingue para que la UI pueda decir
 * «el backend y el frontend no coinciden» en lugar de «error desconocido».
 */
export class SpatialContractError extends Error {
  constructor(
    readonly field: string,
    readonly received: unknown,
    readonly expected: string,
  ) {
    super(
      `Contrato invalido en "${field}": se recibio ${JSON.stringify(received)} ` +
        `y se esperaba ${expected}. El backend y el frontend no coinciden.`,
    );
    this.name = 'SpatialContractError';
  }
}

// ── Vocabularios cerrados ───────────────────────────────────────────────────

const STATUSES = new Set<string>(['available', 'blocked']);
const ORIGINS = new Set<string>(['catalog', 'inferred', 'manual']);
const CODE_FORMS = new Set<string>(['structured', 'opaque']);

function toStatus(v: string, where: string): LocationStatus {
  if (!STATUSES.has(v)) {
    throw new SpatialContractError(`${where}.location_status`, v, 'available | blocked');
  }
  return v as LocationStatus;
}

function toOrigin(v: string, where: string): LocationOrigin {
  if (!ORIGINS.has(v)) {
    throw new SpatialContractError(`${where}.origin`, v, 'catalog | inferred | manual');
  }
  return v as LocationOrigin;
}

function toCodeForm(v: string, where: string): CodeForm {
  if (!CODE_FORMS.has(v)) {
    throw new SpatialContractError(`${where}.code_form`, v, 'structured | opaque');
  }
  return v as CodeForm;
}

/** Los tres estados de capacidad, derivados en un solo sitio. */
function toCapacity(
  maxWeightKg: number | null,
  maxUnits: number | null,
  declaredUnlimited: boolean,
): LocationCapacity {
  let state: CapacityState;
  if (maxWeightKg != null || maxUnits != null) state = 'declared';
  else if (declaredUnlimited) state = 'unlimited';
  else state = 'unknown';
  return { state, maxWeightKg, maxUnits };
}

// ── Almacenes y resumen ─────────────────────────────────────────────────────

export function mapSummary(dto: WarehouseSummaryDto): SpatialSummary {
  return {
    warehouseId: dto.warehouse_id,
    warehouseCode: dto.warehouse_code,
    warehouseName: dto.warehouse_name,
    siteCount: dto.site_count,
    aisleCount: dto.aisle_count,
    rackCount: dto.rack_count,
    bayCount: dto.bay_count,
    locationCount: dto.location_count,
    availableCount: dto.available_count,
    blockedCount: dto.blocked_count,
    inferredCount: dto.inferred_count,
    opaqueCount: dto.opaque_count,
    wmsSituationCounts: dto.wms_situation_counts ?? {},
    statusSituationConflicts: dto.status_situation_conflicts,
    capacityUnlimitedCount: dto.capacity_unlimited_count,
    capacityUnknownCount: dto.capacity_unknown_count,
    withWorldGeometry: dto.with_world_geometry,
    lastImportAt: dto.last_import_at,
    totalRowsRejected: dto.total_rows_rejected,
  };
}

/**
 * El selector se alimenta del MISMO endpoint que el resumen.
 *
 * `hasCatalog` no es `locationCount > 0` por casualidad: un almacen que existe
 * pero no tiene catalogo importado debe poder distinguirse de uno que no existe.
 * El backend devuelve el primero con todos los recuentos a cero y
 * `last_import_at: null`, y eso es deliberado.
 */
export function mapWarehouseOption(dto: WarehouseSummaryDto): WarehouseOption {
  return {
    id: dto.warehouse_id,
    code: dto.warehouse_code,
    name: dto.warehouse_name,
    rackCount: dto.rack_count,
    bayCount: dto.bay_count,
    locationCount: dto.location_count,
    lastImportAt: dto.last_import_at,
    hasCatalog: dto.location_count > 0,
  };
}

// ── Nodos ───────────────────────────────────────────────────────────────────

export function mapNode(dto: SpatialNodeDto): SpatialNode {
  return {
    id: dto.node_id,
    parentId: dto.parent_node_id,
    // `node_type` NO se valida contra un union: el catalogo del backend puede
    // ganar un tipo por migracion, y un tipo nuevo debe aparecer en el arbol en
    // lugar de tumbarlo. `function_label` lo hace legible sin conocerlo.
    nodeType: dto.node_type,
    nodeFunction: dto.node_function,
    functionLabel: dto.function_label,
    code: dto.node_code,
    externalCode: dto.external_code,
    name: dto.name,
    logicalIndex: dto.logical_index,
    siteId: dto.site_id,
    canHoldLocations: dto.can_hold_locations,
    childCount: dto.child_count,
    locationCount: dto.location_count,
  };
}

export function mapTreeNode(dto: SpatialTreeNodeDto): SpatialNode {
  return { ...mapNode(dto), depth: dto.depth };
}

// ── Plano ───────────────────────────────────────────────────────────────────

export function mapFloorPlanCell(dto: FloorPlanCellDto): FloorPlanCell {
  return {
    rackId: dto.rack_id,
    rackCode: dto.rack_code,
    rackExternalCode: dto.rack_external_code,
    rackIndex: dto.rack_index,
    nodeType: dto.rack_node_type,
    nodeFunction: dto.node_function,
    functionLabel: dto.function_label,
    aisleId: dto.aisle_id,
    aisleCode: dto.aisle_code,
    bayCount: dto.bay_count,
    locationCount: dto.location_count,
    availableCount: dto.available_count,
    blockedCount: dto.blocked_count,
    inferredCount: dto.inferred_count,
    bulkCount: dto.bulk_count,
    wmsSituationCounts: dto.wms_situation_counts ?? {},
    statusSituationConflicts: dto.status_situation_conflicts,
    minLogicalX: dto.min_logical_x,
    maxLogicalX: dto.max_logical_x,
    minLogicalY: dto.min_logical_y,
    maxLogicalY: dto.max_logical_y,
    maxLevel: dto.max_level,
  };
}

// ── Alzado ──────────────────────────────────────────────────────────────────

export function mapRackFrontCell(dto: RackFrontCellDto): RackFrontCell {
  return {
    locationId: dto.location_id,
    bayId: dto.bay_id,
    bayCode: dto.bay_code,
    bayIndex: dto.bay_index,
    level: dto.level,
    position: dto.position,
    code: dto.full_code,
    externalCode: dto.external_code,
    status: toStatus(dto.location_status, `rackFrontCell[${dto.full_code}]`),
    situation: dto.location_situation,
    isBulkArea: dto.is_bulk_area,
    origin: toOrigin(dto.origin, `rackFrontCell[${dto.full_code}]`),
    // El alzado no trae `capacity_declared_unlimited`: es un campo del detalle.
    // Sin el, un peso nulo solo se puede reportar como «no informado», y eso es
    // exactamente lo que hace `toCapacity` con `false`. Se prefiere decir menos
    // a decir algo que no se sabe.
    capacity: toCapacity(dto.max_weight_kg, dto.max_units, false),
  };
}

export function mapRackFrontView(dto: RackFrontViewDto): RackFrontView {
  return {
    rackId: dto.rack_id,
    rackCode: dto.rack_code,
    rackExternalCode: dto.rack_external_code,
    nodeFunction: dto.node_function,
    functionLabel: dto.function_label,
    bayCount: dto.bay_count,
    maxLevel: dto.max_level,
    maxPosition: dto.max_position,
    cells: (dto.cells ?? []).map(mapRackFrontCell),
  };
}

// ── Ubicaciones ─────────────────────────────────────────────────────────────

export function mapLocation(dto: LocationDto): SpatialLocation {
  const where = `location[${dto.full_code}]`;
  return {
    id: dto.location_id,
    code: dto.full_code,
    externalCode: dto.external_code,
    externalLocationId: dto.external_location_id,
    codeForm: toCodeForm(dto.code_form, where),

    warehouseId: dto.warehouse_id,
    warehouseCode: dto.warehouse_code,
    siteId: dto.site_id,
    siteCode: dto.site_code,
    aisleId: dto.aisle_id,
    aisleCode: dto.aisle_code,
    rackId: dto.rack_id,
    rackCode: dto.rack_code,
    rackExternalCode: dto.rack_external_code,
    bayId: dto.bay_id,
    bayCode: dto.bay_code,
    bayIndex: dto.bay_index,

    logicalColumn: dto.logical_column,
    logicalLevel: dto.level,
    logicalPosition: dto.position,

    status: toStatus(dto.location_status, where),
    situation: dto.location_situation,
    origin: toOrigin(dto.origin, where),
    isBulkArea: dto.is_bulk_area,

    capacity: toCapacity(
      dto.max_weight_kg,
      dto.max_units,
      dto.capacity_declared_unlimited,
    ),

    nodeFunction: dto.node_function,
    functionLabel: dto.function_label,
    impliesBulk: dto.implies_bulk,

    logicalX: dto.logical_x,
    logicalY: dto.logical_y,
    logicalZ: dto.logical_z,
  };
}

// ── Paginacion ──────────────────────────────────────────────────────────────

/**
 * `total` y `totalPages` se propagan tal cual, incluido el `null`.
 *
 * Poner `0` cuando el backend dice `null` seria mentir con un numero: significan
 * «no se conto» y «no hay nada», y la tabla las pinta distinto.
 */
export function mapPaginated<D, T>(
  data: D[],
  meta: PageMetaDto,
  mapItem: (d: D) => T,
): Paginated<T> {
  return {
    items: data.map(mapItem),
    pageSize: meta.page_size,
    nextCursor: meta.next_cursor ?? null,
    page: meta.page ?? null,
    total: meta.total ?? null,
    totalPages: meta.total_pages ?? null,
  };
}


/**
 * DEL ESTADO OBSERVADO DE UN HUECO A LA CAPA DEL VISOR.
 *
 * ── EL ESTADO SE VALIDA, NO SE CASTEA ─────────────────────────────────────────
 *
 * El backend manda el vocabulario de `v_reconciliation` y el visor pinta con
 * `InspectionStatus`. Se solapan casi del todo, pero «casi» no basta: un `as` dejaria
 * pasar un estado nuevo del backend y `INSPECTION_META[estado]` seria `undefined`, o sea
 * una celda sin color y un fallo en tiempo de ejecucion en el sitio mas lejano posible de
 * la causa.
 *
 * Un estado que el visor no conoce cae en `manual_review` —«lo decide una persona»—, que
 * es lo unico honesto que se puede decir de algo que no se sabe interpretar. `not_scanned`
 * seria peor: afirmaria que no se ha mirado, y si que se miro.
 */
const ESTADOS_DEL_VISOR: ReadonlySet<string> = new Set([
  'not_scanned',
  'scanning',
  'verified_match',
  'verified_empty',
  'unexpected_empty',
  'unexpected_pallet',
  'pallet_without_qr',
  'location_qr_unreadable',
  'duplicate_pallet',
  'obstructed',
  'low_confidence',
  'manual_review',
  'confirmed_manual',
  'error',
]);

export function mapLocationInspection(d: LocationInspectionDto): LocationInspectionOverlay {
  const declarados = d.expected_pallets ?? [];
  return {
    locationId: d.location_id,
    //  Solo hay «el esperado» cuando el WMS declara UNA linea. Con dos, elegir una seria
    //  inventarse cual es la que cuenta.
    expectedPalletCode: declarados.length === 1 ? (declarados[0] as string) : null,
    expectedPalletCodes: declarados,
    observedPalletCode: d.observed_pallet_code,
    inspectionStatus: (ESTADOS_DEL_VISOR.has(d.status)
      ? d.status
      : 'manual_review') as InspectionStatus,
    confidence: d.confidence,
    capturedAt: d.observed_at,
    scanId: d.scan_id,
    frameMs: d.frame_ms ?? null,
    cropLocationMs: d.crop_location_ms ?? null,
    cropContentMs: d.crop_content_ms ?? null,
    cropPalletMs: d.crop_pallet_ms ?? null,
    cropLocationUrl: d.crop_location_url ?? null,
    cropContentUrl: d.crop_content_url ?? null,
    cropPalletUrl: d.crop_pallet_url ?? null,
    rackId: d.rack_id ?? null,
    bayIndex: d.bay_index ?? null,
    level: d.level ?? null,
    position: d.position ?? null,
    status: d.status,
    locationCode: d.location_code,
  };
}

/**
 * De las medidas del backend al contrato del visor.
 *
 * `?? null` en todo: una medida que falta es `null` y no `0`. Un cero es una afirmacion
 * —«este hueco mide cero»— y un rack de altura cero desaparece del visor sin decir por que.
 */
export function mapMetrics(d: Record<string, unknown>): WarehouseMetrics {
  const n = (k: string) => (d[k] == null ? null : Number(d[k]));
  return {
    id: String(d.id),
    warehouseId: String(d.warehouse_id),
    rackFamily: (d.rack_family as string | null) ?? null,
    palletWidthM: n('pallet_width_m'),
    palletDepthM: n('pallet_depth_m'),
    palletHeightM: n('pallet_height_m'),
    slotWidthM: n('slot_width_m'),
    slotHeightM: n('slot_height_m'),
    slotDepthM: n('slot_depth_m'),
    bayWidthM: n('bay_width_m'),
    levelHeightM: n('level_height_m'),
    rackHeightM: n('rack_height_m'),
    rackDepthM: n('rack_depth_m'),
    uprightWidthM: n('upright_width_m'),
    beamHeightM: n('beam_height_m'),
    aisleWidthM: n('aisle_width_m'),
    aisleLengthM: n('aisle_length_m'),
    doubleDeep: (d.double_deep as boolean | null) ?? null,
    notes: (d.notes as string | null) ?? null,
    slotVolumeM3: n('slot_volume_m3'),
    palletVolumeM3: n('pallet_volume_m3'),
    medidasTomadas: Number(d.medidas_tomadas ?? 0),
    updatedAt: String(d.updated_at),
  };
}

// ── FIGURAS 3D ───────────────────────────────────────────────────────────────

export function mapFiguraDelCatalogo(d: AssetModelDto): FiguraDelCatalogo {
  return {
    id: d.id,
    //  `null` es la biblioteca de la PLATAFORMA. Se conserva la distincion porque la
    //  pantalla agrupa por ella: una figura comun no se puede retirar desde aqui.
    tenantId: d.tenant_id ?? null,
    name: d.name,
    kind: d.kind,
    builtinKey: d.builtin_key ?? null,
    //  `glbUrl` es siempre DE DONDE BAJAR EL MODELO, venga del bucket o del proyecto. La
    //  regla vive en el dominio para que ninguna pantalla tenga que preguntarse cual es.
    glbUrl: urlDeFigura(d.glb_url, d.builtin_key),
    thumbUrl: d.thumb_url ?? null,
    byteCount: d.byte_count ?? null,
    sizeXM: d.size_x_m ?? null,
    sizeYM: d.size_y_m ?? null,
    sizeZM: d.size_z_m ?? null,
    scale: d.scale,
    license: d.license,
    attribution: d.attribution ?? null,
    sourceUrl: d.source_url ?? null,
    notes: d.notes ?? null,
    updatedAt: d.updated_at,
  };
}

export function mapFiguraColocada(d: AssetInstanceDto): FiguraColocada {
  return {
    id: d.id,
    warehouseId: d.warehouse_id,
    modelId: d.model_id,
    xM: d.x_m,
    yM: d.y_m,
    zM: d.z_m,
    rotationDeg: d.rotation_deg,
    scale: d.scale,
    label: d.label ?? null,
    notes: d.notes ?? null,
    modelName: d.model_name,
    modelKind: d.model_kind,
    modelScale: d.model_scale,
    modelSizeYM: d.model_size_y_m ?? null,
    builtinKey: d.builtin_key ?? null,
    glbUrl: urlDeFigura(d.glb_url, d.builtin_key),
    thumbUrl: d.thumb_url ?? null,
  };
}

// ── RECORRIDOS ───────────────────────────────────────────────────────────────

export function mapParada(d: TripStopDto): ParadaDeRecorrido {
  return {
    id: d.id,
    tripId: d.trip_id,
    seq: d.seq,
    operation: d.operation,
    dwellS: d.dwell_s,
    locationId: d.location_id,
    locationCode: d.location_code ?? null,
    rackNodeId: d.rack_node_id ?? null,
    bayIndex: d.bay_index ?? null,
    level: d.level ?? null,
    position: d.position ?? null,
  };
}

export function mapRecorrido(d: TripDto): Recorrido {
  return {
    id: d.id,
    warehouseId: d.warehouse_id,
    name: d.name,
    modelId: d.model_id ?? null,
    speedMps: d.speed_mps,
    notes: d.notes ?? null,
    //  Se ordenan aqui tambien, aunque la vista ya venga ordenada: el orden es parte del
    //  dato y no puede depender de que nadie lo altere por el camino.
    stops: (d.stops ?? []).map(mapParada).sort((a, b) => a.seq - b.seq),
    updatedAt: d.updated_at,
  };
}

export function mapRecorridoResumen(d: TripListItemDto): RecorridoResumen {
  return {
    id: d.id,
    warehouseId: d.warehouse_id,
    name: d.name,
    modelId: d.model_id ?? null,
    speedMps: d.speed_mps,
    notes: d.notes ?? null,
    stopCount: d.stop_count,
    updatedAt: d.updated_at,
  };
}

// ── OCUPACION POR HUECO ──────────────────────────────────────────────────────

export function mapOcupacionDeHuecos(d: OccupancyDto): OcupacionDeHuecos {
  return {
    importadoEl: d.imported_at ?? null,
    situaciones: d.situations,
    //  Las celdas NO se transforman: llegan como listas de cinco numeros y se quedan asi.
    //  Convertirlas a objetos aqui deshace en el cliente el ahorro que se hizo en el servidor
    //  —9.673 objetos con cinco claves— y para nada: quien pinta las lee por indice.
    racks: d.racks.map((r) => ({ rackNodeId: r.rack_node_id, celdas: r.cells })),
    celdas: d.cells,
    conflictos: d.conflicts,
    sinCelda: d.without_cell,
  };
}

