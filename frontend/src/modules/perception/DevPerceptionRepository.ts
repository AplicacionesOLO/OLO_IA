/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEV ONLY — adaptador temporal de Perception.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { DEV_DATASETS, DEV_DETECTIONS, DEV_JOBS, DEV_MODELS } from './dev-data';
import type { PerceptionRepository } from './repository';
import { applyJobTransitions } from './stateMachine';
import type {
  CreateJobInput,
  DatasetSummary,
  DetectionFilter,
  FrameAnnotation,
  ModelSummary,
  PaginatedDetections,
  PerceptionJob,
  ReviewDecision,
} from './types';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DevPerceptionRepository implements PerceptionRepository {
  async createJob(input: CreateJobInput): Promise<PerceptionJob> {
    await delay(200);
    const isVideo = input.file.type.startsWith('video');

    // El job NACE en `draft` con el historial vacio, y llega a su estado real
    // pasando por `changeJobStatus`. Escribir `status: 'uploaded'` directamente
    // seria mas corto y produciria un job cuyo historial no explica su estado —
    // exactamente lo que el historial existe para evitar.
    const draft: PerceptionJob = {
      id: `job-${Date.now()}`,
      name: input.name,
      status: 'draft',
      statusHistory: [],
      source: input.source,
      processingAvailable: false,
      mediaAvailable: true,
      media: {
        id: `media-${Date.now()}`,
        name: input.file.name,
        type: isVideo ? 'video' : 'image',
        mime: input.file.type as PerceptionJob['media']['mime'],
        url: URL.createObjectURL(input.file),
        bytes: input.file.size,
        width: 1920,
        height: 1080,
        durationMs: isVideo ? 30000 : null,
        totalFrames: isVideo ? 900 : null,
      },
      projectId: input.projectId ?? null,
      warehouseId: input.warehouseId ?? null,
      zoneId: input.zoneId ?? null,
      config: input.config,
      modelName: DEV_MODELS[0]?.name ?? 'Modelo',
      modelVersion: DEV_MODELS[0]?.version ?? '1.0.0',
      framesProcessed: 0,
      framesTotal: isVideo ? 900 : 1,
      elapsedMs: 0,
      estimatedRemainingMs: null,
      detectionCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
    };

    // Un archivo subido llega hasta `uploaded`. Un demo ya viene procesado, asi
    // que recorre la cadena completa. Las dos rutas las valida
    // `assertJobStatusTransition` en cada paso: una cadena imposible lanza aqui,
    // no en la pantalla que la muestre.
    const pasos: { to: PerceptionJob['status'] }[] =
      input.source === 'demo'
        ? [
            { to: 'uploading' },
            { to: 'uploaded' },
            { to: 'queued' },
            { to: 'running' },
            { to: 'completed' },
          ]
        : [{ to: 'uploading' }, { to: 'uploaded' }];

    return applyJobTransitions(draft, pasos);
  }

  async getJob(jobId: string): Promise<PerceptionJob | null> {
    await delay(80);
    return DEV_JOBS.find((j) => j.id === jobId) ?? null;
  }

  async listJobs(): Promise<PerceptionJob[]> {
    await delay(100);
    return DEV_JOBS;
  }

  async getDetections(filter: DetectionFilter): Promise<PaginatedDetections> {
    await delay(80);
    let items = DEV_DETECTIONS.filter((d) => d.jobId === filter.jobId);
    if (filter.classId) items = items.filter((d) => d.classId === filter.classId);
    if (filter.minConfidence) items = items.filter((d) => d.confidence >= filter.minConfidence!);
    if (filter.reviewStatus) items = items.filter((d) => d.reviewStatus === filter.reviewStatus);
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
  }

  async getFrameAnnotations(jobId: string, frameNumber: number): Promise<FrameAnnotation | null> {
    await delay(60);
    const dets = DEV_DETECTIONS.filter((d) => d.jobId === jobId && d.frameNumber === frameNumber);
    if (dets.length === 0) return null;
    return { frameNumber, timestampMs: 0, detections: dets, imageUrl: null };
  }

  async submitReview(_jobId: string, _decisions: ReviewDecision[]): Promise<void> {
    await delay(100);
  }

  async getDatasets(): Promise<DatasetSummary[]> {
    await delay(80);
    return DEV_DATASETS;
  }

  async getModels(): Promise<ModelSummary[]> {
    await delay(60);
    return DEV_MODELS;
  }
}
