-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0103
--
-- Quita el CHECK y la columna `progress`. Se pierde cualquier vistazo de avance que se
-- hubiera guardado; nada mas depende de esta columna.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE ai.training_runs DROP CONSTRAINT IF EXISTS chk_run_progress_objeto;
ALTER TABLE ai.training_runs DROP COLUMN IF EXISTS progress;

DO $$
BEGIN
    RAISE NOTICE 'OK - 0103 deshecha. ai.training_runs ya no tiene columna progress.';
END $$;
