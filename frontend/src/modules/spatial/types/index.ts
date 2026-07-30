/**
 * TIPOS DEL MODULO SPATIAL — capa de UI
 *
 * Estos tipos representan el contrato que los COMPONENTES consumen.
 * Se distinguen de los tipos de dominio (../types.ts) que Claude define
 * para el modelo del backend.
 */

// ── Tipos del backend (importados para constraint) ──────────────────────────

/**
 * NodeType: SOLO los valores confirmados por el backend como node_type.
 * Se usa exclusivamente como filtro en queries. El repositorio NO envia
 * node_type=warehouse, node_type=site ni node_type=location.
 */
export type NodeType =
  | 'building'
  | 'floor'
  | 'zone'
  | 'aisle'
  | 'rack'
  | 'storage_area';

/**
 * SpatialEntityKind: tipo de entidad completa en la UI (incluye contenedores
 * que no son node_type del backend).
 */
export type SpatialEntityKind =
  | 'warehouse'
  | 'site'
  | NodeType
  | 'location';

/** Estado fisico/logico de una ubicacion. */
export type LocationStatus =
  | 'occupied'
  | 'available'
  | 'inferred'
  | 'invalid'
  | 'reserved'
  | 'blocked';

/** Una ubicacion en la jerarquia espacial. */
export interface SpatialLocation {
  id: string;
  /** Codigo legible: A-01-03-2 */
  code: string;
  /** Nombre descriptivo opcional. */
  name: string | null;
  kind: SpatialEntityKind;
  status: LocationStatus;
  /** ID del padre en la jerarquia. null = raiz (zona). */
  parentId: string | null;
  /** Capacidad maxima en unidades logicas. */
  capacity: number;
  /** Ocupacion actual. */
  occupied: number;
  /** Ultima vez que se confirmo el estado. ISO string. */
  lastVerifiedAt: string | null;
  /** Metadatos de dimension para el futuro 3D. */
  dimensions: { width: number; depth: number; height: number } | null;
}

/** Resumen de metricas de un almacen. */
export interface SpatialSummary {
  totalLocations: number;
  occupied: number;
  available: number;
  inferred: number;
  invalid: number;
  occupancyPercent: number;
}

/** Almacen disponible para el selector. */
export interface WarehouseOption {
  id: string;
  name: string;
  code: string;
}

/** Filtro para buscar ubicaciones.
 * `nodeType` solo acepta NodeType (backend-confirmed), nunca warehouse/site/location. */
export interface LocationFilter {
  warehouseId: string;
  search?: string | undefined;
  status?: LocationStatus | undefined;
  parentId?: string | null | undefined;
  /** Solo valores de NodeType. El repositorio no envia warehouse/site/location aqui. */
  nodeType?: NodeType | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

/** Resultado paginado de ubicaciones. */
export interface PaginatedLocations {
  items: SpatialLocation[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Cursor para la siguiente pagina (cuando el backend lo soporte). */
  nextCursor?: string | null | undefined;
}
