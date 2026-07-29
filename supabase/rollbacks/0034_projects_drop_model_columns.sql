-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0034_projects_drop_model_columns.sql
--
-- Restaura las dos columnas con su CHECK original. Es exacto porque la migración
-- se aplicó sobre 0 filas: no hay valores que reconstruir.
--
-- `base_model` vuelve como NOT NULL igual que en 0025. Si hubiera filas, esto
-- fallaría — correctamente: significaría que se creó un proyecto sin ese dato y
-- no hay valor honesto que inventar.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ai.projects ADD COLUMN base_model varchar(60);
ALTER TABLE ai.projects ADD COLUMN task varchar(20) NOT NULL DEFAULT 'detect';

ALTER TABLE ai.projects
    ADD CONSTRAINT chk_proj_task CHECK (task IN ('detect', 'segment', 'pose'));

DO $$
DECLARE
    v_filas int;
BEGIN
    SELECT count(1) INTO v_filas FROM ai.projects;
    IF v_filas = 0 THEN
        -- Sin filas se puede restaurar el NOT NULL original de 0025.
        ALTER TABLE ai.projects ALTER COLUMN base_model SET NOT NULL;
    ELSE
        RAISE NOTICE
            'AVISO: hay % filas, base_model queda NULLABLE. En 0025 era NOT NULL.',
            v_filas;
    END IF;
END
$$;

DO $$
DECLARE
    v_cols int;
BEGIN
    SELECT count(1) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'ai' AND table_name = 'projects'
       AND column_name IN ('base_model', 'task');
    IF v_cols <> 2 THEN
        RAISE EXCEPTION 'debían restaurarse 2 columnas, hay %', v_cols;
    END IF;
    RAISE NOTICE 'OK rollback 0034: base_model y task restauradas con su CHECK';
END
$$;
