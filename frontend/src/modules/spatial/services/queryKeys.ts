/**
 * QUERY KEYS — centralizados, uno por read model.
 *
 * Cada contrato tiene su propia key. No se reutiliza una key generica.
 *
 * Invalidation strategy (documented, not implemented yet):
 *   Location change →
 *     invalidate: location(id), rackFrontView(wh, rack), floorPlan(wh), summary(wh), tree(wh, parent)
 *   Rack change →
 *     invalidate: rackFrontView(wh, rack), floorPlan(wh), summary(wh)
 *   Warehouse structure change →
 *     invalidate: all keys for that warehouse
 */

import { SPATIAL_CONFIG } from '../config';
import type { LocationFilter } from '../types/index';

export const spatialKeys = {
  all: ['spatial'] as const,

  warehouses: () => ['spatial', 'warehouses'] as const,

  summary: (warehouseId: string) =>
    ['spatial', 'summary', warehouseId] as const,

  tree: (warehouseId: string, parentId: string | null | undefined) =>
    ['spatial', 'tree', warehouseId, parentId ?? 'root'] as const,

  floorPlan: (warehouseId: string) =>
    ['spatial', 'floor-plan', warehouseId] as const,

  rackFrontView: (warehouseId: string, rackCode: string) =>
    ['spatial', 'rack-front', warehouseId, rackCode] as const,

  locations: (filter: LocationFilter) =>
    [
      'spatial', 'locations',
      filter.warehouseId,
      filter.parentId ?? 'root',
      filter.search ?? '',
      filter.status ?? 'all',
      filter.nodeType ?? 'all',
      filter.page ?? 1,
      filter.pageSize ?? SPATIAL_CONFIG.defaultPageSize,
    ] as const,

  location: (id: string) =>
    ['spatial', 'location', id] as const,

  /** Invalidate all queries for a warehouse. */
  byWarehouse: () =>
    ['spatial'] as const,
};
