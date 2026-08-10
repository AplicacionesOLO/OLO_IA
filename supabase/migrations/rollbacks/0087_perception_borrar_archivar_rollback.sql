-- Rollback de 0087 · borrar y archivar inspecciones.
--
-- Lo que se pierde al revertir:
--
--   · la capacidad de quitar inspecciones de en medio. Vuelven a acumularse ocupando
--     Storage sin forma de liberarlo desde la aplicación, que es el problema que 0087
--     resolvió.
--   · la marca de las que estén ARCHIVADAS: volverán a aparecer en la lista. No se
--     borra ninguna, pero se olvida cuáles se habían apartado y por qué.
--
-- Lo que NO se toca: ni una inspección, ni una detección, ni un byte de Storage. Esta
-- migración solo añadió un permiso, dos columnas, un índice y una función de consulta.

DO $$
DECLARE
    v_archivadas int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'perception' AND table_name = 'inference_jobs'
           AND column_name = 'archived_at'
    ) THEN
        RAISE NOTICE '0087 ya estaba revertida.';
        RETURN;
    END IF;
    SELECT count(*) INTO v_archivadas
      FROM perception.inference_jobs WHERE archived_at IS NOT NULL;
    IF v_archivadas > 0 THEN
        RAISE NOTICE 'Aviso: % inspeccion(es) archivadas volveran a la lista. Ninguna '
                     'se borra.', v_archivadas;
    END IF;
END $$;

-- La vista, de vuelta a la de antes: sin `archived_at` ni `archived_by`.
--
-- Se recrea entera con DROP y CREATE, no con CREATE OR REPLACE: reemplazar no permite
-- QUITAR columnas. Y el DROP va sin CASCADE a propósito — si algo dependiera de esta
-- vista, se quiere que el rollback falle en vez de llevárselo por delante.
DROP VIEW IF EXISTS perception.v_inference_jobs;
CREATE VIEW perception.v_inference_jobs AS
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
    ( SELECT count(*) AS count
           FROM perception.job_events e
          WHERE e.tenant_id = j.tenant_id AND e.job_id = j.id) AS event_count
   FROM perception.inference_jobs j
     JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;

-- Los permisos de la vista se recrean con ella: `DROP VIEW` se los lleva.
GRANT SELECT ON perception.v_inference_jobs TO olo_app;

DROP FUNCTION IF EXISTS perception.enlaces_de_trabajo(uuid);
DROP INDEX IF EXISTS perception.ix_jobs_activas;

ALTER TABLE perception.inference_jobs
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS archived_by;

DELETE FROM core.role_permissions WHERE permission_code = 'perception:delete';
DELETE FROM core.permissions      WHERE code            = 'perception:delete';

DO $$
DECLARE
    v_n int;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'perception' AND table_name = 'inference_jobs'
           AND column_name = 'archived_at'
    ) THEN
        RAISE EXCEPTION 'archived_at sigue ahi';
    END IF;
    IF to_regprocedure('perception.enlaces_de_trabajo(uuid)') IS NOT NULL THEN
        RAISE EXCEPTION 'enlaces_de_trabajo sigue ahi';
    END IF;

    -- Y la vista tiene que seguir SIRVIENDO: un rollback que la deje rota dejaría el
    -- modulo de Vision sin lista de inspecciones, que es peor que el problema revertido.
    SELECT count(*) INTO v_n FROM perception.v_inference_jobs;
    RAISE NOTICE 'OK · 0087 revertida · la vista responde con % inspecciones · ninguna '
                 'borrada', v_n;
END $$;
