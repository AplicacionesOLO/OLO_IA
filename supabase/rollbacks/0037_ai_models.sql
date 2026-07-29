-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0037_ai_models.sql
--
-- ⚠ Aborta si existen ai.model_versions o ai.model_classes: sus FK apuntan aquí.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_dep int;
BEGIN
    SELECT count(1) INTO v_dep
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relname IN ('model_versions', 'model_classes');
    IF v_dep > 0 THEN
        RAISE EXCEPTION
            'Hay % tablas que dependen de ai.models. Revierte 0038-0039 primero.', v_dep;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_model_validate   ON ai.models;
DROP TRIGGER IF EXISTS trg_model_updated_at ON ai.models;
DROP FUNCTION IF EXISTS ai.validate_model_against_architecture();

DROP POLICY IF EXISTS model_update        ON ai.models;
DROP POLICY IF EXISTS model_insert        ON ai.models;
DROP POLICY IF EXISTS model_read          ON ai.models;
DROP POLICY IF EXISTS model_platform_only ON ai.models;

DROP TABLE IF EXISTS ai.models;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ai' AND c.relname = 'models') THEN
        RAISE EXCEPTION 'ai.models sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'ai' AND p.proname = 'validate_model_against_architecture') THEN
        RAISE EXCEPTION 'la funcion de validacion sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0037: tabla, triggers, funcion y politicas eliminadas';
END
$$;
