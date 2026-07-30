/**
 * QUERY KEYS — centralizados para invalidacion y prefetching.
 *
 * Se importan desde hooks, prefetchers y componentes que necesitan
 * invalidar manualmente una query.
 */

import { SPATIAL_CONFIG } from '../config';
import type { LocationFilter } from '../types/index';

export const spatialKeys = {
  all: ['spatial'] as const,

  warehouses: () => [...spatialKeys.all, 'warehouses'] as const,

  summary: (warehouseId: string) =>
    [...spatialKeys.all, 'summary', warehouseId] as const,

  locations: (filter: LocationFilter) =>
    [
      ...spatialKeys.all,
      'locations',
      filter.warehouseId,
      filter.parentId ?? 'root',
      filter.search ?? '',
      filter.status ?? 'all',
      filter.nodeType ?? 'all',
      filter.page ?? 1,
      filter.pageSize ?? SPATIAL_CONFIG.defaultPageSize,
    ] as const,

  location: (id: string) =>
    [...spatialKeys.all, 'location', id] as const,

  /** Invalida todas las queries de un almacen. */
  byWarehouse: (warehouseId: string) =>
    [...spatialKeys.all, 'locations', warehouseId] as const,
};
