-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0039_ai_model_classes.sql
--
-- Última tabla del bloque de modelo lógico: nada depende de ella.
-- `DROP TABLE` no dispara triggers de DELETE, así que la guarda de inmutabilidad
-- no bloquea este rollback y no hace falta desactivarla.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_mc_inmutable ON ai.model_classes;
DROP FUNCTION IF EXISTS ai.prevent_training_index_change();

DROP POLICY IF EXISTS mc_delete        ON ai.model_classes;
DROP POLICY IF EXISTS mc_update        ON ai.model_classes;
DROP POLICY IF EXISTS mc_insert        ON ai.model_classes;
DROP POLICY IF EXISTS mc_read          ON ai.model_classes;
DROP POLICY IF EXISTS mc_platform_only ON ai.model_classes;

DROP TABLE IF EXISTS ai.model_classes;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ai' AND c.relname = 'model_classes') THEN
        RAISE EXCEPTION 'ai.model_classes sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'ai' AND p.proname = 'prevent_training_index_change') THEN
        RAISE EXCEPTION 'la funcion de inmutabilidad sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0039: tabla, trigger, funcion y 5 politicas eliminadas';
END
$$;
