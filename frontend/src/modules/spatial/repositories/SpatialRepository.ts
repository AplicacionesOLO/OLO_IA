/**
 * CONTRATO DEL REPOSITORIO SPATIAL
 *
 * Los componentes dependen de esta interfaz, NUNCA de una implementacion
 * concreta. Hoy se resuelve con datos locales (DevSpatialRepository); cuando
 * el backend exponga /v1/spatial/locations se usa ApiSpatialRepository
 * sin tocar los componentes.
 */

import type {
  LocationFilter,
  PaginatedLocations,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';

export interface SpatialRepository {
  /** Almacenes accesibles por el usuario. */
  getWarehouses(): Promise<WarehouseOption[]>;

  /** Resumen de un almacen. */
  getSummary(warehouseId: string): Promise<SpatialSummary>;

  /** Ubicaciones filtradas y paginadas. */
  getLocations(filter: LocationFilter): Promise<PaginatedLocations>;

  /** Detalle de una ubicacion. */
  getLocation(id: string): Promise<SpatialLocation | null>;
}
