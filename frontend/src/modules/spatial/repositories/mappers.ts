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
  WarehouseOption,
} from '../types/index';
import type {
  FloorPlanCellDto,
  LocationDto,
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
