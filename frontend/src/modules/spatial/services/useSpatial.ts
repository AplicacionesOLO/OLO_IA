/**
 * HOOKS DE REACT QUERY — MODULO SPATIAL
 *
 * Cada hook = un metodo del repositorio = un read model = una query key.
 * NO existe un hook universal que alimente todo.
 *
 *   useWarehouses       → getWarehouses()       → selector
 *   useSpatialSummary   → getSummary()          → KPIs
 *   useSpatialTree      → getTree()             → arbol jerarquico (lazy)
 *   useFloorPlan        → getFloorPlan()        → vista superior agregada
 *   useRackFrontView    → getRackFrontView()    → vista frontal de UN rack
 *   useLocations        → getLocations()        → busqueda/grid paginada
 *   useLocationDetail   → getLocation()         → inspector detalle
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

/** Arbol jerarquico: UN nivel, lazy por parentId. */
export function useSpatialTree(warehouseId: string | null, parentId?: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: spatialKeys.tree(warehouseId ?? '', parentId),
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getTree(warehouseId!, parentId),
  });
}

/** Vista superior: read model agregado por rack. NO descarga posiciones. */
export function useFloorPlan(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: spatialKeys.floorPlan(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: () => repo.getFloorPlan(warehouseId!),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

/** Vista frontal de UN rack. Deshabilitado si no hay rack seleccionado. */
export function useRackFrontView(warehouseId: string | null, rackCode: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: spatialKeys.rackFrontView(warehouseId ?? '', rackCode ?? ''),
    enabled: Boolean(warehouseId) && Boolean(rackCode),
    queryFn: () => repo.getRackFrontView(warehouseId!, rackCode!),
  });
}

/** Ubicaciones paginadas: SOLO para grid y busqueda. */
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

/** Detalle de UNA ubicacion: para el inspector. */
export function useLocationDetail(id: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    queryKey: spatialKeys.location(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => repo.getLocation(id!),
  });
}
