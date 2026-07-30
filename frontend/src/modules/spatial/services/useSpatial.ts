/**
 * HOOKS DE REACT QUERY — MODULO SPATIAL
 *
 * Consumen el repositorio inyectado via contexto. Los componentes nunca
 * instancian el repositorio directamente.
 */

import { useQuery } from '@tanstack/react-query';
import { useSpatialRepo } from './SpatialProvider';
import type { LocationFilter, LocationStatus } from '../types/index';

const K = {
  warehouses: ['spatial', 'warehouses'] as const,
  summary: (whId: string) => ['spatial', 'summary', whId] as const,
  locations: (filter: LocationFilter) =>
    ['spatial', 'locations', filter.warehouseId, filter.parentId ?? 'root', filter.search ?? '', filter.status ?? 'all'] as const,
  location: (id: string) => ['spatial', 'location', id] as const,
};

export function useWarehouses() {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: K.warehouses,
    queryFn: () => repo.getWarehouses(),
    staleTime: 5 * 60_000,
  });
}

export function useSpatialSummary(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: K.summary(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getSummary(warehouseId!),
  });
}

export function useLocations(
  warehouseId: string | null,
  parentId: string | null | undefined,
  search: string,
  status: LocationStatus | undefined,
) {
  const repo = useSpatialRepo();
  const filter: LocationFilter = {
    warehouseId: warehouseId ?? '',
    parentId: parentId,
    search: search || undefined,
    status,
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
