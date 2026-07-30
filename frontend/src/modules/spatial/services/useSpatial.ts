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
import { spatialKeys } from './queryKeys';
import { SPATIAL_CONFIG } from '../config';
import type { LocationFilter, LocationKind, LocationStatus } from '../types/index';

export function useWarehouses() {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: spatialKeys.warehouses(),
    queryFn: () => repo.getWarehouses(),
    staleTime: SPATIAL_CONFIG.warehousesCacheMs,
  });
}

export function useSpatialSummary(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: spatialKeys.summary(warehouseId ?? ''),
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
    queryKey: spatialKeys.locations(filter),
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getLocations(filter),
  });
}

export function useLocationDetail(id: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: spatialKeys.location(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => repo.getLocation(id!),
  });
}
