-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0042_model_contract_immutability.sql
--
-- ⚠ REABRE CUATRO AGUJEROS MEDIDOS. Solo tiene sentido para deshacer una
--   aplicación fallida, nunca como estado deseado: deja `input_type` mutable con
--   versiones y permite que editar el catálogo invalide modelos existentes.
--
-- Restaura la función a la forma de 0038, con su texto original —sin DETAIL—
-- porque el mapeo de errores de la API no existe en ese punto de la historia.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ai' AND c.relname = 'models_resolved'
    ) THEN
        RAISE EXCEPTION
            'La migracion 0042 no esta aplicada (no existe ai.models_resolved). '
            'No hay nada que revertir.';
    END IF;
    RAISE NOTICE
        'AVISO: este rollback reabre los agujeros A, D, E y F. Solo para deshacer '
        'una aplicacion fallida.';
END
$$;

DROP TRIGGER IF EXISTS trg_arch_protect_contract ON ai.architectures;
DROP FUNCTION IF EXISTS ai.protect_architecture_contract();

DROP VIEW IF EXISTS ai.models_resolved;

-- Restaurar la columna. NOT NULL solo si no hay filas: con datos no habría valor
-- honesto que inventar, y fallar es correcto.
ALTER TABLE ai.models ADD COLUMN framework_code varchar(30);

UPDATE ai.models m
   SET framework_code = a.framework_code
  FROM ai.architectures a
 WHERE a.code = m.architecture_code;

DO $$
DECLARE
    v_nulos int;
BEGIN
    SELECT count(1) INTO v_nulos FROM ai.models WHERE framework_code IS NULL;
    IF v_nulos = 0 THEN
        ALTER TABLE ai.models ALTER COLUMN framework_code SET NOT NULL;
        ALTER TABLE ai.models
            ADD CONSTRAINT models_framework_code_fkey
            FOREIGN KEY (framework_code) REFERENCES ai.frameworks(code) ON DELETE RESTRICT;
    ELSE
        RAISE NOTICE 'AVISO: % modelos sin framework resoluble, la columna queda NULLABLE', v_nulos;
    END IF;
END
$$;

-- Validador de 0038: sin input_type en la guarda, con la comprobación de
-- coherencia de framework_code que la columna vuelve a necesitar.
CREATE OR REPLACE FUNCTION ai.validate_model_against_architecture()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    a RECORD;
    v_versiones int;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.requires_training IS DISTINCT FROM OLD.requires_training THEN
            RAISE EXCEPTION
                'requires_training se deriva de la arquitectura y no se edita'
                USING ERRCODE = 'raise_exception';
        END IF;

        IF NEW.architecture_code IS DISTINCT FROM OLD.architecture_code
           OR NEW.task IS DISTINCT FROM OLD.task THEN
            SELECT count(1) INTO v_versiones
              FROM ai.model_versions
             WHERE model_id = OLD.id AND deleted_at IS NULL;

            IF v_versiones > 0 THEN
                RAISE EXCEPTION
                    'el modelo % ya tiene % version(es) entrenadas o registradas: '
                    'arquitectura y tarea son inmutables. Los pesos existentes '
                    'dejarian de poder interpretarse. Crea un modelo nuevo.',
                    OLD.name, v_versiones
                    USING ERRCODE = 'raise_exception';
            END IF;
        END IF;
    END IF;

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
    END IF;

    RETURN NEW;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'models'
           AND column_name = 'framework_code'
    ) THEN
        RAISE EXCEPTION 'framework_code no se restauro';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'ai' AND p.proname = 'protect_architecture_contract'
    ) THEN
        RAISE EXCEPTION 'el trigger de la arquitectura sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0042: framework_code restaurado, vista y proteccion eliminadas';
END
$$;
