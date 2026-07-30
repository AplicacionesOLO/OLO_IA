/**
 * PERCEPTION MODULE TYPES
 *
 * Contratos del frontend para Computer Vision / Perception.
 * No acoplados a una version concreta de YOLO.
 */

// ── Media ───────────────────────────────────────────────────────────────────

export type MediaType = 'image' | 'video';
export type MediaMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/quicktime' | 'video/x-msvideo';

export interface MediaAsset {
  id: string;
  name: string;
  type: MediaType;
  mime: MediaMime;
  url: string;
  bytes: number;
  width: number;
  height: number;
  /** Duracion en ms (solo video). */
  durationMs: number | null;
  /** Frames totales (solo video). */
  totalFrames: number | null;
}

// ── Job ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface PerceptionJob {
  id: string;
  name: string;
  status: JobStatus;
  media: MediaAsset;
  projectId: string | null;
  warehouseId: string | null;
  zoneId: string | null;
  modelId: string;
  modelName: string;
  modelVersion: string;
  confidenceThreshold: number;
  frameSamplingRate: number;
  saveDetectedFrames: boolean;
  // Progress
  framesProcessed: number;
  framesTotal: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  // Results
  detectionCount: number;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

// ── Detections ──────────────────────────────────────────────────────────────

export type BoundingBoxFormat = 'pixels' | 'normalized';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  format: BoundingBoxFormat;
}

export interface DetectionClass {
  id: string;
  name: string;
  color: string;
}

export interface Detection {
  id: string;
  jobId: string;
  classId: string;
  className: string;
  classColor: string;
  confidence: number;
  bbox: BoundingBox;
  frameNumber: number;
  timestampMs: number | null;
  /** Thumbnail URL (solo para listado). */
  thumbnailUrl: string | null;
  reviewStatus: ReviewStatus;
}

// ── Frame annotations ───────────────────────────────────────────────────────

export interface FrameAnnotation {
  frameNumber: number;
  timestampMs: number;
  detections: Detection[];
  imageUrl: string | null;
}

// ── Review ──────────────────────────────────────────────────────────────────

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'corrected';

export interface ReviewDecision {
  detectionId: string;
  status: ReviewStatus;
  /** Clase corregida (si se cambio). */
  correctedClassId: string | null;
  /** BBox corregido (si se ajusto). */
  correctedBbox: BoundingBox | null;
  /** Falso positivo. */
  isFalsePositive: boolean;
  /** Falso negativo (objeto no detectado, agregado manualmente). */
  isFalseNegative: boolean;
  comment: string | null;
}

// ── Dataset ─────────────────────────────────────────────────────────────────

export interface DatasetSummary {
  id: string;
  name: string;
  imageCount: number;
  classCounts: Record<string, number>;
  accepted: number;
  corrected: number;
  rejected: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  createdAt: string;
}

// ── Model ───────────────────────────────────────────────────────────────────

export interface ModelSummary {
  id: string;
  name: string;
  architecture: string;
  task: string;
  version: string;
  classes: DetectionClass[];
  isActive: boolean;
}

// ── Filters ─────────────────────────────────────────────────────────────────

export interface DetectionFilter {
  jobId: string;
  classId?: string | undefined;
  minConfidence?: number | undefined;
  maxConfidence?: number | undefined;
  reviewStatus?: ReviewStatus | undefined;
  frameStart?: number | undefined;
  frameEnd?: number | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface PaginatedDetections {
  items: Detection[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Job creation ────────────────────────────────────────────────────────────

export interface CreateJobInput {
  name: string;
  file: File;
  projectId?: string | undefined;
  warehouseId?: string | undefined;
  zoneId?: string | undefined;
  modelId: string;
  confidenceThreshold: number;
  frameSamplingRate: number;
  saveDetectedFrames: boolean;
}
