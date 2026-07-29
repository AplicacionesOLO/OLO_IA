-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0035_ai_frameworks.sql
--
-- ⚠ Aborta si existe ai.architectures: su FK apunta aquí.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ai' AND c.relname = 'architectures'
    ) THEN
        RAISE EXCEPTION 'ai.architectures depende de ai.frameworks. Revierte 0036 primero.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_fw_updated_at ON ai.frameworks;

DROP POLICY IF EXISTS fw_update        ON ai.frameworks;
DROP POLICY IF EXISTS fw_insert        ON ai.frameworks;
DROP POLICY IF EXISTS fw_read          ON ai.frameworks;
DROP POLICY IF EXISTS fw_platform_only ON ai.frameworks;

DROP TABLE IF EXISTS ai.frameworks;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ai' AND c.relname = 'frameworks') THEN
        RAISE EXCEPTION 'ai.frameworks sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0035: tabla, trigger y politicas eliminadas';
END
$$;
