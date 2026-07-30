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

export type ProcessingStatus =
  | 'draft'
  | 'uploading'
  | 'uploaded'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Pipeline de procesamiento. Determina QUE hace el worker, no solo QUE modelo usa. */
export type PipelineType = 'object-detection' | 'ocr' | 'detection-ocr';

export interface ProcessingPipeline {
  id: PipelineType;
  label: string;
  description: string;
  /** Modelos compatibles con este pipeline. */
  compatibleTasks: string[];
}

export interface ProcessingConfiguration {
  pipeline: PipelineType;
  modelId: string;
  confidenceThreshold: number;
  /** Frames por segundo a analizar (solo video). */
  frameSamplingRate: number;
  /** Guardar frames donde se detecte algo. */
  saveDetectedFrames: boolean;
  /** Observaciones del operador. */
  notes: string;
}

/** Capacidad del worker de inferencia. */
export interface WorkerCapability {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  supportedPipelines: PipelineType[];
  gpuAvailable: boolean;
  currentLoad: number;
}

export type JobSource = 'uploaded-file' | 'demo';

export interface PerceptionJob {
  id: string;
  name: string;
  status: ProcessingStatus;
  source: JobSource;
  media: MediaAsset;
  /** Si el worker esta conectado y puede procesar. */
  processingAvailable: boolean;
  /** Si el media aun esta accesible (object URL vive durante la sesion). */
  mediaAvailable: boolean;
  projectId: string | null;
  warehouseId: string | null;
  zoneId: string | null;
  config: ProcessingConfiguration;
  modelName: string;
  modelVersion: string;
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
  source: JobSource;
  projectId?: string | undefined;
  warehouseId?: string | undefined;
  zoneId?: string | undefined;
  config: ProcessingConfiguration;
}
