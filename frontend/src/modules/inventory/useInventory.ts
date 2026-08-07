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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../auth/AuthProvider';
import { useSessionStore } from '../../auth/sessionStore';
import type {
  Cluster,
  ClusterMember,
  FindResult,
  InventorySummary,
  LocationContent,
  LocationOccupancy,
  MismatchReport,
  RackOccupancyList,
  SnapshotHistory,
  Zone,
} from './types';

const K = {
  resumen: (w: string) => ['inventory', 'summary', w] as const,
  descuadres: (w: string) => ['inventory', 'mismatches', w] as const,
  racks: (w: string) => ['inventory', 'racks', w] as const,
  historial: (w: string) => ['inventory', 'snapshots', w] as const,
  rack: (w: string, r: string) => ['inventory', 'rack-locations', w, r] as const,
  buscar: (w: string, por: string, t: string) => ['inventory', 'find', w, por, t] as const,
  contenido: (w: string, l: string) => ['inventory', 'content', w, l] as const,
  zonas: (w: string) => ['inventory', 'zones', w] as const,
  clusters: (w: string) => ['inventory', 'clusters', w] as const,
  miembros: (c: string) => ['inventory', 'cluster-members', c] as const,
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
export function useDescuadres(
  clase?: string | null,
  pagina = 1,
  porPagina = 50,
  zona?: string | null,
) {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: [...K.descuadres(w ?? ''), clase ?? 'todos', zona ?? 'todas', pagina, porPagina],
    enabled: Boolean(w),
    // `placeholderData` deja la página anterior en pantalla mientras llega la siguiente.
    // Sin esto la tabla se vacía en cada salto y la página entera da un tirón de altura,
    // que contra el pooler —~260 ms— se ve en cada clic.
    placeholderData: (previa) => previa,
    queryFn: () => {
      const q = new URLSearchParams({ page: String(pagina), page_size: String(porPagina) });
      if (clase) q.set('kind', clase);
      if (zona) q.set('zone', zona);
      return api.get<MismatchReport>(`/inventory/warehouses/${w}/mismatches?${q.toString()}`);
    },
  });
}

/**
 * Las zonas por nomenclatura, para acotar la lista de descuadres.
 *
 * ⚠ El reparto real está muy sesgado: en OLO-CR `RCL` es el 92 % de los huecos. Esto
 *   sirve para filtrar rápido, no para organizar el almacén — para eso están las zonas
 *   definidas a mano, más abajo.
 */
export function useZonas() {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: K.zonas(w ?? ''),
    enabled: Boolean(w),
    queryFn: () => api.get<Zone[]>(`/inventory/warehouses/${w}/zones`),
  });
}

/**
 * ── ZONAS DEFINIDAS A MANO ───────────────────────────────────────────────────
 *
 * A diferencia del resto del módulo, esto SÍ se escribe: son datos que introduce una
 * persona y que nadie puede reconstruir desde el catálogo. De ahí las mutaciones.
 */
function useInvalidarZonas() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['inventory', 'clusters'] });
    void qc.invalidateQueries({ queryKey: ['inventory', 'cluster-members'] });
  };
}

export function useClusters() {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: K.clusters(w ?? ''),
    enabled: Boolean(w),
    queryFn: () => api.get<Cluster[]>(`/inventory/warehouses/${w}/clusters`),
  });
}

export function useMiembros(clusterId: string | null) {
  const { api } = useAuth();
  return useQuery({
    ...COMUN,
    queryKey: K.miembros(clusterId ?? ''),
    enabled: Boolean(clusterId),
    queryFn: () => api.get<ClusterMember[]>(`/inventory/clusters/${clusterId}/members`),
  });
}

export function useCrearCluster() {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  const invalidar = useInvalidarZonas();
  return useMutation({
    mutationFn: (body: { name: string; notes?: string | null }) =>
      api.post<Cluster>(`/inventory/warehouses/${w}/clusters`, body),
    onSuccess: invalidar,
  });
}

export function useBorrarCluster() {
  const { api } = useAuth();
  const invalidar = useInvalidarZonas();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/clusters/${id}`),
    onSuccess: invalidar,
  });
}

export function useAnadirMiembro() {
  const { api } = useAuth();
  const invalidar = useInvalidarZonas();
  return useMutation({
    mutationFn: ({
      clusterId,
      prefix,
      rackId,
    }: {
      clusterId: string;
      prefix?: string | null;
      rackId?: string | null;
    }) =>
      api.post<ClusterMember[]>(`/inventory/clusters/${clusterId}/members`, {
        prefix: prefix ?? null,
        rack_id: rackId ?? null,
      }),
    onSuccess: invalidar,
  });
}

export function useQuitarMiembro() {
  const { api } = useAuth();
  const invalidar = useInvalidarZonas();
  return useMutation({
    mutationFn: ({ clusterId, miembroId }: { clusterId: string; miembroId: string }) =>
      api.delete(`/inventory/clusters/${clusterId}/members/${miembroId}`),
    onSuccess: invalidar,
  });
}

/**
 * El historial de importaciones, lo más reciente primero.
 *
 * Incluye las que FALLARON, y es deliberado: alguien lo intentó y no salió. Esconderlo
 * haría que repitiera el intento a ciegas, sin saber que ya había fallado antes.
 */
export function useHistorial() {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: K.historial(w ?? ''),
    enabled: Boolean(w),
    queryFn: () => api.get<SnapshotHistory[]>(`/inventory/warehouses/${w}/snapshots`),
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

/**
 * Las ubicaciones de UN rack, con su ocupación.
 *
 * `limit` alto a propósito: un rack real tiene hasta 286 huecos —medido en RCL34— y el
 * alzado se pinta entero o no significa nada. Media estantería colorea de «vacío» lo
 * que simplemente no ha llegado, que es peor que no pintar nada.
 *
 * Incluye los huecos LIBRES, que son la mitad del dato: partiendo del stock solo se
 * verían los llenos, y «¿dónde queda sitio?» no tendría respuesta.
 */
export function useOcupacionDelRack(rackId: string | null) {
  const { api } = useAuth();
  const w = useAlmacenActivo();
  return useQuery({
    ...COMUN,
    queryKey: K.rack(w ?? '', rackId ?? ''),
    enabled: Boolean(w) && Boolean(rackId),
    queryFn: () =>
      api.get<LocationOccupancy[]>(
        `/inventory/warehouses/${w}/location-occupancy?rack_id=${rackId}&limit=500`,
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
