-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0100 · Se quita la copia para ver
--
-- ORDEN: primero la vista y despues la columna. Al reves PostgreSQL se niega, porque la
-- vista depende de `preview_path`.
--
-- Ojo con lo que ESTO NO BORRA: los objetos de la copia siguen en Storage. Se dejan a
-- proposito —borrar bytes desde un rollback de esquema es justo el tipo de accion
-- irreversible que un rollback no deberia hacer— y ocupan un 0,9 % de lo que ocupa el
-- material original. Si hace falta limpiarlos, se hace explicitamente y a la vista.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW perception.v_inference_jobs
WITH (security_invoker = true) AS
SELECT j.tenant_id,
       j.warehouse_id,
       j.id,
       j.name,
       j.status,
       j.pipeline,
       j.model_version_id,
       j.model_label,
       j.confidence_threshold,
       j.frame_sampling_rate,
       j.save_detected_frames,
       j.notes,
       j.frames_processed,
       j.frames_total,
       j.detection_count,
       j.elapsed_ms,
       j.error_message,
       j.queued_at,
       j.started_at,
       j.completed_at,
       j.created_at,
       j.created_by,
       m.id AS media_id,
       m.kind AS media_kind,
       m.original_filename AS media_filename,
       m.content_type AS media_content_type,
       m.bytes AS media_bytes,
       m.sha256 AS media_sha256,
       m.width AS media_width,
       m.height AS media_height,
       m.duration_ms AS media_duration_ms,
       m.total_frames AS media_total_frames,
       m.source AS media_source,
       m.stream_url AS media_stream_url,
       m.bucket IS NOT NULL AND m.object_path IS NOT NULL AS media_available,
       (SELECT count(*) AS count
          FROM perception.job_events e
         WHERE e.tenant_id = j.tenant_id AND e.job_id = j.id) AS event_count,
       j.archived_at,
       j.archived_by
  FROM perception.inference_jobs j
  JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;

GRANT SELECT ON perception.v_inference_jobs TO olo_app, authenticated;

ALTER TABLE perception.media DROP COLUMN IF EXISTS preview_path;

DO $$
BEGIN
    RAISE NOTICE 'OK - 0100 deshecha. Los objetos de las copias siguen en Storage: '
                 'borrarlos es una accion aparte y explicita.';
END $$;
