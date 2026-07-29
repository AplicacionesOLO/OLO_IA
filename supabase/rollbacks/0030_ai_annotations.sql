-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0030_ai_annotations.sql
--
-- Última tabla del Bloque 0: nada depende de ella, así que el rollback es
-- directo. Destruye anotaciones, que son trabajo humano irrecuperable; se avisa
-- del volumen para que quede constancia.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_filas int;
BEGIN
    SELECT count(1) INTO v_filas FROM platform.ai_annotations;
    IF v_filas > 0 THEN
        RAISE NOTICE
            'AVISO: se van a destruir % anotaciones. Es trabajo humano y no se '
            'puede regenerar.', v_filas;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_ann_updated_at ON platform.ai_annotations;

DROP POLICY IF EXISTS ann_update        ON platform.ai_annotations;
DROP POLICY IF EXISTS ann_insert        ON platform.ai_annotations;
DROP POLICY IF EXISTS ann_read          ON platform.ai_annotations;
DROP POLICY IF EXISTS ann_platform_only ON platform.ai_annotations;

DROP TABLE IF EXISTS platform.ai_annotations;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'platform' AND c.relname = 'ai_annotations') THEN
        RAISE EXCEPTION 'platform.ai_annotations sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0030: tabla, trigger y políticas eliminadas';
END
$$;
