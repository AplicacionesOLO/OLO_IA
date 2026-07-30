/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEV ONLY — fixtures pequeños, deterministas, documentados.
 *
 * NO son detecciones reales. NO simulan inferencia.
 * Existen para que las pantallas funcionen sin backend.
 * Claramente marcados como "Datos simulados" en la UI.
 * ═══════════════════════════════════════════════════════════════════════════
 */

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
  },
];

export const DEV_JOBS: PerceptionJob[] = [
  {
    id: 'job-001',
    name: 'Inspeccion Pasillo 3',
    status: 'completed',
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
    modelId: 'model-detect-v1',
    modelName: 'OLO Detect v1',
    modelVersion: '1.0.0',
    confidenceThreshold: 0.5,
    frameSamplingRate: 1,
    saveDetectedFrames: false,
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
    id: 'job-002',
    name: 'Video Recepcion',
    status: 'processing',
    media: {
      id: 'media-002',
      name: 'recepcion_20260730.mp4',
      type: 'video',
      mime: 'video/mp4',
      url: '',
      bytes: 85_000_000,
      width: 1920,
      height: 1080,
      durationMs: 60_000,
      totalFrames: 1800,
    },
    projectId: null,
    warehouseId: '55555555-5555-4555-8555-555555555555',
    zoneId: null,
    modelId: 'model-detect-v1',
    modelName: 'OLO Detect v1',
    modelVersion: '1.0.0',
    confidenceThreshold: 0.45,
    frameSamplingRate: 5,
    saveDetectedFrames: true,
    framesProcessed: 120,
    framesTotal: 360,
    elapsedMs: 24_000,
    estimatedRemainingMs: 48_000,
    detectionCount: 47,
    createdAt: '2026-07-30T11:00:00Z',
    completedAt: null,
    errorMessage: null,
  },
];

export const DEV_DETECTIONS: Detection[] = [
  {
    id: 'det-001', jobId: 'job-001', classId: 'cls-pallet', className: 'Pallet', classColor: '#22d9f5',
    confidence: 0.94, bbox: { x: 120, y: 200, width: 280, height: 320, format: 'pixels' },
    frameNumber: 0, timestampMs: null, thumbnailUrl: null, reviewStatus: 'pending',
  },
  {
    id: 'det-002', jobId: 'job-001', classId: 'cls-box', className: 'Caja', classColor: '#a78bfa',
    confidence: 0.87, bbox: { x: 450, y: 300, width: 150, height: 120, format: 'pixels' },
    frameNumber: 0, timestampMs: null, thumbnailUrl: null, reviewStatus: 'accepted',
  },
  {
    id: 'det-003', jobId: 'job-001', classId: 'cls-person', className: 'Persona', classColor: '#34e5b4',
    confidence: 0.72, bbox: { x: 800, y: 180, width: 120, height: 340, format: 'pixels' },
    frameNumber: 0, timestampMs: null, thumbnailUrl: null, reviewStatus: 'pending',
  },
  {
    id: 'det-004', jobId: 'job-001', classId: 'cls-forklift', className: 'Montacargas', classColor: '#fbbf24',
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
