/**
 * HOOKS DE REACT QUERY — MODULO SPATIAL
 *
 * Un hook por read model. No hay un hook universal que alimente todo.
 *
 * Tres decisiones que se repiten en todos y conviene leer una vez:
 *
 *   1. `signal` SE PROPAGA. React Query cancela la peticion anterior al cambiar
 *      de almacen; sin la señal, esa respuesta llega despues y sobrescribe la
 *      nueva. Con 260 ms de latencia por peticion, la carrera no es teorica.
 *
 *   2. `retry` DISTINGUE EL ERROR. Un 403 o un 404 no mejoran reintentando, y
 *      reintentarlos tres veces multiplica por tres la espera antes de decirle al
 *      operador lo que ya se sabia. `isTerminal()` lo decide con el contrato real.
 *
 *   3. NO HAY `keepPreviousData`. Mostrar los datos del almacen anterior mientras
 *      carga el nuevo es exactamente como se acaba mirando el inventario
 *      equivocado.
 */

import { useQuery } from '@tanstack/react-query';

import { ApiError, isTerminal } from '../../../lib/apiErrors';
import { SPATIAL_CONFIG } from '../config';
import { SpatialContractError } from '../repositories/mappers';
import type { FloorPlanCell, LocationFilter } from '../types/index';
import { spatialKeys } from './queryKeys';
import { useSpatialRepo } from './SpatialProvider';

/**
 * Politica de reintento comun.
 *
 * Un `SpatialContractError` NUNCA se reintenta: si el backend devolvio un valor
 * que el contrato no admite, volver a pedirlo devuelve el mismo valor. Es un
 * fallo de despliegue, no de red.
 */
function retryPolicy(failureCount: number, error: unknown): boolean {
  if (error instanceof SpatialContractError) return false;
  if (error instanceof ApiError && isTerminal(error)) return false;
  return failureCount < 2;
}

/**
 * ⚠ `networkMode: 'always'` y NO el valor por defecto (`'online'`).
 *
 * Con `'online'`, React Query **pausa** la query cuando el navegador se declara sin
 * red: queda en `fetchStatus: 'paused'`, con `isPending: true` e `isError: false`,
 * indefinidamente. La consecuencia medida en la tabla de ubicaciones era la peor
 * posible: sin red mostraba **«Sin resultados»** en lugar de «Sin conexion» — le
 * decia al operador que su almacen esta vacio cuando lo que pasa es que no hay red.
 *
 * Con `'always'` la peticion se intenta igual, falla con `NETWORK_ERROR`, y el
 * estado de error llega a la UI, que ya sabe distinguirlo (`classifyError`).
 *
 * `navigator.onLine` tampoco serviria como sustituto: da falsos positivos con una
 * red conectada pero sin salida, que es el caso frecuente en un almacen.
 */
const COMUN = {
  retry: retryPolicy,
  refetchOnWindowFocus: false,
  networkMode: 'always',
} as const;

// ── 1 · Almacenes ───────────────────────────────────────────────────────────

export function useWarehouses() {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.warehouses(),
    queryFn: ({ signal }) => repo.getWarehouses(signal),
    staleTime: SPATIAL_CONFIG.warehousesCacheMs,
  });
}

// ── 2 · Resumen ─────────────────────────────────────────────────────────────

export function useSpatialSummary(
  warehouseId: string | null,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.summary(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.getSummary(warehouseId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

// ── 3 · Arbol ───────────────────────────────────────────────────────────────

/** Raices del arbol: 348 nodos en WH-001, no los 3.048. */
export function useTreeRoots(
  warehouseId: string | null,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.treeRoots(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.getTreeRoots(warehouseId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

/**
 * Hijos de UN nodo. Se monta un hook por nodo expandido, y eso es deliberado:
 * cada nodo tiene su propio `isLoading`, asi que el spinner sale en la rama que
 * se expande y no en el workspace entero.
 */
export function useNodeChildren(
  nodeId: string | null,
  enabled = true,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.nodeChildren(nodeId ?? ''),
    enabled: Boolean(nodeId) && enabled,
    queryFn: ({ signal }) => repo.getNodeChildren(nodeId!, {}, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

export function useSpatialNode(
  nodeId: string | null,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.node(nodeId ?? ''),
    enabled: Boolean(nodeId),
    queryFn: ({ signal }) => repo.getNode(nodeId!, signal),
  });
}

// ── 4 · Plano agregado ──────────────────────────────────────────────────────

/**
 * Racks agregados: 348 filas, no 29.310 ubicaciones.
 *
 * `withTotal` va activado porque el `count` es sobre 3.048 nodos (4,7 ms medidos)
 * y la vista necesita saber si hay mas de una pagina.
 */
export function useFloorPlan(
  warehouseId: string | null,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.floorPlan(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) =>
      repo.getFloorPlan(
        warehouseId!,
        { limit: SPATIAL_CONFIG.maxPageSize, withTotal: true },
        signal,
      ),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

/**
 * El plano COMPLETO: todas las paginas, no la primera.
 *
 * `useFloorPlan` devuelve una pagina de 200 y eso le basta al explorador. Al
 * EDITOR no: si solo conoce 200 de los 348 racks, los 148 restantes no aparecen en
 * «racks sin posicionar» y no hay forma de situarlos —y la pantalla no lo diria,
 * simplemente faltarian—. Son dos peticiones al pooler, no doscientas.
 *
 * Tope de 20 paginas (4.000 racks) como red de seguridad, y si se alcanza se
 * devuelve `truncado: true` para que la UI lo diga en lugar de callarlo.
 */
export function useFloorPlanCompleto(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.floorPlanCompleto(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: async ({ signal }) => {
      const items: FloorPlanCell[] = [];
      let cursor: string | undefined;
      for (let pagina = 0; pagina < 20; pagina += 1) {
        const p = await repo.getFloorPlan(
          warehouseId!,
          {
            limit: SPATIAL_CONFIG.maxPageSize,
            ...(cursor ? { cursor } : {}),
            ...(pagina === 0 ? { withTotal: true } : {}),
          },
          signal,
        );
        items.push(...p.items);
        if (!p.nextCursor) {
          return { items, total: p.total ?? items.length, truncado: false };
        }
        cursor = p.nextCursor;
      }
      return { items, total: items.length, truncado: true };
    },
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

// ── 5 · Alzado ──────────────────────────────────────────────────────────────

/** Alzado de un rack, por UUID. Sin paginar: un alzado partido no es un alzado. */
export function useRackFrontView(
  rackId: string | null,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.rackFrontView(rackId ?? ''),
    enabled: Boolean(rackId),
    queryFn: ({ signal }) => repo.getRackFrontView(rackId!, signal),
  });
}

// ── 6 · Ubicaciones ─────────────────────────────────────────────────────────

export function useLocations(
  filter: LocationFilter,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.locations(filter),
    // Un `bayId` o un `rackId` ya delimitan el conjunto: exigir `warehouseId`
    // ademas impedia pedir las ubicaciones de un cuerpo concreto, que es como el
    // arbol construye sus niveles. RLS filtra igual con cualquiera de los tres, asi
    // que el almacen no es lo que da la seguridad: es solo un filtro mas.
    enabled: Boolean(filter.warehouseId ?? filter.bayId ?? filter.rackId),
    queryFn: ({ signal }) => repo.getLocations(filter, signal),
  });
}

export function useLocationDetail(
  locationId: string | null,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.location(locationId ?? ''),
    enabled: Boolean(locationId),
    queryFn: ({ signal }) => repo.getLocation(locationId!, signal),
  });
}
