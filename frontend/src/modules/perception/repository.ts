/**
 * CONTRATO DEL REPOSITORIO DE PERCEPCIÓN.
 *
 * Los endpoints ya no están «pendientes»: existen desde la migración 0069 y este
 * contrato los refleja. La implementación es `ApiPerceptionRepository`.
 *
 *   POST /v1/perception/jobs                              crear
 *   GET  /v1/perception/jobs                              listar
 *   GET  /v1/perception/jobs/{jobId}                      detalle + historial
 *   POST /v1/perception/jobs/{jobId}/status               encolar, cancelar, reintentar
 *   GET  /v1/perception/jobs/{jobId}/detections           paginado y filtrable
 *   POST /v1/perception/jobs/{jobId}/detections           el extremo del WORKER
 *   GET  /v1/perception/jobs/{jobId}/frames/{frame}       un fotograma
 *   POST /v1/perception/jobs/{jobId}/reviews              revisar
 *   POST /v1/perception/jobs/{jobId}/promote              → observaciones de rack
 *   POST /v1/perception/jobs/{jobId}/reconcile            → lecturas de inventario
 *   GET  /v1/perception/scans/{scanId}/reconciliation     el resultado
 *   GET  /v1/perception/models                            catálogo publicado
 *
 * ── QUÉ SE HA QUITADO DEL CONTRATO, Y POR QUÉ ───────────────────────────────
 *
 * `getDatasets()`. No tenía ninguna pantalla que lo usara —el hook existía y nadie lo
 * llamaba— y, más importante, no tiene una fuente honesta desde aquí: los datasets
 * viven en el esquema `ai`, que es de régimen PLATFORM OWNER. Se midió que un usuario
 * de tenant ve CERO filas de `ai.projects`. Un método que devolvería siempre lista
 * vacía es peor que no tenerlo: parece una función que informa.
 *
 * El taller de anotación y datasets es otra pantalla, con su propia API, en
 * `src/features/ai/`.
 *
 * ── QUÉ SE HA AÑADIDO ───────────────────────────────────────────────────────
 *
 * `changeStatus`. La máquina de estados del frontend ya existía y no había forma de
 * mover un trabajo: `draft → uploaded` y ahí se acababa. Encolar y cancelar son
 * acciones reales de esta pantalla.
 */

import type {
  CreateJobInput,
  DetectionFilter,
  FrameAnnotation,
  ModelCatalog,
  PaginatedDetections,
  PerceptionJob,
  ProcessingStatus,
  ReconcileResult,
  ReviewDecision,
} from './types';

/** Con qué se capturó. `manual` y `seed` describen recorridos que no salen de aquí. */
export type ReconcileSource = 'drone' | 'video' | 'handheld';

export interface PerceptionRepository {
  createJob(input: CreateJobInput): Promise<PerceptionJob>;
  getJob(jobId: string): Promise<PerceptionJob | null>;
  listJobs(): Promise<PerceptionJob[]>;
  changeStatus(jobId: string, to: ProcessingStatus, reason?: string): Promise<PerceptionJob>;
  getDetections(filter: DetectionFilter): Promise<PaginatedDetections>;
  getFrameAnnotations(jobId: string, frameNumber: number): Promise<FrameAnnotation | null>;
  submitReview(jobId: string, decisions: ReviewDecision[]): Promise<void>;
  /**
   * Convierte las detecciones en lecturas de inventario y las compara con el WMS.
   *
   * NO es idempotente: cada llamada crea un recorrido nuevo. Dos reconciliaciones
   * del mismo vuelo son dos recorridos —quizá con otro corte del WMS de por medio—
   * y machacar el anterior perdería la comparación.
   */
  reconcile(jobId: string, source?: ReconcileSource): Promise<ReconcileResult>;
  /** El resultado de una reconciliación ya hecha. */
  getReconciliation(scanId: string): Promise<ReconcileResult>;
  /** El catálogo publicado Y si hay quien lo ejecute. Ver `ModelCatalog`. */
  getModels(): Promise<ModelCatalog>;
  /**
   * Almacenes accesibles, para elegir a cuál pertenece la inspección.
   *
   * Está en el contrato de percepción porque el formulario lo NECESITA: una
   * inspección es de un almacén y RLS lo exige. Antes el campo era opcional en el
   * tipo y la pantalla no lo mandaba nunca, así que el envío fallaba en el servidor
   * por un dato que nadie había preguntado.
   */
  listWarehouses(): Promise<{ id: string; code: string; name: string }[]>;
}
