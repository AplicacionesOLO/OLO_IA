/**
 * HOOKS DE REACT QUERY — Perception.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { useSessionStore } from '../../auth/sessionStore';
import { env } from '../../lib/env';
import { usePerceptionRepo } from './PerceptionProvider';
import type { ReconcileSource } from './repository';
import type {
  CreateJobInput,
  DetectionFilter,
  ProcessingStatus,
  ReviewDecision,
  ReviewStatus,
} from './types';

const K = {
  jobs: ['perception', 'jobs'] as const,
  jobsConArchivadas: ['perception', 'jobs', 'con-archivadas'] as const,
  mediaUrl: (id: string) => ['perception', 'media-url', id] as const,
  deletable: (id: string) => ['perception', 'deletable', id] as const,
  job: (id: string) => ['perception', 'job', id] as const,
  allDetections: (jobId: string, reviewStatus?: string) =>
    ['perception', 'detections', 'todas', jobId, reviewStatus ?? ''] as const,
  detections: (filter: DetectionFilter) => ['perception', 'detections', filter.jobId, filter.classId ?? '', filter.reviewStatus ?? '', filter.page ?? 1] as const,
  frame: (jobId: string, frame: number) => ['perception', 'frame', jobId, frame] as const,
  models: ['perception', 'models'] as const,
  warehouses: ['perception', 'warehouses'] as const,
  reconciliation: (scanId: string) => ['perception', 'reconciliation', scanId] as const,
};

export function usePerceptionJobs(incluirArchivadas = false) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: incluirArchivadas ? K.jobsConArchivadas : K.jobs,
    queryFn: () => repo.listJobs(incluirArchivadas),
  });
}

/**
 * Un trabajo, y se REFRESCA SOLO mientras esté vivo.
 *
 * ── POR QUE HACE FALTA SONDEAR ────────────────────────────────────────────────
 *
 * El worker analiza en su máquina y va sumando fotogramas en la base. Sin sondeo, la
 * pantalla se quedaba con la foto del momento en que se abrió: «Procesando» sin que el
 * contador se moviera, que es indistinguible de un worker colgado. Era la mitad del
 * «no sabemos si está procesando algo o está detenido».
 *
 * 2 s mientras está en cola o corriendo, y NADA en cuanto termina: un trabajo
 * completado no cambia más, y seguir preguntando serían viajes al pooler —~260 ms cada
 * uno— para recibir siempre lo mismo.
 */
export function usePerceptionJob(jobId: string | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.job(jobId ?? ''),
    enabled: Boolean(jobId),
    queryFn: () => repo.getJob(jobId!),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'queued' || s === 'running' || s === 'uploading' ? 2000 : false;
    },
  });
}

export function useCreateJob() {
  const repo = usePerceptionRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJobInput) => repo.createJob(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.jobs }),
  });
}

/**
 * Las detecciones, sondeando mientras haya análisis en marcha.
 *
 * `vivo` lo decide quien llama, que es el que sabe el estado del trabajo: meter aquí
 * otra consulta del trabajo para averiguarlo duplicaría los viajes al pooler.
 *
 * Es lo que hace que las detecciones APAREZCAN mientras el worker trabaja, en vez de
 * salir todas de golpe al recargar.
 */
export function useDetections(filter: DetectionFilter | null, vivo = false) {
  const repo = usePerceptionRepo();
  return useQuery({
    refetchInterval: vivo ? 2000 : false,
    queryKey: filter ? K.detections(filter) : ['perception', 'detections', '__disabled__'],
    enabled: Boolean(filter),
    queryFn: () => repo.getDetections(filter!),
  });
}

/**
 * TODAS las detecciones del trabajo, para lo que necesita la línea de tiempo entera.
 *
 * La capa sobre el vídeo, la regleta y el modal de fotogramas la necesitan completa: con
 * la primera página de 50, en `dataset7` las cajas se apagaban en el segundo 6,4 de un
 * vídeo de 14,7 — más de la mitad sin dibujar y sin decir por qué—.
 */
export function useTodasLasDetecciones(
  jobId: string | null,
  vivo = false,
  reviewStatus?: ReviewStatus | undefined,
) {
  const repo = usePerceptionRepo();
  return useQuery({
    refetchInterval: vivo ? 2000 : false,
    queryKey: K.allDetections(jobId ?? '', reviewStatus),
    enabled: Boolean(jobId),
    queryFn: () =>
      repo.getAllDetections(jobId!, reviewStatus ? { reviewStatus } : {}),
  });
}

export function useFrameAnnotations(jobId: string | null, frameNumber: number | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.frame(jobId ?? '', frameNumber ?? -1),
    enabled: Boolean(jobId) && frameNumber !== null,
    queryFn: () => repo.getFrameAnnotations(jobId!, frameNumber!),
  });
}

export function useSubmitReview(jobId: string) {
  const repo = usePerceptionRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decisions: ReviewDecision[]) => repo.submitReview(jobId, decisions),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: K.job(jobId) });
      void qc.invalidateQueries({ queryKey: ['perception', 'detections', jobId] });
    },
  });
}

export function usePerceptionModels() {
  const repo = usePerceptionRepo();
  return useQuery({ queryKey: K.models, queryFn: () => repo.getModels(), staleTime: 5 * 60_000 });
}

/**
 * Almacenes accesibles. `staleTime` alto: la lista de almacenes de una empresa no
 * cambia mientras alguien rellena un formulario.
 */
export function usePerceptionWarehouses() {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.warehouses,
    queryFn: () => repo.listWarehouses(),
    staleTime: 10 * 60_000,
  });
}


// ── Reconciliación contra el WMS ──────────────────────────────────────────

/**
 * Convierte las detecciones en lecturas de inventario y las compara con el WMS.
 *
 * ── SIN REINTENTO, Y NO ES UNA PRECAUCIÓN GENÉRICA ──────────────────────
 *
 * El endpoint NO es idempotente: cada llamada crea un recorrido (`scan`) nuevo. Un
 * reintento automático dejaría dos recorridos del mismo vuelo sin que nadie lo pidiera,
 * y los recuentos del inventario contarían dos veces lo mismo. Si falla, se le dice y
 * decide la persona.
 *
 * ── QUÉ SE INVALIDA ─────────────────────────────────────────────────────
 *
 * El trabajo, porque su estado no cambia pero sí lo hace lo que se puede hacer con él
 * —ya está reconciliado—. Lo que NO se invalida son las detecciones: reconciliar las
 * lee, no las toca.
 */
export function useReconcile(jobId: string) {
  const repo = usePerceptionRepo();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source: ReconcileSource = 'drone') => repo.reconcile(jobId, source),
    retry: false,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: K.job(jobId) });
      // El resultado se siembra en su clave: la pantalla lo puede leer con
      // `useReconciliation` sin una segunda ida al servidor.
      qc.setQueryData(K.reconciliation(r.scanId), r);
    },
  });
}

/**
 * DE HALLAZGO A TRABAJO: abre las incidencias de un recorrido.
 *
 * ── POR QUE ES UN PASO APARTE Y NO PARTE DE RECONCILIAR ───────────────────
 *
 * Porque reconciliar es MIRAR y esto es ASIGNAR trabajo a personas. Encadenarlos haría
 * que revisar un vuelo de prueba llenara la bandeja del almacén, y a los quince minutos
 * nadie la mira. La decisión de convertir un hallazgo en trabajo es de quien mira.
 *
 * Se puede pulsar dos veces sin miedo: un hueco que ya tiene incidencia abierta se salta
 * y se cuenta aparte.
 */
export function useAbrirIncidencias() {
  const repo = usePerceptionRepo();
  return useMutation({
    mutationFn: (scanId: string) => repo.abrirIncidencias(scanId),
    retry: false,
  });
}

/** El resultado de una reconciliación ya hecha. */
export function useReconciliation(scanId: string | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.reconciliation(scanId ?? 'ninguna'),
    queryFn: () => repo.getReconciliation(scanId as string),
    enabled: scanId !== null,
    retry: false,
  });
}


/**
 * La URL firmada para VER el material de la inspección.
 *
 * ── POR QUE ES UNA CONSULTA APARTE Y NO PARTE DEL TRABAJO ────────────────────
 *
 * La firma caduca en una hora. Metida en el trabajo, quedaría cacheada con él y una
 * pestaña abierta toda la mañana intentaría reproducir con una firma muerta: el
 * `<video>` fallaría sin decir por qué, que es la clase de fallo más difícil de
 * diagnosticar desde fuera.
 *
 * `staleTime` de 50 minutos y no de una hora: pedirla de nuevo justo cuando expira
 * dejaría una ventana en la que la URL entregada ya no sirve.
 *
 * Devuelve `null` cuando el medio no tiene bytes —un directo, o una inspección
 * registrada solo con metadatos—. `null` NO es un error: es «no hay nada que ver».
 */
export function useMediaUrl(jobId: string | null, habilitado = true) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.mediaUrl(jobId ?? ''),
    enabled: Boolean(jobId) && habilitado,
    retry: false,
    staleTime: 50 * 60_000,
    queryFn: () => repo.getMediaUrl(jobId!),
  });
}

/** Si la inspección se puede borrar, y si no, qué lo impide. */
export function useDeletable(jobId: string | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.deletable(jobId ?? ''),
    enabled: Boolean(jobId),
    retry: false,
    queryFn: () => repo.getDeletable(jobId!),
  });
}

/**
 * Archivar, desarchivar y borrar.
 *
 * Las tres invalidan la lista Y la lista con archivadas: son dos consultas distintas
 * y refrescar solo una dejaría la otra mintiendo hasta que alguien recargara.
 */
function useInvalidarInspecciones() {
  const qc = useQueryClient();
  return (jobId?: string) => {
    void qc.invalidateQueries({ queryKey: K.jobs });
    void qc.invalidateQueries({ queryKey: K.jobsConArchivadas });
    if (jobId) {
      void qc.invalidateQueries({ queryKey: K.job(jobId) });
      void qc.invalidateQueries({ queryKey: K.deletable(jobId) });
    }
  };
}

export function useArchiveJob() {
  const repo = usePerceptionRepo();
  const invalidar = useInvalidarInspecciones();
  return useMutation({
    mutationFn: (jobId: string) => repo.archiveJob(jobId),
    onSuccess: (_r, jobId) => invalidar(jobId),
  });
}

export function useUnarchiveJob() {
  const repo = usePerceptionRepo();
  const invalidar = useInvalidarInspecciones();
  return useMutation({
    mutationFn: (jobId: string) => repo.unarchiveJob(jobId),
    onSuccess: (_r, jobId) => invalidar(jobId),
  });
}

export function useDeleteJob() {
  const repo = usePerceptionRepo();
  const invalidar = useInvalidarInspecciones();
  return useMutation({
    mutationFn: (jobId: string) => repo.deleteJob(jobId),
    // Sin `jobId`: la inspección ya no existe, así que invalidar SU consulta la
    // volvería a pedir para recibir un 404. Solo se refrescan las listas.
    onSuccess: () => invalidar(),
  });
}


/**
 * Encolar, cancelar o reintentar.
 *
 * ── POR QUE ESTO NO EXISTIA Y HACIA FALTA ─────────────────────────────────────
 *
 * El backend NO encola solo, y con razón: encolar gasta el worker, y hacerlo al subir
 * dejaría al operador sin el paso donde revisa el umbral y el modelo. Pero el
 * repositorio tenía `changeStatus` y **ninguna pantalla lo llamaba**, así que no había
 * forma de encolar desde la aplicación.
 *
 * Consecuencia real, reportada: la inspección se quedaba en «Subido» para siempre, sin
 * detecciones, sin errores y sin nada que dijera qué faltaba. La respuesta a «¿cuándo
 * pasa a En cola?» era «nunca», porque nadie podía hacerlo.
 */
export function useChangeStatus() {
  const repo = usePerceptionRepo();
  const invalidar = useInvalidarInspecciones();
  return useMutation({
    mutationFn: ({
      jobId,
      to,
      reason,
    }: {
      jobId: string;
      to: ProcessingStatus;
      reason?: string;
    }) => repo.changeStatus(jobId, to, reason),
    onSuccess: (_r, v) => invalidar(v.jobId),
  });
}


/**
 * Sube un fotograma como imagen ANOTABLE del dataset.
 *
 * ── LOS TRES PASOS SON DEL CONTRATO, NO UN CAPRICHO ───────────────────────────
 *
 * `prepare` reserva la ruta —la genera el servidor, no se propone—, el binario va
 * DIRECTO a Storage sin atravesar el backend, y `confirm` registra la fila comprobando
 * que el objeto esté. Es el mismo camino que la subida de imágenes del módulo de IA, y
 * sus tres lecciones valen aquí igual:
 *
 *   · `kind`, `content_type` y `original_filename` van IDÉNTICOS en `prepare` y en
 *     `confirm`: el servidor deriva la ruta de ellos y la recalcula. Cambiar uno hace
 *     que busque un objeto que no está.
 *   · el token se lee en el momento de subir, no al montar: un lote de veinte
 *     fotogramas dura más que un refresco de JWT.
 *   · si `confirm` falla, el binario YA está en Storage y no hay fila. Se dice, porque
 *     quien reintenta debe saber que está dejando un objeto suelto y no duplicando.
 *
 * Lo propio de aquí es `source: 'frame'` y `frame_timestamp_ms`: es lo que distingue un
 * fotograma de una foto y lo que permite volver al vídeo a ver de dónde salió.
 */
export function useSubirFotograma(projectId: string | null) {
  const { api } = useAuth();
  const qc = useQueryClient();

  return useCallback(
    async ({
      blob,
      ms,
      indice,
      videoAssetId,
    }: {
      blob: Blob;
      ms: number;
      indice: number;
      videoAssetId: string;
    }) => {
      if (!projectId) throw new Error('Sin proyecto de IA al que mandar los fotogramas.');

      const nombre = `frame-${Math.round(ms)}ms.jpg`;
      const identidad = {
        kind: 'image' as const,
        content_type: 'image/jpeg',
        bytes: blob.size,
        original_filename: nombre,
      };

      const prep = await api.post<{
        asset_id: string;
        object_path: string;
        upload_url: string;
      }>(`/ai/projects/${projectId}/assets/prepare`, identidad);

      const token = useSessionStore.getState().tokens?.accessToken ?? null;
      const subida = await fetch(prep.upload_url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token ?? ''}`,
          apikey: env.supabaseAnonKey ?? '',
          'Content-Type': 'image/jpeg',
          'x-upsert': 'false',
        },
        body: blob,
      });
      if (!subida.ok) {
        const pista =
          subida.status === 403
            ? ' — Storage denegó la ruta: revisa que seas Platform Owner'
            : '';
        throw new Error(`Storage rechazó el fotograma (HTTP ${subida.status})${pista}`);
      }

      const sha = await sha256Hex(blob);
      const medidas = await medidasDeBlob(blob);

      try {
        await api.post(`/ai/projects/${projectId}/assets/confirm`, {
          ...identidad,
          asset_id: prep.asset_id,
          sha256: sha,
          ...(medidas ? { width: medidas.width, height: medidas.height } : {}),
          source: 'frame',
          frame_index: indice,
          frame_timestamp_ms: Math.round(ms),
          source_video_asset_id: videoAssetId,
        });
      } catch (e) {
        const causa = e instanceof Error ? e.message : 'fallo al confirmar';
        throw new Error(
          `${causa} — el fotograma se subió pero no quedó registrado ` +
            `(objeto sin registrar: ${prep.object_path})`,
        );
      }

      //  El dataset cambió: quien lo tenga abierto debe verlo sin recargar.
      void qc.invalidateQueries({ queryKey: ['ai', 'images'] });
      void qc.invalidateQueries({ queryKey: ['ai', 'assets'] });
    },
    [api, projectId, qc],
  );
}

/**
 * Registra el video de la inspeccion como material del proyecto y devuelve su asset.
 *
 * ── POR QUE ESTE PASO EXISTE ─────────────────────────────────────────────────────────
 *
 * Una imagen del dataset con `source='frame'` tiene que decir de que video salio, y ese
 * video tiene que ser un asset DEL MISMO proyecto (`chk_img_frame_coherente` y
 * `fk_img_video`). El video de la inspeccion vive en otro bucket y no era asset de nada,
 * asi que `confirm` respondia 422 «violates a data constraint» DESPUES de subir el
 * binario: el fotograma quedaba en Storage y sin registrar, que es la peor combinacion.
 *
 * El endpoint es idempotente —no copia bytes, solo apunta al objeto que ya esta ahi—, asi
 * que se llama antes de cada lote sin comprobar nada.
 */
export function useVincularVideo(projectId: string | null, jobId: string | null) {
  const { api } = useAuth();
  return useCallback(async (): Promise<string> => {
    if (!projectId) throw new Error('Esta inspeccion no tiene proyecto de IA asociado.');
    if (!jobId) throw new Error('Sin inspeccion de la que sacar los fotogramas.');
    const asset = await api.post<{ id: string }>(
      `/ai/projects/${projectId}/assets/link-inspection-video`,
      { job_id: jobId },
    );
    return asset.id;
  }, [api, jobId, projectId]);
}

/** SHA-256 en hexadecimal. El backend lo exige para casar el objeto con su fila. */
async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Alto y ancho de un JPEG ya en memoria.
 *
 * Se mide con `createImageBitmap` y no creando una object URL: aquí la URL habría que
 * revocarla, y olvidarlo deja el blob retenido — el mismo tropiezo que rompió la vista
 * previa del formulario de inspecciones.
 */
async function medidasDeBlob(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const medidas = { width: bmp.width, height: bmp.height };
    bmp.close();
    return medidas;
  } catch {
    return null;
  }
}


/**
 * Resuelve un codigo LEIDO en el hueco del catalogo al que apunta.
 *
 * ── POR QUE ESTO PUEDE EXISTIR ────────────────────────────────────────────────
 *
 * Los 29.310 huecos del catalogo llevan su codigo de cuatro niveles, asi que
 * `RCL47-C018-N01-2` apunta a UN hueco sin ambiguedad. Devuelve tambien su rack, porque el
 * explorador espacial navega por identificadores y necesita los dos: el rack para abrir su
 * alzado y el hueco para seleccionar la celda.
 *
 * Se piden los dos campos crudos del DTO en vez de usar el repositorio de `spatial`: traer
 * ese modulo entero para leer dos identificadores acoplaria Vision a la forma interna de
 * otro modulo, y aqui solo hace falta la respuesta.
 *
 * `null` es una respuesta legitima y no un error: significa que se leyo un codigo que el
 * catalogo no conoce, y eso es justo lo que la reconciliacion llama `unresolved`. No se
 * corrige ni se aproxima — «RCL104» y «RCL1O4» se diferencian en un caracter—.
 */
export function useResolverHueco() {
  const { api } = useAuth();
  return useCallback(
    async (codigo: string): Promise<{ locationId: string; rackId: string | null } | null> => {
      //  El identificador del hueco viaja como `location_id`, no como `id`: el contrato de
      //  `spatial` nombra cada nivel —`rack_id`, `bay_id`, `location_id`— para que un cliente
      //  no tenga que adivinar de que habla un `id` suelto. Dar por hecho `id` dejaba la URL
      //  con `location=undefined`, que navega igual y no selecciona nada.
      const res = await api.get<
        Array<{ location_id: string; rack_id: string | null; full_code: string }>
      >('/spatial/locations', { search: codigo, limit: 5 });
      const filas = Array.isArray(res) ? res : [];
      //  Se exige coincidencia EXACTA del codigo: `search` es una busqueda, asi que
      //  `RCL47-C018-N01-2` podria traer tambien vecinos, y abrir el mapa en el hueco de al
      //  lado seria peor que no abrirlo.
      const exacta = filas.find((f) => f.full_code === codigo);
      if (!exacta) return null;
      return { locationId: exacta.location_id, rackId: exacta.rack_id };
    },
    [api],
  );
}
