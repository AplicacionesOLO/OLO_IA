/**
 * Acceso a los datos del inventario.
 *
 * ── SIN PROVIDER, Y ES DELIBERADO ────────────────────────────────────────────
 *
 * El módulo espacial tiene `<SpatialProvider>` porque inyecta un repositorio que se
 * puede sustituir por uno de desarrollo. Aquí no hace falta: estos endpoints son de
 * SOLO LECTURA y no tienen variante falsa que merezca la pena mantener.
 *
 * Y hay una razón práctica: un hook que exige provider revienta la pantalla que lo use
 * fuera de su árbol, con un error que TypeScript no ve. Pasó al meter `useWarehouses()`
 * en el panel de inicio. Sin provider, estos hooks se pueden usar desde cualquier sitio.
 *
 * ── EL ALMACÉN NO SE PASA POR PARÁMETRO ─────────────────────────────────────
 *
 * Sale de `activeWarehouseId` del store de sesión, que es el mismo que usa el resto de
 * la aplicación. Si cada pantalla eligiera el suyo, cambiar de almacén en la barra
 * dejaría a esta enseñando el anterior sin que nada lo avisara.
 */

import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import { useSessionStore } from '../../auth/sessionStore';
import type {
  FindResult,
  InventorySummary,
  LocationContent,
  MismatchReport,
  RackOccupancyList,
} from './types';

const K = {
  resumen: (w: string) => ['inventory', 'summary', w] as const,
  descuadres: (w: string) => ['inventory', 'mismatches', w] as const,
  racks: (w: string) => ['inventory', 'racks', w] as const,
  buscar: (w: string, por: string, t: string) => ['inventory', 'find', w, por, t] as const,
  contenido: (w: string, l: string) => ['inventory', 'content', w, l] as const,
};

/**
 * Los datos del inventario son una FOTO importada, no un directo: no cambian hasta el
 * siguiente import. Recargarlos al volver a la pestaña gastaría viajes al pooler
 * —~260 ms cada uno— para traer exactamente lo mismo.
 */
const COMUN = {
  retry: false,
  refetchOnWindowFocus: false,
  staleTime: 300_000,
} as const;

/** Los almacenes que este usuario ve de verdad, segun la API. */
function useAlmacenesAccesibles() {
  const { api } = useAuth();
  return useQuery({
    ...COMUN,
    queryKey: ['inventory', 'almacenes'] as const,
    queryFn: () => api.get<{ warehouse_id: string }[]>('/spatial/warehouses'),
  });
}

/**
 * El almacén sobre el que trabaja esta pantalla.
 *
 * ── POR QUE NO BASTA `activeWarehouseId` ─────────────────────────────────────
 *
 * Ese campo del store sale de `accessible_warehouse_ids`, que a su vez sale de
 * `core.accessible_warehouse_ids()` — y esa funcion SOLO mira `user_warehouse_access`,
 * las concesiones explicitas.
 *
 * Un administrador de tenant no las tiene: ve los almacenes por `tenant_wide_access`,
 * que es otro camino. Medido: `arojas@ologistics.com` tiene 0 concesiones y ve los dos
 * almacenes, asi que el store le daba `null` y esta pantalla le decia «no tienes ningun
 * almacen asignado» mientras el explorador espacial le funcionaba. Un mensaje que
 * ademas le habria mandado a pedir un acceso que ya tiene.
 *
 * Asi que se prefiere lo elegido en la barra y, si no hay nada, el primero que la API
 * devuelva — que es la misma fuente que usa el resto de la aplicacion.
 */
export function useAlmacenActivo(): string | null {
  const guardado = useSessionStore((s) => s.activeWarehouseId);
  const { data } = useAlmacenesAccesibles();
  return guardado ?? data?.[0]?.warehouse_id ?? null;
}

/** `true` mientras todavia no se sabe si hay almacen: evita el vacio prematuro. */
export function useResolviendoAlmacen(): boolean {
  const guardado = useSessionStore((s) => s.activeWarehouseId);
  const { isLoading } = useAlmacenesAccesibles();
  return !guardado && isLoading;
}

export function useResumenInventario() {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: K.resumen(w ?? ''),
    enabled: Boolean(w),
    queryFn: () => api.get<InventorySummary>(`/inventory/warehouses/${w}/summary`),
  });
}

/**
 * Los descuadres, opcionalmente acotados a una clase.
 *
 * ── EL FILTRO VA AL SERVIDOR, NO AL CLIENTE ─────────────────────────────────
 *
 * Filtrar en memoria sobre lo ya descargado parece equivalente y no lo es: la lista
 * viene acotada por el motor —200 filas— y ordenada por clase, así que las 200 salían
 * TODAS de la primera por alfabeto. Filtrar en el cliente por «libre con stock» daba
 * cero resultados mientras el recuento decía 716. Medido en el almacén real.
 */
export function useDescuadres(clase?: string | null) {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: [...K.descuadres(w ?? ''), clase ?? 'todos'] as const,
    enabled: Boolean(w),
    queryFn: () =>
      api.get<MismatchReport>(
        `/inventory/warehouses/${w}/mismatches${clase ? `?kind=${clase}` : ''}`,
      ),
  });
}

export function useOcupacionPorRack() {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: K.racks(w ?? ''),
    enabled: Boolean(w),
    queryFn: () => api.get<RackOccupancyList>(`/inventory/warehouses/${w}/rack-occupancy`),
  });
}

/**
 * Busca un pallet o un artículo. Es la consulta del pasillo: «¿dónde está esto?».
 *
 * El endpoint recibe `pallet` O `sku`, uno de los dos y no los dos: «el pallet X del
 * artículo Y» es una intersección que nadie pide.
 *
 * Un término de menos de dos caracteres NO lanza la consulta. Sin ese freno, cada
 * pulsación dispararía una búsqueda —incluida la de un solo carácter, que devolvería
 * medio almacén— y contra el pooler eso son ~260 ms por tecla.
 */
export function useBuscar(por: 'pallet' | 'sku', termino: string) {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  const limpio = termino.trim();
  return useQuery({
    ...COMUN,
    queryKey: K.buscar(w ?? '', por, limpio),
    enabled: Boolean(w) && limpio.length >= 2,
    queryFn: () =>
      api.get<FindResult>(
        `/inventory/warehouses/${w}/find?${por}=${encodeURIComponent(limpio)}`,
      ),
  });
}

export function useContenido(locationId: string | null) {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: K.contenido(w ?? '', locationId ?? ''),
    enabled: Boolean(w) && Boolean(locationId),
    queryFn: () =>
      api.get<LocationContent>(
        `/inventory/warehouses/${w}/locations/${locationId}/content`,
      ),
  });
}
