-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0029_ai_dataset_versions.sql
--
-- Nota: `DROP TABLE` no dispara los triggers de DELETE, así que la guarda de
-- inmutabilidad no bloquea este rollback. No hace falta desactivarla — a
-- diferencia del rollback de 0021, donde sí se borran filas una a una.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_dsi_inmutable ON platform.ai_dataset_items;
DROP TRIGGER IF EXISTS trg_dsv_inmutable ON platform.ai_dataset_versions;

DROP POLICY IF EXISTS dsi_insert        ON platform.ai_dataset_items;
DROP POLICY IF EXISTS dsi_read          ON platform.ai_dataset_items;
DROP POLICY IF EXISTS dsi_platform_only ON platform.ai_dataset_items;
DROP POLICY IF EXISTS dsv_insert        ON platform.ai_dataset_versions;
DROP POLICY IF EXISTS dsv_read          ON platform.ai_dataset_versions;
DROP POLICY IF EXISTS dsv_platform_only ON platform.ai_dataset_versions;

-- Hija primero: ai_dataset_items referencia a ai_dataset_versions.
DROP TABLE IF EXISTS platform.ai_dataset_items;
DROP TABLE IF EXISTS platform.ai_dataset_versions;

DROP FUNCTION IF EXISTS platform.reject_frozen_dataset_change();

DO $$
DECLARE
    v_quedan int;
BEGIN
    SELECT count(1) INTO v_quedan
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform'
       AND c.relname IN ('ai_dataset_versions', 'ai_dataset_items');
    IF v_quedan > 0 THEN
        RAISE EXCEPTION 'quedan % tablas de dataset', v_quedan;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'platform' AND p.proname = 'reject_frozen_dataset_change') THEN
        RAISE EXCEPTION 'la función de inmutabilidad sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0029: 2 tablas, 2 triggers, función y 6 políticas eliminadas';
END
$$;
