/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEV ONLY — fixtures pequeños, deterministas, documentados.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { assertJobStatusTransition } from './stateMachine';
import type {
  DatasetSummary,
  Detection,
  DetectionClass,
  ModelSummary,
  PerceptionJob,
} from './types';

export const DEV_CLASSES: DetectionClass[] = [
  { id: 'cls-pallet', name: 'Pallet', color: '#22d9f5' },
  { id: 'cls-box', name: 'Caja', color: '#a78bfa' },
  { id: 'cls-person', name: 'Persona', color: '#34e5b4' },
  { id: 'cls-forklift', name: 'Montacargas', color: '#fbbf24' },
];

export const DEV_MODELS: ModelSummary[] = [
  {
    id: 'model-detect-v1',
    name: 'OLO Detect v1',
    architecture: 'yolo11n',
    task: 'detect',
    version: '1.0.0',
    classes: DEV_CLASSES,
    isActive: true,
    supportedPipelines: ['object-detection', 'detection-ocr'],
  },
  {
    id: 'model-ocr-v1',
    name: 'OLO OCR v1',
    architecture: 'paddleocr',
    task: 'ocr',
    version: '1.0.0',
    classes: [],
    isActive: true,
    supportedPipelines: ['ocr', 'detection-ocr'],
  },
];

export const DEV_JOBS: PerceptionJob[] = [
  {
    id: 'job-demo-001',
    name: 'Demo: Inspeccion Pasillo 3',
    status: 'completed',
    statusHistory: [
      { from: 'draft', to: 'uploading', occurredAt: '2026-07-30T09:59:50Z' },
      { from: 'uploading', to: 'uploaded', occurredAt: '2026-07-30T09:59:52Z' },
      { from: 'uploaded', to: 'queued', occurredAt: '2026-07-30T09:59:53Z' },
      { from: 'queued', to: 'running', occurredAt: '2026-07-30T09:59:55Z' },
      { from: 'running', to: 'completed', occurredAt: '2026-07-30T10:00:01Z' },
    ],
    source: 'demo',
    processingAvailable: false,
    mediaAvailable: false,
    media: {
      id: 'media-001',
      name: 'pasillo3_cam02.jpg',
      type: 'image',
      mime: 'image/jpeg',
      url: '',
      bytes: 2_400_000,
      width: 1920,
      height: 1080,
      durationMs: null,
      totalFrames: null,
    },
    projectId: null,
    warehouseId: '55555555-5555-4555-8555-555555555555',
    zoneId: null,
    config: {
      pipeline: 'object-detection',
      modelId: 'model-detect-v1',
      confidenceThreshold: 0.5,
      frameSamplingRate: 1,
      saveDetectedFrames: false,
      notes: '',
    },
    modelName: 'OLO Detect v1',
    modelVersion: '1.0.0',
    framesProcessed: 1,
    framesTotal: 1,
    elapsedMs: 340,
    estimatedRemainingMs: null,
    detectionCount: 4,
    createdAt: '2026-07-30T10:00:00Z',
    completedAt: '2026-07-30T10:00:01Z',
    errorMessage: null,
  },
  {
    id: 'job-demo-002',
    name: 'Demo: Fallido en subida',
    status: 'failed',
    statusHistory: [
      { from: 'draft', to: 'uploading', occurredAt: '2026-07-30T11:00:00Z' },
      { from: 'uploading', to: 'failed', occurredAt: '2026-07-30T11:00:05Z', reason: 'Storage timeout after 5s' },
    ],
    source: 'demo',
    processingAvailable: false,
    mediaAvailable: false,
    media: {
      id: 'media-002',
      name: 'video_grande.mp4',
      type: 'video',
      mime: 'video/mp4',
      url: '',
      bytes: 200_000_000,
      width: 3840,
      height: 2160,
      durationMs: 120_000,
      totalFrames: 3600,
    },
    projectId: null,
    warehouseId: '55555555-5555-4555-8555-555555555555',
    zoneId: null,
    config: {
      pipeline: 'object-detection',
      modelId: 'model-detect-v1',
      confidenceThreshold: 0.45,
      frameSamplingRate: 2,
      saveDetectedFrames: true,
      notes: '',
    },
    modelName: 'OLO Detect v1',
    modelVersion: '1.0.0',
    framesProcessed: 0,
    framesTotal: 1800,
    elapsedMs: 5000,
    estimatedRemainingMs: null,
    detectionCount: 0,
    createdAt: '2026-07-30T11:00:00Z',
    completedAt: null,
    errorMessage: 'Storage timeout after 5s',
  },
  {
    id: 'job-demo-003',
    name: 'Demo: Fallido en procesamiento',
    status: 'failed',
    statusHistory: [
      { from: 'draft', to: 'uploading', occurredAt: '2026-07-30T12:00:00Z' },
      { from: 'uploading', to: 'uploaded', occurredAt: '2026-07-30T12:00:03Z' },
      { from: 'uploaded', to: 'queued', occurredAt: '2026-07-30T12:00:04Z' },
      { from: 'queued', to: 'running', occurredAt: '2026-07-30T12:00:10Z' },
      { from: 'running', to: 'failed', occurredAt: '2026-07-30T12:01:22Z', reason: 'GPU OOM: model requires 8GB VRAM' },
    ],
    source: 'demo',
    processingAvailable: false,
    mediaAvailable: false,
    media: {
      id: 'media-003',
      name: 'zona_a_4k.png',
      type: 'image',
      mime: 'image/png',
      url: '',
      bytes: 18_000_000,
      width: 3840,
      height: 2160,
      durationMs: null,
      totalFrames: null,
    },
    projectId: null,
    warehouseId: '55555555-5555-4555-8555-555555555555',
    zoneId: null,
    config: {
      pipeline: 'detection-ocr',
      modelId: 'model-detect-v1',
      confidenceThreshold: 0.3,
      frameSamplingRate: 1,
      saveDetectedFrames: false,
      notes: 'Test con imagen 4K',
    },
    modelName: 'OLO Detect v1',
    modelVersion: '1.0.0',
    framesProcessed: 0,
    framesTotal: 1,
    elapsedMs: 72_000,
    estimatedRemainingMs: null,
    detectionCount: 0,
    createdAt: '2026-07-30T12:00:00Z',
    completedAt: null,
    errorMessage: 'GPU OOM: model requires 8GB VRAM',
  },
  {
    id: 'job-demo-004',
    name: 'Demo: Cancelado',
    status: 'cancelled',
    statusHistory: [
      { from: 'draft', to: 'uploading', occurredAt: '2026-07-30T13:00:00Z' },
      { from: 'uploading', to: 'uploaded', occurredAt: '2026-07-30T13:00:02Z' },
      { from: 'uploaded', to: 'cancelled', occurredAt: '2026-07-30T13:00:10Z', reason: 'Cancelado por el usuario' },
    ],
    source: 'demo',
    processingAvailable: false,
    mediaAvailable: false,
    media: {
      id: 'media-004',
      name: 'recepcion_cam1.jpg',
      type: 'image',
      mime: 'image/jpeg',
      url: '',
      bytes: 1_800_000,
      width: 1920,
      height: 1080,
      durationMs: null,
      totalFrames: null,
    },
    projectId: null,
    warehouseId: '66666666-6666-4666-8666-666666666666',
    zoneId: null,
    config: {
      pipeline: 'ocr',
      modelId: 'model-ocr-v1',
      confidenceThreshold: 0.6,
      frameSamplingRate: 1,
      saveDetectedFrames: false,
      notes: '',
    },
    modelName: 'OLO OCR v1',
    modelVersion: '1.0.0',
    framesProcessed: 0,
    framesTotal: 1,
    elapsedMs: 0,
    estimatedRemainingMs: null,
    detectionCount: 0,
    createdAt: '2026-07-30T13:00:00Z',
    completedAt: null,
    errorMessage: null,
  },
];

export const DEV_DETECTIONS: Detection[] = [
  {
    id: 'det-001', jobId: 'job-demo-001', classId: 'cls-pallet', className: 'Pallet', classColor: '#22d9f5',
    confidence: 0.94, bbox: { x: 120, y: 200, width: 280, height: 320, format: 'pixels' },
    frameNumber: 0, timestampMs: null, thumbnailUrl: null, reviewStatus: 'pending',
  },
  {
    id: 'det-002', jobId: 'job-demo-001', classId: 'cls-box', className: 'Caja', classColor: '#a78bfa',
    confidence: 0.87, bbox: { x: 450, y: 300, width: 150, height: 120, format: 'pixels' },
    frameNumber: 0, timestampMs: null, thumbnailUrl: null, reviewStatus: 'accepted',
  },
  {
    id: 'det-003', jobId: 'job-demo-001', classId: 'cls-person', className: 'Persona', classColor: '#34e5b4',
    confidence: 0.72, bbox: { x: 800, y: 180, width: 120, height: 340, format: 'pixels' },
    frameNumber: 0, timestampMs: null, thumbnailUrl: null, reviewStatus: 'pending',
  },
  {
    id: 'det-004', jobId: 'job-demo-001', classId: 'cls-forklift', className: 'Montacargas', classColor: '#fbbf24',
    confidence: 0.61, bbox: { x: 1200, y: 400, width: 350, height: 280, format: 'pixels' },
    frameNumber: 0, timestampMs: null, thumbnailUrl: null, reviewStatus: 'rejected',
  },
];

export const DEV_DATASETS: DatasetSummary[] = [
  {
    id: 'ds-001', name: 'Almacen Central v1', imageCount: 124,
    classCounts: { Pallet: 312, Caja: 89, Persona: 45, Montacargas: 23 },
    accepted: 98, corrected: 12, rejected: 14,
    trainCount: 90, validationCount: 20, testCount: 14,
    createdAt: '2026-07-28T09:00:00Z',
  },
];

// ── Guarda de coherencia de los fixtures ────────────────────────────────────
//
// Estos jobs declaran `status` y `statusHistory` por separado, escritos a mano.
// Es lo unico razonable para un fixture —construirlos con `changeJobStatus` los
// haria ilegibles— pero deja abierta la puerta a que divergan: alguien cambia el
// `status` a mano y se olvida de la ultima transicion.
//
// Un job con `status: 'failed'` cuyo historial acaba en `running` no rompe la
// compilacion, y en pantalla produce justo el defecto que el historial existe
// para evitar: `getFailurePoint()` devuelve `null` y el fallo pierde su etapa.
//
// Esta comprobacion corre al importar el modulo, SOLO en desarrollo, y lanza con
// el id del fixture culpable. Cuesta microsegundos sobre cuatro objetos y convierte
// un defecto silencioso en un error de arranque.
if (import.meta.env.DEV) {
  for (const job of DEV_JOBS) {
    const hist = job.statusHistory;
    if (hist.length === 0) {
      throw new Error(`[Perception fixtures] '${job.id}' no tiene statusHistory.`);
    }
    const primera = hist[0]!;
    if (primera.from !== 'draft') {
      throw new Error(
        `[Perception fixtures] '${job.id}': el historial empieza en ` +
          `'${primera.from}' y todo job nace en 'draft'.`,
      );
    }
    for (let i = 1; i < hist.length; i += 1) {
      const previa = hist[i - 1]!;
      const actual = hist[i]!;
      if (actual.from !== previa.to) {
        throw new Error(
          `[Perception fixtures] '${job.id}': cadena rota — la transicion ${i} sale ` +
            `de '${actual.from}' pero la anterior llego a '${previa.to}'.`,
        );
      }
    }
    for (const t of hist) {
      assertJobStatusTransition(t.from, t.to);
    }
    const ultima = hist[hist.length - 1]!;
    if (ultima.to !== job.status) {
      throw new Error(
        `[Perception fixtures] '${job.id}': status es '${job.status}' pero el ` +
          `historial acaba en '${ultima.to}'. Los dos tienen que decir lo mismo.`,
      );
    }
  }
}
