-- ═══════════════════════════════════════════════════════════════════════════
-- 0034_projects_drop_model_columns.sql
-- Altera   : ai.projects — elimina `base_model` y `task`
-- Depende de: 0033
-- Riesgo   : bajo (0 filas)
--
-- Su sitio es `ai.models`: un proyecto con cinco modelos —un detector YOLO, un
-- segmentador SAM, un OCR, un detector de daños y un clasificador— no tiene UNA
-- arquitectura ni UNA tarea. Dejarlas sería mantener dos fuentes de verdad sobre
-- lo mismo, que es peor que eliminarlas.
--
-- SE QUEDAN los tres campos de extracción de frames
-- (`frame_interval_seconds`, `max_frames_per_video`, `max_video_duration_secs`):
-- la extracción alimenta el pool de imágenes, que es del proyecto y compartido
-- entre todos sus modelos.
-- ═══════════════════════════════════════════════════════════════════════════

-- Comprobación previa: si hubiera filas, eliminar columnas sería pérdida de datos
-- y hay que enterarse ANTES, no después.
DO $$
DECLARE
    v_filas int;
BEGIN
    SELECT count(1) INTO v_filas FROM ai.projects;
    IF v_filas > 0 THEN
        RAISE EXCEPTION
            'ai.projects tiene % filas. Eliminar base_model y task perdería datos: '
            'migra esos valores a ai.models antes de aplicar esta migración.', v_filas;
    END IF;
END
$$;

ALTER TABLE ai.projects DROP CONSTRAINT chk_proj_task;
ALTER TABLE ai.projects DROP COLUMN task;
ALTER TABLE ai.projects DROP COLUMN base_model;

COMMENT ON TABLE ai.projects IS
    'Proyecto de IA: agrupa un pool de imagenes, un vocabulario de clases y VARIOS modelos. La arquitectura y la tarea son de ai.models, no de aqui.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_cols int;
BEGIN
    SELECT count(1) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'ai' AND table_name = 'projects'
       AND column_name IN ('base_model', 'task');
    IF v_cols <> 0 THEN
        RAISE EXCEPTION 'quedan % de las columnas eliminadas', v_cols;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_proj_task'
    ) THEN
        RAISE EXCEPTION 'chk_proj_task sigue existiendo';
    END IF;

    -- Los tres de frames DEBEN seguir: son del proyecto, no del modelo.
    SELECT count(1) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'ai' AND table_name = 'projects'
       AND column_name IN ('frame_interval_seconds', 'max_frames_per_video',
                           'max_video_duration_secs');
    IF v_cols <> 3 THEN
        RAISE EXCEPTION
            'los 3 campos de extraccion de frames deben quedarse, hay %', v_cols;
    END IF;

    RAISE NOTICE 'OK 0034: base_model y task eliminadas, los 3 campos de frames intactos';
END
$$;
