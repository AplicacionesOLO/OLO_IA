-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0027_ai_assets.sql
--
-- ⚠ No borra nada de Supabase Storage. Los objetos siguen ahí y quedarían sin
--   ficha, es decir, huérfanos. Es deliberado: destruir binarios en un rollback
--   de esquema sería una pérdida de datos irreversible provocada por una
--   operación que se presume reversible. La limpieza es una decisión aparte.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_dep int;
    v_assets int;
BEGIN
    SELECT count(1) INTO v_dep
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r' AND c.relname = 'ai_images';
    IF v_dep > 0 THEN
        RAISE EXCEPTION 'ai_images depende de ai_assets. Revierte 0028 primero.';
    END IF;

    SELECT count(1) INTO v_assets FROM platform.ai_assets;
    IF v_assets > 0 THEN
        RAISE NOTICE
            'AVISO: % objetos de Storage quedarán sin ficha (huérfanos). '
            'Este rollback NO borra binarios.', v_assets;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_asset_updated_at ON platform.ai_assets;

DROP POLICY IF EXISTS asset_update        ON platform.ai_assets;
DROP POLICY IF EXISTS asset_insert        ON platform.ai_assets;
DROP POLICY IF EXISTS asset_read          ON platform.ai_assets;
DROP POLICY IF EXISTS asset_platform_only ON platform.ai_assets;

DROP TABLE IF EXISTS platform.ai_assets;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'platform' AND c.relname = 'ai_assets') THEN
        RAISE EXCEPTION 'platform.ai_assets sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0027: tabla, trigger y políticas eliminadas';
END
$$;
