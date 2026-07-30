/**
 * HOOKS DE REACT QUERY — MODULO SPATIAL
 *
 * Consumen el repositorio inyectado via contexto. Los componentes nunca
 * instancian el repositorio directamente.
 *
 * `useLocations` devuelve PaginatedLocations; los componentes acceden a `.items`
 * para la lista y a `.total` / `.totalPages` para controles de paginacion.
 */

import { useQuery } from '@tanstack/react-query';
import { useSpatialRepo } from './SpatialProvider';
import { SPATIAL_CONFIG } from '../config';
import type { LocationFilter, LocationKind, LocationStatus } from '../types/index';

const K = {
  warehouses: ['spatial', 'warehouses'] as const,
  summary: (whId: string) => ['spatial', 'summary', whId] as const,
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
  location: (id: string) => ['spatial', 'location', id] as const,
};

export function useWarehouses() {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: K.warehouses,
    queryFn: () => repo.getWarehouses(),
    staleTime: SPATIAL_CONFIG.warehousesCacheMs,
  });
}

export function useSpatialSummary(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: K.summary(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getSummary(warehouseId!),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

export function useLocations(
  warehouseId: string | null,
  parentId: string | null | undefined,
  search: string,
  status: LocationStatus | undefined,
  nodeType?: LocationKind | undefined,
  page?: number | undefined,
  pageSize?: number | undefined,
) {
  const repo = useSpatialRepo();
  const filter: LocationFilter = {
    warehouseId: warehouseId ?? '',
    parentId,
    search: search || undefined,
    status,
    nodeType,
    page,
    pageSize,
  };
  return useQuery({
    queryKey: K.locations(filter),
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getLocations(filter),
  });
}

export function useLocationDetail(id: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: K.location(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => repo.getLocation(id!),
  });
}
