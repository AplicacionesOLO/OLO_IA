/**
 * CONTRATO DEL REPOSITORIO SPATIAL
 *
 * Los componentes dependen de esta interfaz, NUNCA de una implementacion
 * concreta. Hoy se resuelve con datos locales (DevSpatialRepository); cuando
 * el backend exponga /v1/warehouses/{id}/locations se crea ApiSpatialRepository
 * y se cambia el provider. Los componentes no se tocan.
 */

import type {
  LocationFilter,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';

export interface SpatialRepository {
  /** Almacenes accesibles por el usuario. */
  getWarehouses(): Promise<WarehouseOption[]>;

  /** Resumen de un almacen. */
  getSummary(warehouseId: string): Promise<SpatialSummary>;

  /** Ubicaciones filtradas. Devuelve arbol plano; el cliente arma la jerarquia. */
  getLocations(filter: LocationFilter): Promise<SpatialLocation[]>;

  /** Detalle de una ubicacion. */
  getLocation(id: string): Promise<SpatialLocation | null>;
}
