/**
 * DTO — Data Transfer Objects del API Spatial.
 *
 * Cada DTO corresponde a un endpoint DISTINTO del backend.
 * No se usa una unica coleccion universal para todo.
 *
 * Endpoints esperados (Claude pendiente de publicar):
 *   GET /v1/spatial/warehouses
 *   GET /v1/spatial/warehouses/{id}/summary
 *   GET /v1/spatial/warehouses/{id}/tree
 *   GET /v1/spatial/warehouses/{id}/floor-plan
 *   GET /v1/spatial/racks/{rack_code}/front
 *   GET /v1/spatial/warehouses/{id}/locations  (paginado, para busqueda/grid)
 *   GET /v1/spatial/locations/{id}
 */

// ── Paginacion generica ─────────────────────────────────────────────────────

export interface PaginatedDto<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  next_cursor?: string | null;
}

// ── Warehouses ──────────────────────────────────────────────────────────────

export interface SpatialWarehouseDto {
  id: string;
  name: string;
  code: string;
  status: string;
  company_id?: string;
}

// ── Summary ─────────────────────────────────────────────────────────────────

export interface SpatialSummaryDto {
  total_locations: number;
  occupied: number;
  available: number;
  inferred: number;
  invalid: number;
  reserved: number;
  blocked: number;
  occupancy_percent: number;
}

// ── Tree (read model jerarquico, NO las 29k ubicaciones) ────────────────────

/** Nodo del arbol. Puede ser zone, aisle, rack, bay, etc. */
export interface SpatialTreeNodeDto {
  id: string;
  code: string;
  name: string | null;
  node_type: string;
  parent_id: string | null;
  /** Conteo de ubicaciones debajo de este nodo. */
  location_count: number;
  /** Ocupacion agregada. */
  occupancy_percent: number;
  /** Si tiene hijos (para lazy loading del arbol). */
  has_children: boolean;
}

// ── Floor Plan (read model agregado por rack, NO posiciones individuales) ───

/** Un rack en la vista superior: posicion, dimensiones, ocupacion agregada. */
export interface FloorPlanRackDto {
  rack_code: string;
  /** Centro x,y en el plano (metros o unidades logicas). */
  x: number;
  y: number;
  /** Orientacion en grados. */
  rotation: number;
  bay_count: number;
  level_count: number;
  location_count: number;
  occupancy_percent: number;
  /** Estado dominante del rack. */
  dominant_status: string;
}

/** Zona especial en la vista de planta. */
export interface FloorPlanZoneDto {
  code: string;
  zone_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  location_count: number;
}

export interface FloorPlanDto {
  racks: FloorPlanRackDto[];
  zones: FloorPlanZoneDto[];
  /** Dimensiones del plano en las mismas unidades que x,y. */
  plan_width: number;
  plan_height: number;
}

// ── Rack Front View (posiciones del rack seleccionado) ──────────────────────

/** Posicion individual dentro de un rack. */
export interface RackPositionDto {
  id: string;
  /** Codigo completo: RCL07-C018-N05-2 */
  location_code: string;
  rack_code: string;
  bay_code: string;
  logical_level: number;
  logical_position: number;
  status: string;
  capacity: number;
  occupied: number;
  last_verified_at: string | null;
}

export interface RackFrontViewDto {
  rack_code: string;
  bay_codes: string[];
  level_range: { min: number; max: number };
  positions: RackPositionDto[];
}

// ── Locations (paginado, para busqueda y grid) ──────────────────────────────

export interface SpatialLocationDto {
  id: string;
  code: string;
  name: string | null;
  kind: string;
  status: string;
  parent_id: string | null;
  capacity: number;
  occupied: number;
  last_verified_at: string | null;
  dimensions: { width: number; depth: number; height: number } | null;
  // Campos estructurados (disponibles cuando el backend los entregue)
  rack_code?: string | null;
  bay_code?: string | null;
  logical_level?: number | null;
  logical_position?: number | null;
}

// ── Query params ────────────────────────────────────────────────────────────

export interface LocationsQueryParams {
  parent_id?: string;
  search?: string;
  status?: string;
  node_type?: string;
  page?: number;
  page_size?: number;
}

export interface TreeQueryParams {
  parent_id?: string;
  depth?: number;
}
