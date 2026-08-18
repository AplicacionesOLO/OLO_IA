-- ═══════════════════════════════════════════════════════════════════════════════
-- 0100 · Una copia ligera del video, solo para poder verlo
--
-- ── DE DONDE SALE ─────────────────────────────────────────────────────────────
--
-- Los drones graban en H.265, y Chrome no lo reproduce salvo que el sistema le ofrezca
-- decodificacion por hardware. Medido sobre `DJI_20260308105811_0008_D`: el navegador
-- devuelve `MEDIA_ERR_SRC_NOT_SUPPORTED` sobre el archivo entero, mientras el worker leia
-- sus 634 fotogramas sin problema con ffmpeg y encontraba 545 detecciones.
--
-- O sea que el analisis estaba bien y no habia forma de MIRARLO. La pantalla del trabajo
-- dibuja las cajas encima de un elemento de video, y ese elemento no pintaba nada.
--
-- ── POR QUE UNA COPIA Y NO OTRA COSA ──────────────────────────────────────────
--
-- Porque no se puede arreglar en el navegador: si el sistema no tiene el decodificador,
-- no lo tiene. Y porque el original NO se toca — es lo que analiza el worker, y
-- recomprimirlo perderia justo los pixeles de los que depende leer un codigo—.
--
-- La copia es 720p H.264 sin audio. Medido sobre esos 21 s de 4K: 28 segundos de CPU y
-- 2,1 MB, un 0,9 % de los 252 MB del original. Es barata en las dos cosas que importan.
--
-- ── LO QUE ESTA COLUMNA NO ES ─────────────────────────────────────────────────
--
-- No es una variante de calidad ni el principio de un sistema de perfiles. Es una copia
-- para VER, y por eso es una sola columna con una ruta y no una tabla de derivados: el
-- dia que haga falta una segunda, esto se convertira en una tabla y no en una columna
-- mas — pero no hay que construir esa tabla hoy para un caso que no existe—.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE perception.media
    ADD COLUMN IF NOT EXISTS preview_path text;

COMMENT ON COLUMN perception.media.preview_path IS
    'Ruta en el mismo bucket de una copia 720p H.264 para poder ver el video en el '
    'navegador. NULL si no se ha generado: no todos los workers tienen ffmpeg, y el '
    'analisis no depende de esto. El original nunca se toca.';

--  La vista se reescribe con la columna AL FINAL. `CREATE OR REPLACE` exige conservar
--  nombre, tipo y orden de lo que ya habia, asi que los campos se copian tal cual y el
--  nuevo se anade detras.
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
       --  Un booleano y no la ruta: quien pinta la pantalla necesita saber SI hay copia,
       --  y la ruta sin firmar no sirve para nada. Exponerla solo daria a cualquiera con
       --  acceso a la vista la estructura interna del bucket.
       m.preview_path IS NOT NULL AS media_has_preview
  FROM perception.inference_jobs j
  JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;

GRANT SELECT ON perception.v_inference_jobs TO olo_app, authenticated;

DO $$
DECLARE
    v_cols int;
    v_falsos int;
BEGIN
    --  Que la columna llego y que la vista la expone.
    SELECT count(*) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'perception'
       AND table_name = 'v_inference_jobs'
       AND column_name = 'media_has_preview';
    IF v_cols <> 1 THEN
        RAISE EXCEPTION 'la vista no expone media_has_preview';
    END IF;

    --  Y que ningun trabajo dice tener copia todavia: la columna nace vacia, asi que un
    --  verdadero aqui significaria que la condicion esta escrita al reves, y la pantalla
    --  pediria una URL que no existe para TODOS los videos.
    SELECT count(*) INTO v_falsos FROM perception.v_inference_jobs WHERE media_has_preview;
    IF v_falsos > 0 THEN
        RAISE EXCEPTION
            'hay % trabajo(s) que dicen tener copia sin que se haya generado ninguna',
            v_falsos;
    END IF;

    RAISE NOTICE 'OK - preview_path creada y expuesta como media_has_preview. '
                 'Ninguna copia generada todavia, que es lo esperado.';
END $$;
