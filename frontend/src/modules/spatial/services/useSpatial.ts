/**
 * HOOKS DE REACT QUERY — MODULO SPATIAL
 *
 * Cada hook corresponde a un metodo distinto del repositorio.
 * NO se usa una query universal para todo.
 *
 *   useWarehouses      → selector
 *   useSpatialSummary  → KPIs
 *   useSpatialTree     → arbol (lazy, un nivel)
 *   useFloorPlan       → vista superior (racks agregados, NO posiciones)
 *   useRackFrontView   → vista frontal (posiciones de UN rack)
 *   useLocations       → busqueda/grid paginada
 *   useLocationDetail  → inspector
 */

import { useQuery } from '@tanstack/react-query';
import { useSpatialRepo } from './SpatialProvider';
import { spatialKeys } from './queryKeys';
import { SPATIAL_CONFIG } from '../config';
import type { LocationFilter, LocationStatus, NodeType } from '../types/index';

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

/** Arbol jerarquico: un nivel a la vez (lazy). */
export function useSpatialTree(warehouseId: string | null, parentId?: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: [...spatialKeys.all, 'tree', warehouseId ?? '', parentId ?? 'root'] as const,
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getTree(warehouseId!, parentId),
  });
}

/** Vista superior: racks agregados. NO descarga posiciones individuales. */
export function useFloorPlan(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: [...spatialKeys.all, 'floor-plan', warehouseId ?? ''] as const,
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getFloorPlan(warehouseId!),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

/** Vista frontal de UN rack: descarga posiciones solo de ese rack. */
export function useRackFrontView(warehouseId: string | null, rackCode: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: [...spatialKeys.all, 'rack-front', warehouseId ?? '', rackCode ?? ''] as const,
    enabled: Boolean(warehouseId) && Boolean(rackCode),
    queryFn: () => repo.getRackFrontView(warehouseId!, rackCode!),
  });
}

/** Ubicaciones paginadas (para busqueda y grid). */
export function useLocations(
  warehouseId: string | null,
  parentId: string | null | undefined,
  search: string,
  status: LocationStatus | undefined,
  nodeType?: NodeType | undefined,
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
