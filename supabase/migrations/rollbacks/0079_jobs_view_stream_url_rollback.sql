-- Rollback de 0079: la vista deja de decir de donde lee un directo, y el worker no
-- puede abrirlos. Solo tiene sentido junto con el rollback de 0078.
--
-- Se recrea la definicion de 0069 tal cual, CON security_invoker: sin el, un operador
-- veria los vuelos de otro.
DROP VIEW IF EXISTS perception.v_inference_jobs;

CREATE VIEW perception.v_inference_jobs AS
SELECT j.tenant_id, j.warehouse_id, j.id, j.name, j.status, j.pipeline,
       j.model_version_id, j.model_label, j.confidence_threshold, j.frame_sampling_rate,
       j.save_detected_frames, j.notes, j.frames_processed, j.frames_total,
       j.detection_count, j.elapsed_ms, j.error_message, j.queued_at, j.started_at,
       j.completed_at, j.created_at, j.created_by,
       m.id AS media_id, m.kind AS media_kind, m.original_filename AS media_filename,
       m.content_type AS media_content_type, m.bytes AS media_bytes,
       m.sha256 AS media_sha256, m.width AS media_width, m.height AS media_height,
       m.duration_ms AS media_duration_ms, m.total_frames AS media_total_frames,
       m.source AS media_source,
       (m.bucket IS NOT NULL AND m.object_path IS NOT NULL) AS media_available,
       (SELECT count(*) FROM perception.job_events e
         WHERE e.tenant_id = j.tenant_id AND e.job_id = j.id) AS event_count
  FROM perception.inference_jobs j
  JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;

ALTER VIEW perception.v_inference_jobs SET (security_invoker = true);
GRANT SELECT ON perception.v_inference_jobs TO olo_app;
