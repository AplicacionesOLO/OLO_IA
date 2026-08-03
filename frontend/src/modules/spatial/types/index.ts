/**
 * TIPOS DEL MODULO SPATIAL — capa de UI
 *
 * Alineados con lo que el backend REALMENTE devuelve. La version anterior
 * describia un modelo que no existe, y las tres diferencias importan:
 *
 *   · `LocationStatus` tenia SEIS valores. El vocabulario real del espacio es de
 *     DOS: `available` y `blocked`. `occupied` y `reserved` se retiraron en la
 *     migracion 0052 porque la ocupacion no es una propiedad del estante
 *     (SPA-11/SPA-12); `inferred` es un `origin`, no un estado; `invalid` nunca
 *     existio.
 *   · `capacity` / `occupied` eran un unico numero. El modelo tiene
 *     `maxWeightKg` (kg) y `maxUnits` (piezas), y **solo 2.341 de 29.310
 *     ubicaciones tienen capacidad real**.
 *   · `lastVerifiedAt` y `dimensions` no existen en ninguna forma.
 *
 * Lo que un tipo promete, la UI lo renderiza. Un campo que el backend no puede
 * llenar es un hueco que alguien rellena con un cero.
 */

// ── Vocabularios ────────────────────────────────────────────────────────────

/**
 * Tipos de nodo del arbol. Vocabulario CERRADO del backend, solo cambia por
 * migracion.
 *
 * `aisle` sigue en la lista porque el tipo existe en el catalogo, pero **no hay
 * ni un solo nodo `aisle` en los datos**: no se inventan pasillos (ADR-013).
 * `bay` es el cuerpo del rack, y es donde cuelgan las ubicaciones.
 */
export type NodeType =
  | 'building'
  | 'floor'
  | 'zone'
  | 'aisle'
  | 'rack'
  | 'bay'
  | 'storage_area';

/** Entidad de la UI. Incluye contenedores que no son `node_type`. */
export type SpatialEntityKind = 'warehouse' | 'site' | NodeType | 'location';

/**
 * Estado ESPACIAL de una ubicacion. Vocabulario cerrado y verificado por CHECK.
 *
 * Estos dos particionan el total: `available + blocked === location_count`,
 * siempre. Es una invariante (SPA-18) que la propia migracion verifica sobre
 * datos reales.
 */
export type LocationStatus = 'available' | 'blocked';

/**
 * Situacion segun el WMS. Vocabulario ABIERTO a proposito: hay 5 valores en un
 * archivo de origen y 8 en el otro, asi que cerrarlo con un union type haria que
 * un valor nuevo rompiera el tipado en lugar de mostrarse.
 *
 * Es una FOTO con fecha, no un estado vivo, y **se contradice con
 * `LocationStatus` en 2.365 ubicaciones**. Por eso son dos ejes distintos y no
 * se mezclan en una sola leyenda.
 */
export type WmsSituation = string;

/** Procedencia del dato. `catalog` = vino del WMS; `inferred` = lo deducimos. */
export type LocationOrigin = 'catalog' | 'inferred' | 'manual';

/**
 * Si la direccion esta descompuesta o el codigo es opaco.
 * Al `opaque` NO se le aplica el parser estructurado, asi que `level` y
 * `position` pueden ser `null`.
 */
export type CodeForm = 'structured' | 'opaque';

// ── Capacidad: tres estados, no un numero ───────────────────────────────────

/**
 * Por que esto no es `capacity: number`.
 *
 * De 29.310 ubicaciones del catalogo real:
 *   ·  2.341 tienen capacidad declarada (300, 1.300, 1.800 o 2.000 kg)
 *   · 26.244 el WMS declaro «sin limite» — con OCHO grafias distintas del
 *     centinela: 1e5, 1e6, 9999999, 1e7, 99999999, 1e8, 999999999, 1e9
 *   ·    727 el WMS no dijo nada
 *
 * Los dos ultimos casos eran el mismo `null` indistinguible hasta la migracion
 * 0058. Operativamente no son lo mismo: una ubicacion sin limite declarado se
 * puede usar; una sin dato hay que ir a medirla. Colapsarlos en un `0` diria que
 * no cabe nada, que es lo contrario de lo que ocurre en 26.244 de ellas.
 */
export type CapacityState = 'declared' | 'unlimited' | 'unknown';

export interface LocationCapacity {
  state: CapacityState;
  /** Solo cuando `state === 'declared'`. */
  maxWeightKg: number | null;
  maxUnits: number | null;
}

// ── Entidades ───────────────────────────────────────────────────────────────

/**
 * Una ubicacion, con su direccion ya descompuesta.
 *
 * El cliente NUNCA parsea `fullCode`: cada componente viaja como campo propio
 * (ADR-013). Y `externalCode` conserva el valor original del WMS con su grafia
 * exacta —`DAÑADO-C001-N01-1`, `PHA LO-C001-N01-1`— porque el operario que lee
 * la etiqueta del estante busca lo que ve escrito.
 */
export interface SpatialLocation {
  id: string;
  /** Codigo normalizado: `RCL07-C018-N05-2`. */
  code: string;
  /** Valor original del WMS, con eñes y espacios. */
  externalCode: string | null;
  externalLocationId: string | null;
  codeForm: CodeForm;

  warehouseId: string;
  warehouseCode: string;
  siteId: string | null;
  siteCode: string | null;
  /** `null` hoy: no hay pasillos en los datos. */
  aisleId: string | null;
  aisleCode: string | null;
  rackId: string | null;
  rackCode: string | null;
  rackExternalCode: string | null;
  bayId: string | null;
  /** `C018`, ya compuesto por el backend. */
  bayCode: string | null;
  bayIndex: number | null;

  /** Columna de la ubicacion. Distinta de `bayIndex`, aunque hoy coincidan. */
  logicalColumn: number | null;
  logicalLevel: number | null;
  logicalPosition: number | null;

  status: LocationStatus;
  /** Foto del WMS, con su fecha. Puede contradecir a `status`. */
  situation: WmsSituation | null;
  origin: LocationOrigin;
  isBulkArea: boolean;

  capacity: LocationCapacity;

  nodeFunction: string | null;
  /** Etiqueta legible: «Almacenaje», no `ALMREP`. */
  functionLabel: string | null;
  impliesBulk: boolean | null;

  /** Indices logicos, NO metros (TWN-07). No entran en aritmetica metrica. */
  logicalX: number | null;
  logicalY: number | null;
  logicalZ: number | null;
}

/** Un nodo del arbol. */
export interface SpatialNode {
  id: string;
  parentId: string | null;
  nodeType: NodeType | string;
  nodeFunction: string | null;
  functionLabel: string | null;
  code: string;
  externalCode: string | null;
  name: string | null;
  logicalIndex: number | null;
  siteId: string | null;
  canHoldLocations: boolean;
  /** `> 0` significa que se puede expandir, sin una peticion para averiguarlo. */
  childCount: number;
  locationCount: number;
  depth?: number;
}

/**
 * Resumen de un almacen. SOLO metricas que el backend puede llenar.
 *
 * No hay `occupied` ni `occupancyPercent`: ver `wmsSituationCounts`, que es lo
 * que si existe y lleva su fecha.
 */
export interface SpatialSummary {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  siteCount: number;
  /** 0 en los datos reales: no se inventan pasillos. */
  aisleCount: number;
  rackCount: number;
  bayCount: number;
  locationCount: number;
  /** `available + blocked === locationCount`, siempre. */
  availableCount: number;
  blockedCount: number;
  inferredCount: number;
  opaqueCount: number;
  /** Histograma del vocabulario abierto del WMS. Suma `locationCount`. */
  wmsSituationCounts: Record<string, number>;
  /** Ubicaciones donde estado y situacion se contradicen. 2.365 en WH-001. */
  statusSituationConflicts: number;
  capacityUnlimitedCount: number;
  capacityUnknownCount: number;
  /** 0 hasta que exista el importador CAD. */
  withWorldGeometry: number;
  lastImportAt: string | null;
  totalRowsRejected: number | null;
}

/** Almacen para el selector. Lleva los recuentos: el selector los muestra. */
export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  rackCount: number;
  bayCount: number;
  locationCount: number;
  lastImportAt: string | null;
  /** `false` cuando el almacen existe pero no tiene catalogo importado. */
  hasCatalog: boolean;
}

/** Una celda del plano agregado: un rack. */
export interface FloorPlanCell {
  rackId: string;
  rackCode: string;
  rackExternalCode: string | null;
  rackIndex: number | null;
  nodeType: string;
  nodeFunction: string | null;
  functionLabel: string | null;
  aisleId: string | null;
  aisleCode: string | null;
  bayCount: number;
  locationCount: number;
  availableCount: number;
  blockedCount: number;
  inferredCount: number;
  bulkCount: number;
  wmsSituationCounts: Record<string, number>;
  statusSituationConflicts: number;
  /** Indices logicos. Sirven para una rejilla topologica, NO para un plano. */
  minLogicalX: number | null;
  maxLogicalX: number | null;
  minLogicalY: number | null;
  maxLogicalY: number | null;
  maxLevel: number | null;
}

/** Una celda del alzado de un rack. */
export interface RackFrontCell {
  locationId: string;
  bayId: string;
  bayCode: string;
  bayIndex: number;
  level: number | null;
  position: number | null;
  code: string;
  externalCode: string | null;
  status: LocationStatus;
  situation: WmsSituation | null;
  isBulkArea: boolean;
  origin: LocationOrigin;
  capacity: LocationCapacity;
}

/** El alzado completo, con la rejilla ya dimensionada. */
export interface RackFrontView {
  rackId: string;
  rackCode: string;
  rackExternalCode: string | null;
  nodeFunction: string | null;
  functionLabel: string | null;
  bayCount: number;
  maxLevel: number | null;
  maxPosition: number | null;
  cells: RackFrontCell[];
}

// ── Paginacion y filtros ────────────────────────────────────────────────────

/**
 * Filtro de ubicaciones.
 *
 * ⚠ `cursor` y `page` son EXCLUYENTES: el backend responde 422 si llegan los
 * dos. `cursor` es la forma correcta de recorrer —su coste no crece con la
 * profundidad— y `page` existe para una tabla que necesita «pagina 7 de 294».
 */
export interface LocationFilter {
  warehouseId: string | null;
  rackId?: string | undefined;
  bayId?: string | undefined;
  status?: LocationStatus | undefined;
  situation?: string | undefined;
  codeForm?: CodeForm | undefined;
  level?: number | undefined;
  /** Prefijo, no substring. */
  search?: string | undefined;
  pageSize?: number | undefined;
  cursor?: string | undefined;
  page?: number | undefined;
  /** Cuesta una consulta mas. Sin el, `total` llega como `null`. */
  withTotal?: boolean | undefined;
}

/**
 * Pagina de resultados.
 *
 * `total` y `totalPages` son `null` cuando NO se contaron. La UI debe
 * distinguirlo de `0`: uno significa «no lo sabemos», el otro «no hay nada».
 */
export interface Paginated<T> {
  items: T[];
  pageSize: number;
  nextCursor: string | null;
  page: number | null;
  total: number | null;
  totalPages: number | null;
}
