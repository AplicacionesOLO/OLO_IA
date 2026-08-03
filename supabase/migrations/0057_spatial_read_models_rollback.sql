-- ═══════════════════════════════════════════════════════════════════════════
-- 0057_spatial_read_models_rollback.sql
-- Revierte : 0057 · elimina las 4 vistas de lectura del explorador espacial
--
-- Reversión limpia: una vista no guarda datos, así que eliminarla no pierde
-- nada. Lo único que se rompe es quien la consulte, y eso es visible al
-- instante.
--
-- Se usa `RESTRICT` (el modo por omisión) a propósito, NO `CASCADE`: si algún
-- día una vista futura se apoyara en `locations_resolved`, `CASCADE` la
-- eliminaría en silencio y el rollback de 0057 se llevaría por delante trabajo
-- de otra migración. Con `RESTRICT` falla y dice de qué depende.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS spatial.warehouse_summary;
DROP VIEW IF EXISTS spatial.rack_front_view;
DROP VIEW IF EXISTS spatial.floor_plan;
DROP VIEW IF EXISTS spatial.locations_resolved;

DO $$
DECLARE v_n int; v_priv int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relkind IN ('v', 'm')
       AND c.relname IN ('locations_resolved', 'floor_plan', 'rack_front_view',
                         'warehouse_summary');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % vista(s) de 0057', v_n; END IF;

    -- Los GRANT se van con el objeto; se comprueba que no quede un privilegio
    -- apuntando a un nombre inexistente en el catálogo.
    SELECT count(1) INTO v_priv FROM information_schema.role_table_grants
     WHERE table_schema = 'spatial'
       AND table_name IN ('locations_resolved', 'floor_plan', 'rack_front_view',
                          'warehouse_summary');
    IF v_priv <> 0 THEN RAISE EXCEPTION 'quedan % privilegio(s) huerfano(s)', v_priv; END IF;

    -- Las tablas base siguen intactas: una vista eliminada no toca sus datos.
    SELECT count(1) INTO v_n FROM spatial.locations WHERE deleted_at IS NULL;
    RAISE NOTICE 'OK rollback 0057: 4 vistas eliminadas con RESTRICT · '
                 'sin privilegios huerfanos · % ubicacion(es) intacta(s)', v_n;
END
$$;
