-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0036_ai_architectures.sql
--
-- ⚠ Aborta si existe ai.models: su FK apunta aquí.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ai' AND c.relname = 'models'
    ) THEN
        RAISE EXCEPTION 'ai.models depende de ai.architectures. Revierte 0037 primero.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_arch_updated_at ON ai.architectures;

DROP POLICY IF EXISTS arch_update        ON ai.architectures;
DROP POLICY IF EXISTS arch_insert        ON ai.architectures;
DROP POLICY IF EXISTS arch_read          ON ai.architectures;
DROP POLICY IF EXISTS arch_platform_only ON ai.architectures;

DROP TABLE IF EXISTS ai.architectures;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ai' AND c.relname = 'architectures') THEN
        RAISE EXCEPTION 'ai.architectures sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0036: tabla, trigger y politicas eliminadas';
END
$$;
