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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, isTerminal } from '../../../lib/apiErrors';
import { SPATIAL_CONFIG } from '../config';
import { SpatialContractError } from '../repositories/mappers';
import type { FloorPlanCell, LocationFilter } from '../types/index';
import { spatialKeys } from './queryKeys';
import type { WarehouseMetricsPatch } from '../types/index';
import type { FiguraNueva } from '../figuras';
import type { ParadaNueva } from '../simulacion/tipos';
import {
  useFigurasRepo,
  useRecorridosRepo,
  useInventoryRepo,
  useLayoutRemoto,
  useObservationRepo,
  useSpatialRepo,
} from './SpatialProvider';

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

// ── 8 · Layout publicado ────────────────────────────────────────────────────

/**
 * El layout publicado: donde esta cada rack, listo para dibujar.
 *
 * MISMA clave de cache que usa el panel de publicar del editor, y por eso el mapeo
 * vive en `publicacion.ts` y no aqui: publicar tiene que dejar al explorador
 * leyendo el layout nuevo. Si cada pantalla tuviera su clave —o peor, su forma— el
 * explorador seguiria mostrando la colocacion vieja sin ningun sintoma.
 */
export function useLayoutPublicado(warehouseId: string | null) {
  const remoto = useLayoutRemoto();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.layout(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => remoto.cargar(warehouseId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

// ── 9 · Observaciones y rutas ───────────────────────────────────────────────

/**
 * Las rutas del almacen, una por fuente.
 *
 * `staleTime` corto —15 s— y no el de los resumenes: las observaciones LLEGAN
 * mientras se mira. Un dron aterriza, sube su vuelo, y la pantalla tiene que
 * enterarse sin que nadie recargue. Con los 5 minutos de los resumenes, el operador
 * que acaba de ver aterrizar el dron veria «sin observaciones».
 */
export function useRutas(
  warehouseId: string | null,
  ventana: { desde?: string | undefined; hasta?: string | undefined } = {},
) {
  const repo = useObservationRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.routes(warehouseId ?? '', ventana.desde, ventana.hasta),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.rutas(warehouseId!, ventana, signal),
    staleTime: 15_000,
  });
}

export function useFuentesDeObservacion(warehouseId: string | null) {
  const repo = useObservationRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.observationSources(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.fuentes(warehouseId!, signal),
    staleTime: 60_000,
  });
}

export function useCoberturaDeObservacion(warehouseId: string | null) {
  const repo = useObservationRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.observationCoverage(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.cobertura(warehouseId!, signal),
    staleTime: 15_000,
  });
}

/** Historial, lo mas reciente primero. Incluye racks sin colocar. */
export function useObservaciones(
  warehouseId: string | null,
  source?: string | undefined,
) {
  const repo = useObservationRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.observations(warehouseId ?? '', source),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.observaciones(warehouseId!, { source }, signal),
    staleTime: 15_000,
  });
}

// ── 10 · Inventario y ocupación ─────────────────────────────────────────────
//
// `staleTime` largo —5 minutos, el de los resumenes— y no el corto de las
// observaciones. La razon es el ciclo del dato: una foto del WMS llega una vez al dia,
// no mientras se mira. Refrescar cada 15 s seria pedir 347 filas doce veces por minuto
// para obtener siempre lo mismo.

export function useInventoryResumen(warehouseId: string | null) {
  const repo = useInventoryRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.inventorySummary(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.resumen(warehouseId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

/**
 * EL ESTADO OBSERVADO DE CADA HUECO — la capa «Inspección» del visor.
 *
 * ── QUÉ RESPONDE, Y POR QUÉ NO ES LA OCUPACIÓN ────────────────────────────────
 *
 * `useOcupacionPorRack` dice lo que el WMS DECLARA. Esto dice lo que la cámara VIO, y
 * viene con los dos códigos sin mezclar —el leído y el declarado— porque la comparación
 * entre ambos es el producto.
 *
 * Hasta ahora el visor recibía `undefined` y el botón de la capa estaba deshabilitado:
 * el mapa enseñaba el catálogo y la ocupación declarada, y lo que se había visto se
 * quedaba en una tabla de otra pantalla.
 *
 * `rackId` acota: mirando UN alzado no hacen falta los huecos del almacén entero.
 */
export function useInspeccion(
  warehouseId: string | null,
  rackId?: string | undefined,
  activo = true,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.inspection(warehouseId ?? '', rackId),
    enabled: Boolean(warehouseId) && activo,
    queryFn: ({ signal }) => repo.getInspection(warehouseId!, rackId, signal),
    //  Más corto que el catálogo a propósito: el catálogo cambia cuando alguien importa
    //  un almacén, y esto cambia cada vez que se reconcilia un recorrido.
    staleTime: 30_000,
  });
}

/**
 * QUÉ CAMBIÓ desde el recorrido anterior.
 *
 * Es la memoria del producto: sin esto cada vuelo es una foto suelta. Lo que sigue
 * cuadrando no viene, así que una lista vacía significa «nada se movió», no «no hay datos».
 */
export function useCambiosInspeccion(
  warehouseId: string | null,
  rackId?: string | undefined,
) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.inspectionChanges(warehouseId ?? '', rackId),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.getInspectionChanges(warehouseId!, rackId, signal),
    staleTime: 60_000,
  });
}

/**
 * CUÁNTO se ha inspeccionado del almacén, y cuándo.
 *
 * Es el número que impide leer el silencio como salud. Va aparte de `useInspeccion`
 * porque agrega sobre las 29.310 ubicaciones del catálogo —no solo sobre lo leído— y eso
 * es una consulta cara que no hace falta repetir cada vez que se cambia de rack.
 */
export function useCoberturaInspeccion(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.inspectionCoverage(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.getInspectionCoverage(warehouseId!, signal),
    staleTime: 60_000,
  });
}

/**
 * LAS MEDIDAS DEL ALMACÉN, y la acción de medir.
 *
 * Se invalida al guardar porque el VISOR las usa: corregir el alto de un nivel tiene que
 * repintar los racks, no esperar a recargar. Es el único sitio del módulo donde una
 * escritura cambia lo que se dibuja.
 */
export function useMedidas(warehouseId: string | null) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.metrics(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.getMetrics(warehouseId!, signal),
    staleTime: 300_000,
  });
}

export function useGuardarMedidas(warehouseId: string | null) {
  const repo = useSpatialRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: WarehouseMetricsPatch) => repo.putMetrics(warehouseId!, patch),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.metrics(warehouseId ?? '') });
    },
  });
}

// ── FIGURAS 3D (0093) ────────────────────────────────────────────────────────
//
// El plano dibuja racks y nada más. Para juzgar si un pasillo da o si el dron pasa entre dos
// hileras hace falta ver, A ESCALA, las cosas que se mueven — y eso no se dibuja con cajas—.

/**
 * El catálogo: la biblioteca de la plataforma más la propia.
 *
 * `staleTime` largo porque una biblioteca de modelos no cambia sola: cambia cuando alguien
 * sube uno, y entonces la mutación la invalida.
 */
export function useFiguras() {
  const repo = useFigurasRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.assets(),
    queryFn: ({ signal }) => repo.catalogo(signal),
    staleTime: 600_000,
  });
}

/** Las figuras COLOCADAS en un plano. Es lo que la vista 3D dibuja. */
export function useFigurasColocadas(warehouseId: string | null) {
  const repo = useFigurasRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.placedAssets(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.colocadas(warehouseId!, signal),
    staleTime: 60_000,
  });
}

/**
 * Subir una figura. Tres pasos, y el del medio no pasa por el backend.
 *
 * `retry: false` a propósito: reintentar solo repetiría la subida de 60 MB, y si el paso
 * que falló fue el registro, el objeto ya está en el bucket y el segundo intento lo
 * sobrescribiría con los mismos bytes. Quien decide reintentar es quien mira.
 */
export function useSubirFigura() {
  const repo = useFigurasRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nueva: FiguraNueva) => repo.subir(nueva),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.assets() });
    },
  });
}

/** Colocar una figura en el plano. Invalida las colocadas: la vista tiene que repintar. */
export function useColocarFigura(warehouseId: string | null) {
  const repo = useFigurasRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (datos: {
      modelId: string;
      xM: number;
      yM: number;
      zM?: number;
      rotationDeg?: number;
      scale?: number;
      label?: string | null;
    }) => repo.colocar(warehouseId!, datos),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.placedAssets(warehouseId ?? '') });
    },
  });
}

export function useMoverFigura(warehouseId: string | null) {
  const repo = useFigurasRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      instanceId,
      ...p
    }: {
      instanceId: string;
      xM?: number;
      yM?: number;
      zM?: number;
      rotationDeg?: number;
      scale?: number;
      label?: string | null;
    }) => repo.mover(instanceId, p),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.placedAssets(warehouseId ?? '') });
    },
  });
}

export function useQuitarFigura(warehouseId: string | null) {
  const repo = useFigurasRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) => repo.quitar(instanceId),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.placedAssets(warehouseId ?? '') });
    },
  });
}

/**
 * Retirar del catálogo. Invalida las dos cosas.
 *
 * Las COLOCADAS también, porque la consulta del plano cruza con `m.deleted_at IS NULL`: una
 * figura retirada desaparece de los planos que la usaban, y sin invalidar seguiría dibujada
 * hasta recargar.
 */
export function useRetirarFigura(warehouseId: string | null) {
  const repo = useFigurasRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => repo.retirarDelCatalogo(modelId),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.assets() });
      void qc.invalidateQueries({ queryKey: spatialKeys.placedAssets(warehouseId ?? '') });
    },
  });
}

// ── RECORRIDOS (0094) ────────────────────────────────────────────────────────

/** Los recorridos de un almacén, con cuántas paradas tiene cada uno. */
export function useRecorridos(warehouseId: string | null) {
  const repo = useRecorridosRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.trips(warehouseId ?? ''),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.lista(warehouseId!, signal),
    staleTime: 120_000,
  });
}

/** Un recorrido CON sus paradas. Es lo que la simulación necesita. */
export function useRecorrido(tripId: string | null) {
  const repo = useRecorridosRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.trip(tripId ?? ''),
    enabled: Boolean(tripId),
    queryFn: ({ signal }) => repo.uno(tripId!, signal),
    staleTime: 60_000,
  });
}

export function useCrearRecorrido(warehouseId: string | null) {
  const repo = useRecorridosRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (datos: { name: string; speedMps?: number }) =>
      repo.crear(warehouseId!, datos),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.trips(warehouseId ?? '') });
    },
  });
}

/**
 * Guardar las paradas. Invalida el recorrido Y la lista.
 *
 * La lista también porque lleva el recuento de paradas: sin invalidarla, seguiría diciendo
 * «3 paradas» después de añadir la cuarta, y ese número es lo que distingue un recorrido
 * terminado de uno a medias.
 */
export function useGuardarParadas(warehouseId: string | null) {
  const repo = useRecorridosRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, paradas }: { tripId: string; paradas: ParadaNueva[] }) =>
      repo.guardarParadas(tripId, paradas),
    retry: false,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: spatialKeys.trip(r.id) });
      void qc.invalidateQueries({ queryKey: spatialKeys.trips(warehouseId ?? '') });
    },
  });
}

export function useActualizarRecorrido(warehouseId: string | null) {
  const repo = useRecorridosRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tripId,
      ...p
    }: {
      tripId: string;
      name?: string;
      speedMps?: number;
      modelId?: string | null;
    }) => repo.actualizar(tripId, p),
    retry: false,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: spatialKeys.trip(r.id) });
      void qc.invalidateQueries({ queryKey: spatialKeys.trips(warehouseId ?? '') });
    },
  });
}

export function useBorrarRecorrido(warehouseId: string | null) {
  const repo = useRecorridosRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => repo.borrar(tripId),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spatialKeys.trips(warehouseId ?? '') });
    },
  });
}

/** Ocupación por rack: lo que colorea el mapa de calor y el visor 3D. */
export function useOcupacionPorRack(warehouseId: string | null, activo = true) {
  const repo = useInventoryRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.rackOccupancy(warehouseId ?? ''),
    enabled: Boolean(warehouseId) && activo,
    queryFn: ({ signal }) => repo.porRack(warehouseId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

/**
 * La situacion del WMS de CADA HUECO de los racks colocados, para pintar el plano 3D.
 *
 * `activo` para no pedirla cuando la capa esta apagada: son 122 KB y una peticion de dos
 * segundos y medio que nadie va a mirar. Es el mismo criterio que `useOcupacionPorRack`.
 *
 * Cache larga a proposito: el dato viene de una importacion, no de un sensor. Volver a pedirlo
 * cada vez que la pestaña recupera el foco seria gastar la red por algo que cambia una vez a
 * la semana — y la FECHA del dato viaja con el, asi que la pantalla siempre puede decir de
 * cuando es lo que se esta viendo—.
 */
export function useOcupacionPorHueco(warehouseId: string | null, activo = true) {
  const repo = useSpatialRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.slotOccupancy(warehouseId ?? ''),
    enabled: Boolean(warehouseId) && activo,
    queryFn: ({ signal }) => repo.ocupacionPorHueco(warehouseId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

export function useOcupacionPorUbicacion(
  warehouseId: string | null,
  opciones: { rackId?: string | undefined; occupied?: boolean | undefined } = {},
) {
  const repo = useInventoryRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.locationOccupancy(warehouseId ?? '', opciones.rackId, opciones.occupied),
    enabled: Boolean(warehouseId),
    queryFn: ({ signal }) => repo.porUbicacion(warehouseId!, opciones, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

/** Qué hay en un hueco. `null` como `locationId` no dispara la petición. */
export function useContenidoDeUbicacion(
  warehouseId: string | null,
  locationId: string | null,
) {
  const repo = useInventoryRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.locationContent(warehouseId ?? '', locationId ?? ''),
    enabled: Boolean(warehouseId && locationId),
    queryFn: ({ signal }) => repo.contenido(warehouseId!, locationId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}

export function useDescuadres(warehouseId: string | null, activo = true) {
  const repo = useInventoryRepo();
  return useQuery({
    ...COMUN,
    queryKey: spatialKeys.inventoryMismatches(warehouseId ?? ''),
    enabled: Boolean(warehouseId) && activo,
    queryFn: ({ signal }) => repo.descuadres(warehouseId!, signal),
    staleTime: SPATIAL_CONFIG.summaryCacheMs,
  });
}
