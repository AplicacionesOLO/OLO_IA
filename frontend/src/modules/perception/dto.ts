/**
 * DTOs de percepción — la forma EXACTA que devuelve la API.
 *
 * Snake_case, sin traducir. El mapeo a los tipos del módulo vive en el
 * repositorio, en un solo sitio: cuando el contrato cambie, romperá aquí y en el
 * mapeo, no repartido por cinco pantallas.
 *
 * Corresponde a `backend/src/olo/api/v1/schemas.py`, sección «Percepción» (0069).
 */

export interface JobEventDto {
  id: number;
  from_status: string | null;
  to_status: string;
  occurred_at: string;
  reason: string | null;
}

export interface ClassCountDto {
  class_name: string;
  n: number;
  confianza_media: number | null;
  casadas: number;
}

export interface JobDto {
  id: string;
  warehouse_id: string;
  name: string;
  status: string;
  pipeline: string;
  model_version_id: string | null;
  model_label: string | null;
  confidence_threshold: number;
  frame_sampling_rate: number | null;
  save_detected_frames: boolean;
  notes: string | null;
  frames_processed: number;
  frames_total: number | null;
  detection_count: number;
  elapsed_ms: number;
  error_message: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  media_id: string;
  media_kind: string;
  media_filename: string;
  media_content_type: string;
  media_bytes: number;
  media_sha256: string;
  media_width: number | null;
  media_height: number | null;
  media_duration_ms: number | null;
  media_total_frames: number | null;
  /** De donde lee el worker en un directo. `null` en archivos. Desde 0079. */
  media_stream_url?: string | null;
  media_source: string;
  /** Si los BYTES existen en el almacenamiento. Hoy siempre `false`. */
  media_available: boolean;
  media_has_preview?: boolean;
  /** Archivada. `null` si está activa. Archivar NO libera Storage. */
  archived_at?: string | null;
  event_count: number;
  events: JobEventDto[];
  class_counts: ClassCountDto[];
  worker_available: boolean;
}

export interface JobListDto {
  jobs: JobDto[];
  worker_available: boolean;
}

export interface DetectionDto {
  id: string;
  job_id: string;
  observed_at: string;
  ingested_at: string;
  frame_number: number;
  frame_ms: number | null;
  frame_ref: string | null;
  class_name: string;
  ai_class_id: string | null;
  class_color: string | null;
  confidence: number;
  bbox_x: number;
  bbox_y: number;
  bbox_width: number;
  bbox_height: number;
  bbox_format: string;
  text_value: string | null;
  state: string;
  rack_node_id: string | null;
  review_status: string;
  reviewed_at: string | null;
  review_comment: string | null;
  supersedes_id: string | null;
  is_manual: boolean;
}

export interface DetectionPageDto {
  items: DetectionDto[];
  total: number;
  page: number;
  page_size: number;
}

export interface FrameDto {
  frame_number: number;
  frame_ms: number | null;
  frame_ref: string | null;
  detections: DetectionDto[];
}

export interface ModelClassDto {
  id: string;
  name: string;
  index: number;
  color: string | null;
}

export interface PublishedModelDto {
  /** Proyecto de IA del modelo. Hace falta para mandar fotogramas a su dataset. */
  ai_project_id?: string | null;
  model_version_id: string;
  model_id: string;
  version: number;
  origin: string;
  published_at: string | null;
  name: string;
  slug: string;
  task: string;
  input_type: string;
  architecture_code: string | null;
  architecture_name: string | null;
  framework_code: string | null;
  classes: ModelClassDto[];
}

export interface ModelCatalogDto {
  models: PublishedModelDto[];
  worker_available: boolean;
  unavailable_reason: string | null;
}

export interface ReviewResultDto {
  applied: number;
  not_found: string[];
}

export interface PromoteResultDto {
  source_code: string;
  source_id: string | null;
  candidates: number;
  observations_created: number;
  matched: number;
  unresolved: { text: string; readings: number }[];
}

import type { ReconcileStatus } from './types';

// ── Reconciliación contra el WMS (0064) ───────────────────────────────────
export interface ReconcileRowDto {
  location_code: string | null;
  location_qr: string;
  content: string;
  pallet_qr: string;
  pallet_code_observed: string | null;
  expected_rows: number | null;
  expected_pallet: string | null;
  /** Todos los codigos que el WMS declara en ese hueco. */
  expected_pallets?: string[];
  wms_expects_pallet: boolean;
  status: ReconcileStatus;
  observed_at: string;
}

export interface ReconcileDto {
  scan_id: string;
  wms_snapshot_id: string | null;
  warning: string | null;
  detections: number;
  readings: number;
  empty_frames: number;
  /** Textos descartados por no tener forma de codigo: ruido del OCR. */
  discarded_texts: number;
  unknown_classes: string[];
  /** Etiquetas de hueco leidas bien que el catalogo no tiene. */
  unknown_locations?: string[];
  /** `cuantas` en castellano: es el alias de SQL del backend, tal cual llega. */
  summary: { status: ReconcileStatus; cuantas: number }[];
  rows: ReconcileRowDto[];
}

/** Lo que devuelve convertir un recorrido en incidencias. */
export interface ReconcileIncidentsDto {
  scan_id: string;
  created: number;
  skipped: number;
  skipped_locations: string[];
  incident_ids: string[];
  actionable_rows: number;
  total_rows: number;
}

export interface ReadingDiagnosisDto {
  job_id: string;
  etiquetas: number;
  leidas: number;
  ancho_mediano_px: number | null;
  veredicto: string;
  mensaje: string;
  acercarse: number | null;
}
