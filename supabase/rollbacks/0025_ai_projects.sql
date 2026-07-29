-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0025_ai_projects.sql
--
-- ⚠ Aborta si existen tablas hijas (0026-0030): sus FK apuntan aquí y el DROP
--   fallaría con un error del motor menos claro que este mensaje.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_hijas int;
BEGIN
    SELECT count(1) INTO v_hijas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r'
       AND c.relname IN ('ai_classes','ai_assets','ai_images',
                         'ai_dataset_versions','ai_dataset_items','ai_annotations');
    IF v_hijas > 0 THEN
        RAISE EXCEPTION
            'Hay % tablas hijas de ai_projects. Revierte 0026-0030 primero.', v_hijas;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_proj_updated_at ON platform.ai_projects;

DROP POLICY IF EXISTS proj_update        ON platform.ai_projects;
DROP POLICY IF EXISTS proj_insert        ON platform.ai_projects;
DROP POLICY IF EXISTS proj_read          ON platform.ai_projects;
DROP POLICY IF EXISTS proj_platform_only ON platform.ai_projects;

DROP TABLE IF EXISTS platform.ai_projects;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'platform' AND c.relname = 'ai_projects') THEN
        RAISE EXCEPTION 'platform.ai_projects sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0025: tabla, trigger y políticas eliminadas';
END
$$;
