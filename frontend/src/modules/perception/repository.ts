/**
 * PERCEPTION REPOSITORY CONTRACT
 *
 * Endpoints esperados (Claude pendiente):
 *   POST /v1/perception/jobs
 *   GET  /v1/perception/jobs
 *   GET  /v1/perception/jobs/{jobId}
 *   GET  /v1/perception/jobs/{jobId}/detections
 *   GET  /v1/perception/jobs/{jobId}/frames/{frameNumber}
 *   POST /v1/perception/jobs/{jobId}/reviews
 *   GET  /v1/perception/models
 *   GET  /v1/perception/datasets
 */

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

export interface PerceptionRepository {
  createJob(input: CreateJobInput): Promise<PerceptionJob>;
  getJob(jobId: string): Promise<PerceptionJob | null>;
  listJobs(): Promise<PerceptionJob[]>;
  getDetections(filter: DetectionFilter): Promise<PaginatedDetections>;
  getFrameAnnotations(jobId: string, frameNumber: number): Promise<FrameAnnotation | null>;
  submitReview(jobId: string, decisions: ReviewDecision[]): Promise<void>;
  getDatasets(): Promise<DatasetSummary[]>;
  getModels(): Promise<ModelSummary[]>;
}
