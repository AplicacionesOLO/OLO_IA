-- ═══════════════════════════════════════════════════════════════════════════
-- 0055_spatial_addressing_consistency_rollback.sql
-- Revierte : 0055 · el trigger de consistencia y el compositor de códigos
--
-- Reversión limpia: solo funciones y un trigger. No hay datos que perder.
--
-- ⚠ Al quitar `core.spatial_location_guard()` desaparece la garantía de que
--   `code`, `logical_*` y el árbol digan lo mismo. Las filas existentes siguen
--   siendo coherentes; las nuevas ya no lo estarán por obligación.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS spatial_location_guard ON spatial.locations;
DROP FUNCTION IF EXISTS core.spatial_location_guard();
DROP FUNCTION IF EXISTS core.build_location_code(text, integer, integer, integer);
DROP FUNCTION IF EXISTS core.build_location_code(text, smallint, smallint, smallint);

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname IN ('spatial_location_guard', 'build_location_code');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % funcion(es) de 0055', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_trigger
     WHERE tgrelid = 'spatial.locations'::regclass AND NOT tgisinternal
       AND tgname = 'spatial_location_guard';
    IF v_n <> 0 THEN RAISE EXCEPTION 'el trigger de 0055 sigue ahi'; END IF;

    RAISE NOTICE 'OK rollback 0055: guardian y compositor eliminados · '
                 'las ubicaciones existentes siguen siendo coherentes, '
                 'las nuevas ya no lo seran por obligacion';
END
$$;
