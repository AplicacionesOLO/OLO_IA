/**
 * HOOKS DE REACT QUERY — Perception.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePerceptionRepo } from './PerceptionProvider';
import type { ReconcileSource } from './repository';
import type {
  CreateJobInput,
  DetectionFilter,
  ProcessingStatus,
  ReviewDecision,
} from './types';

const K = {
  jobs: ['perception', 'jobs'] as const,
  jobsConArchivadas: ['perception', 'jobs', 'con-archivadas'] as const,
  mediaUrl: (id: string) => ['perception', 'media-url', id] as const,
  deletable: (id: string) => ['perception', 'deletable', id] as const,
  job: (id: string) => ['perception', 'job', id] as const,
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

export function usePerceptionJob(jobId: string | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: K.job(jobId ?? ''),
    enabled: Boolean(jobId),
    queryFn: () => repo.getJob(jobId!),
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

export function useDetections(filter: DetectionFilter | null) {
  const repo = usePerceptionRepo();
  return useQuery({
    queryKey: filter ? K.detections(filter) : ['perception', 'detections', '__disabled__'],
    enabled: Boolean(filter),
    queryFn: () => repo.getDetections(filter!),
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
