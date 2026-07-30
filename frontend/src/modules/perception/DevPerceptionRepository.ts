/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEV ONLY — adaptador temporal de Perception.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  DEV_DATASETS,
  DEV_DETECTIONS,
  DEV_JOBS,
  DEV_MODELS,
} from './dev-data';
import type { PerceptionRepository } from './repository';
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
    const job: PerceptionJob = {
      id: `job-${Date.now()}`,
      name: input.name,
      status: 'uploaded',
      media: {
        id: `media-${Date.now()}`,
        name: input.file.name,
        type: input.file.type.startsWith('video') ? 'video' : 'image',
        mime: input.file.type as PerceptionJob['media']['mime'],
        url: URL.createObjectURL(input.file),
        bytes: input.file.size,
        width: 1920,
        height: 1080,
        durationMs: input.file.type.startsWith('video') ? 30000 : null,
        totalFrames: input.file.type.startsWith('video') ? 900 : null,
      },
      projectId: input.projectId ?? null,
      warehouseId: input.warehouseId ?? null,
      zoneId: input.zoneId ?? null,
      modelId: input.modelId,
      modelName: DEV_MODELS[0]?.name ?? 'Modelo',
      modelVersion: DEV_MODELS[0]?.version ?? '1.0.0',
      confidenceThreshold: input.confidenceThreshold,
      frameSamplingRate: input.frameSamplingRate,
      saveDetectedFrames: input.saveDetectedFrames,
      framesProcessed: 0,
      framesTotal: input.file.type.startsWith('video') ? 900 : 1,
      elapsedMs: 0,
      estimatedRemainingMs: null,
      detectionCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
    };
    return job;
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
    // No-op in dev. Saved locally by the review store.
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
