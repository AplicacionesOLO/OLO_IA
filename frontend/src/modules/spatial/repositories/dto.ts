/**
 * DTO — Data Transfer Objects del API Spatial.
 *
 * Representan EXACTAMENTE lo que el backend devuelve, sin transformar.
 * Los mapeadores convierten estos DTOs a los tipos internos del modulo.
 *
 * Endpoints esperados:
 *   GET /v1/spatial/warehouses
 *   GET /v1/spatial/warehouses/{warehouse_id}/summary
 *   GET /v1/spatial/warehouses/{warehouse_id}/locations
 *   GET /v1/spatial/locations/{location_id}
 */

/** GET /v1/spatial/warehouses → data[] */
export interface SpatialWarehouseDto {
  id: string;
  name: string;
  code: string;
  status: string;
  company_id: string;
}

/** GET /v1/spatial/warehouses/{id}/summary → data */
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

/** GET /v1/spatial/warehouses/{id}/locations → data[] */
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
}
