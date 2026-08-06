-- ══════════════════════════════════════════════════════════════════════════════
-- 0079 · La vista de trabajos dice de dónde lee un directo
--
-- Toca : perception.v_inference_jobs (añade 1 columna)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ HACE FALTA
--
-- 0078 añadió `perception.media.stream_url`, pero `v_inference_jobs` es lo ÚNICO que el
-- worker consulta de un trabajo. Sin exponerla, el worker recibe un trabajo con
-- `media_kind = 'stream'` y ninguna URL que abrir: sabe que es un directo y no sabe de
-- dónde leerlo.
--
-- Se recrea entera —`CREATE OR REPLACE VIEW` no admite insertar una columna en medio— y
-- se CONSERVA `security_invoker = true`, que aquí sí es lo correcto y es la diferencia
-- con `v_published_models`: las filas de `perception` SON de un tenant, así que RLS
-- tiene que aplicarse. Quitarlo enseñaría los vuelos de un operador a otro.
-- ══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS perception.v_inference_jobs;

CREATE VIEW perception.v_inference_jobs AS
-- La lista es la de 0069 con UNA columna añadida al final del bloque del medio. El
-- orden y los nombres se reproducen tal cual: `_JOB_COLS` del repositorio los enumera
-- explícitamente, así que renombrar o duplicar uno rompe la lectura sin avisar.
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
       m.id                AS media_id,
       m.kind              AS media_kind,
       m.original_filename AS media_filename,
       m.content_type      AS media_content_type,
       m.bytes             AS media_bytes,
       m.sha256            AS media_sha256,
       m.width             AS media_width,
       m.height            AS media_height,
       m.duration_ms       AS media_duration_ms,
       m.total_frames      AS media_total_frames,
       m.source            AS media_source,
       --  LO NUEVO. De dónde lee el worker en un directo. NULL en archivos, y ahí la
       --  URL no significa nada: los bytes están en Storage.
       m.stream_url        AS media_stream_url,
       -- Si los bytes están o no. Es lo que decide si la pantalla puede REPRODUCIR
       -- el medio o solo describirlo; sin esto, el reproductor intenta abrir una
       -- ruta nula y falla delante de quien mira.
       --
       -- Un directo NUNCA los tiene: no hay archivo. La pantalla lo distingue por
       -- `media_kind`, no por esta columna.
       (m.bucket IS NOT NULL AND m.object_path IS NOT NULL) AS media_available,
       (SELECT count(*) FROM perception.job_events e
         WHERE e.tenant_id = j.tenant_id AND e.job_id = j.id) AS event_count
  FROM perception.inference_jobs j
  JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;

ALTER VIEW perception.v_inference_jobs SET (security_invoker = true);

COMMENT ON VIEW perception.v_inference_jobs IS
    'Trabajo + medio + numero de transiciones. `media_available` dice si los bytes existen; `media_stream_url` de donde lee un directo. security_invoker: estas filas SI son de un tenant.';

GRANT SELECT ON perception.v_inference_jobs TO olo_app;


-- ── Verificación ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_invoker text;
    v_col     int;
BEGIN
    -- Al contrario que en `v_published_models`, aquí `security_invoker` DEBE estar. Es
    -- lo que impide que un operador vea los vuelos de otro, y recrear la vista es
    -- justo el momento en que se pierde si nadie lo comprueba.
    SELECT array_to_string(c.reloptions, ',') INTO v_invoker
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'perception' AND c.relname = 'v_inference_jobs';
    IF coalesce(v_invoker, '') NOT LIKE '%security_invoker%' THEN
        RAISE EXCEPTION
            'v_inference_jobs PERDIO security_invoker: enseñaria los vuelos de un tenant a otro';
    END IF;

    SELECT count(*) INTO v_col
      FROM information_schema.columns
     WHERE table_schema = 'perception' AND table_name = 'v_inference_jobs'
       AND column_name = 'media_stream_url';
    IF v_col <> 1 THEN
        RAISE EXCEPTION 'falta la columna media_stream_url';
    END IF;

    RAISE NOTICE '0079 OK · la vista dice de donde lee un directo, y sigue con RLS';
END $$;
