/**
 * CONTRATO DEL REPOSITORIO SPATIAL
 *
 * Metodos separados por proposito. Ninguna vista descarga el dataset completo.
 *
 * - getWarehouses: selector de almacen
 * - getSummary: KPIs superiores
 * - getTree: arbol jerarquico (lazy)
 * - getFloorPlan: vista superior agregada por rack (NO posiciones individuales)
 * - getRackFrontView: posiciones de UN rack seleccionado
 * - getLocations: busqueda/grid paginada
 * - getLocation: detalle de una ubicacion
 */

import type {
  LocationFilter,
  PaginatedLocations,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';
import type { FloorPlanDto, RackFrontViewDto, SpatialTreeNodeDto } from './dto';

export interface SpatialRepository {
  /** Almacenes accesibles por el usuario. */
  getWarehouses(): Promise<WarehouseOption[]>;

  /** Resumen agregado de un almacen. */
  getSummary(warehouseId: string): Promise<SpatialSummary>;

  /** Nodos del arbol (lazy: un nivel a la vez). */
  getTree(warehouseId: string, parentId?: string | null): Promise<SpatialTreeNodeDto[]>;

  /** Vista de planta: racks agregados + zonas. NO descarga posiciones. */
  getFloorPlan(warehouseId: string): Promise<FloorPlanDto>;

  /** Vista frontal de UN rack: todas sus posiciones. */
  getRackFrontView(warehouseId: string, rackCode: string): Promise<RackFrontViewDto>;

  /** Ubicaciones filtradas y paginadas (para busqueda/grid). */
  getLocations(filter: LocationFilter): Promise<PaginatedLocations>;

  /** Detalle de una ubicacion. */
  getLocation(id: string): Promise<SpatialLocation | null>;
}
