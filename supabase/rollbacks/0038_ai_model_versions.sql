-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0038_ai_model_versions.sql
--
-- Devuelve `ai.validate_model_against_architecture()` a la versión de 0037: sin
-- la comprobación de inmutabilidad, que consulta una tabla que va a desaparecer.
-- Si no se restaurara, el trigger fallaría en la siguiente edición de un modelo.
--
-- ⚠ Aborta si existe ai.model_classes: su trigger consulta model_versions.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ai' AND c.relname = 'model_classes'
    ) THEN
        RAISE EXCEPTION
            'ai.model_classes tiene un trigger que consulta model_versions. Revierte 0039 primero.';
    END IF;
END
$$;

-- Restaurar el validador de 0037, sin la parte que necesita model_versions.
CREATE OR REPLACE FUNCTION ai.validate_model_against_architecture()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    a RECORD;
BEGIN
    SELECT framework_code, supported_tasks, supported_input_types,
           requires_training, is_active
      INTO a
      FROM ai.architectures
     WHERE code = NEW.architecture_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'la arquitectura % no existe en el catalogo', NEW.architecture_code
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT a.is_active AND (TG_OP = 'INSERT'
                            OR NEW.architecture_code IS DISTINCT FROM OLD.architecture_code) THEN
        RAISE EXCEPTION 'la arquitectura % esta desactivada', NEW.architecture_code
            USING ERRCODE = 'raise_exception';
    END IF;

    IF NEW.framework_code IS DISTINCT FROM a.framework_code THEN
        RAISE EXCEPTION
            'framework incoherente: % declara %, la arquitectura % pertenece a %',
            NEW.name, NEW.framework_code, NEW.architecture_code, a.framework_code
            USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT (NEW.task = ANY (a.supported_tasks)) THEN
        RAISE EXCEPTION
            'la arquitectura % no soporta la tarea "%". Soporta: %',
            NEW.architecture_code, NEW.task, array_to_string(a.supported_tasks, ', ')
            USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT (NEW.input_type = ANY (a.supported_input_types)) THEN
        RAISE EXCEPTION
            'la arquitectura % no soporta la entrada "%". Soporta: %',
            NEW.architecture_code, NEW.input_type,
            array_to_string(a.supported_input_types, ', ')
            USING ERRCODE = 'raise_exception';
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.requires_training := a.requires_training;
    ELSE
        IF NEW.requires_training IS DISTINCT FROM OLD.requires_training THEN
            RAISE EXCEPTION
                'requires_training se deriva de la arquitectura y no se edita'
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    RETURN NEW;
END
$$;

ALTER TABLE ai.models DROP CONSTRAINT IF EXISTS fk_model_current_version;

DROP TRIGGER IF EXISTS trg_mv_updated_at ON ai.model_versions;

DROP POLICY IF EXISTS mv_update        ON ai.model_versions;
DROP POLICY IF EXISTS mv_insert        ON ai.model_versions;
DROP POLICY IF EXISTS mv_read          ON ai.model_versions;
DROP POLICY IF EXISTS mv_platform_only ON ai.model_versions;

DROP TABLE IF EXISTS ai.model_versions;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ai' AND c.relname = 'model_versions') THEN
        RAISE EXCEPTION 'ai.model_versions sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_model_current_version') THEN
        RAISE EXCEPTION 'la FK de current_version_id sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0038: tabla, FK y politicas eliminadas; validador restaurado a 0037';
END
$$;
