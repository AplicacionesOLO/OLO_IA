-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0026_ai_classes.sql
--
-- ⚠ Aborta si existen ai_annotations o ai_dataset_versions: las anotaciones
--   tienen FK compuesta a esta tabla, y las versiones de dataset congelaron su
--   lista de clases.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_dep int;
BEGIN
    SELECT count(1) INTO v_dep
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r'
       AND c.relname IN ('ai_annotations', 'ai_dataset_versions');
    IF v_dep > 0 THEN
        RAISE EXCEPTION
            'Hay % tablas que dependen de ai_classes. Revierte 0029-0030 primero.', v_dep;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_class_index_inmutable ON platform.ai_classes;
DROP TRIGGER IF EXISTS trg_class_updated_at      ON platform.ai_classes;
DROP FUNCTION IF EXISTS platform.prevent_class_index_change();

DROP POLICY IF EXISTS class_update        ON platform.ai_classes;
DROP POLICY IF EXISTS class_insert        ON platform.ai_classes;
DROP POLICY IF EXISTS class_read          ON platform.ai_classes;
DROP POLICY IF EXISTS class_platform_only ON platform.ai_classes;

DROP TABLE IF EXISTS platform.ai_classes;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'platform' AND c.relname = 'ai_classes') THEN
        RAISE EXCEPTION 'platform.ai_classes sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'platform' AND p.proname = 'prevent_class_index_change') THEN
        RAISE EXCEPTION 'la función de inmutabilidad sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0026: tabla, triggers, función y políticas eliminadas';
END
$$;
