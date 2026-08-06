/**
 * HOOKS DE REACT QUERY — Perception.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePerceptionRepo } from './PerceptionProvider';
import type { ReconcileSource } from './repository';
import type { CreateJobInput, DetectionFilter, ReviewDecision } from './types';

const K = {
  jobs: ['perception', 'jobs'] as const,
  job: (id: string) => ['perception', 'job', id] as const,
  detections: (filter: DetectionFilter) => ['perception', 'detections', filter.jobId, filter.classId ?? '', filter.reviewStatus ?? '', filter.page ?? 1] as const,
  frame: (jobId: string, frame: number) => ['perception', 'frame', jobId, frame] as const,
  models: ['perception', 'models'] as const,
  warehouses: ['perception', 'warehouses'] as const,
  reconciliation: (scanId: string) => ['perception', 'reconciliation', scanId] as const,
};

export function usePerceptionJobs() {
  const repo = usePerceptionRepo();
  return useQuery({ queryKey: K.jobs, queryFn: () => repo.listJobs() });
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
