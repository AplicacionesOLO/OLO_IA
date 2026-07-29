-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0028_ai_images.sql
--
-- ⚠ Aborta si existen ai_dataset_items o ai_annotations: ambas tienen FK
--   compuesta hacia esta tabla.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_dep int;
BEGIN
    SELECT count(1) INTO v_dep
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r'
       AND c.relname IN ('ai_dataset_items', 'ai_annotations');
    IF v_dep > 0 THEN
        RAISE EXCEPTION
            'Hay % tablas que dependen de ai_images. Revierte 0029-0030 primero.', v_dep;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_img_updated_at ON platform.ai_images;

DROP POLICY IF EXISTS img_update        ON platform.ai_images;
DROP POLICY IF EXISTS img_insert        ON platform.ai_images;
DROP POLICY IF EXISTS img_read          ON platform.ai_images;
DROP POLICY IF EXISTS img_platform_only ON platform.ai_images;

DROP TABLE IF EXISTS platform.ai_images;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'platform' AND c.relname = 'ai_images') THEN
        RAISE EXCEPTION 'platform.ai_images sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0028: tabla, trigger y políticas eliminadas';
END
$$;
