-- ═══════════════════════════════════════════════════════════════════════════════
-- 0109 · Un directo puede venir de un dispositivo de borde, no solo de un video
--
-- ── DE DONDE SALE ─────────────────────────────────────────────────────────────
--
-- Hasta hoy, TODO trabajo `POST /v1/perception/live` asume el mismo dueño: un worker
-- externo que abre `stream_url` con `cv2.VideoCapture`, corre el modelo el mismo, y
-- deposita los resultados. Es lo que espera `list_jobs(status='queued')` cuando un
-- worker (`inferir.py --bucle`) pregunta "¿hay algo para mí?".
--
-- La Fase 1 del ADR-015 (`edge/s21-fase1/`) rompe esa suposición: el modelo YA corrió
-- EN el dispositivo (un S21, y más adelante un Manifold 3 sobre el M4T). No hay video
-- que ningún worker tenga que leer -- el propio dispositivo es quien deposita sus
-- detecciones directamente. Medido hoy contra el proyecto de desarrollo: se creó un
-- job así, y en 8 segundos el worker real (`OLOD-MZ01QN25`) lo reclamó, no pudo abrir
-- el `stream_url` (que no es un video real, es un marcador de posición), y lo marcó
-- `failed` antes de que el dispositivo pudiera depositar una sola detección.
--
-- ── LA COLUMNA, NO UN JOB TYPE NUEVO ──────────────────────────────────────────
--
-- `origin` describe QUIÉN produce los fotogramas/detecciones, no QUÉ analiza el job
-- (eso ya es `pipeline`). Dos columnas independientes: un `edge_device` puede correr
-- cualquier pipeline igual que un `stream`, y mezclarlas en un solo campo obligaría a
-- una combinatoria (`object-detection-edge`, `ocr-edge`, ...) que no aporta nada.
--
-- `stream` por defecto: todo lo que ya existe (y todo lo que no diga lo contrario)
-- sigue siendo lo que siempre fue -- un directo que un worker tiene que ir a buscar.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE perception.inference_jobs
    ADD COLUMN IF NOT EXISTS origin varchar(20) NOT NULL DEFAULT 'stream';

ALTER TABLE perception.inference_jobs
    ADD CONSTRAINT chk_job_origin CHECK (origin IN ('stream', 'edge_device'));

COMMENT ON COLUMN perception.inference_jobs.origin IS
    'Quien produce los fotogramas/detecciones de este directo. ''stream'' (por '
    'defecto): un worker externo abre stream_url y corre el modelo el (ver '
    'inferir.py --bucle). ''edge_device'': el propio dispositivo (S21, Manifold 3) ya '
    'corrio el modelo y solo deposita resultados -- ver edge/s21-fase1/. Un job '
    '''edge_device'' NUNCA debe aparecer en el sondeo de un worker (list_jobs con '
    'status=''queued''), porque ningun worker tiene nada que abrir para el.';

--  La vista se reescribe con la columna AL FINAL, igual que el patron de 0100:
--  `CREATE OR REPLACE` exige conservar nombre, tipo y orden de lo que ya habia.
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
       j.archived_by,
       m.preview_path IS NOT NULL AS media_has_preview,
       j.origin
  FROM perception.inference_jobs j
  JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;

GRANT SELECT ON perception.v_inference_jobs TO olo_app, authenticated;

DO $$
DECLARE
    v_cols int;
    v_no_stream int;
BEGIN
    SELECT count(*) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'perception'
       AND table_name = 'v_inference_jobs'
       AND column_name = 'origin';
    IF v_cols <> 1 THEN
        RAISE EXCEPTION 'la vista no expone origin';
    END IF;

    --  Todo lo que ya existia tiene que seguir siendo 'stream' -- el default no
    --  reescribe filas viejas por si solo si alguna tuviera un valor distinto puesto
    --  a mano, y aqui eso seria un error de esta misma migracion, no un dato real.
    SELECT count(*) INTO v_no_stream
      FROM perception.inference_jobs WHERE origin <> 'stream';
    IF v_no_stream > 0 THEN
        RAISE EXCEPTION
            '% trabajo(s) existentes quedaron con origin distinto de stream', v_no_stream;
    END IF;

    RAISE NOTICE 'OK - origin creada (default stream) y expuesta en v_inference_jobs.';
END $$;
