-- ═══════════════════════════════════════════════════════════════════════════
-- 0060_rls_predicate_performance_rollback.sql
-- Revierte : 0060 · devuelve las 6 políticas a `core.can_access_warehouse(columna)`
--
-- ⚠ Revertir NO abre un agujero de seguridad —el predicado viejo es igual de
--   estricto— pero **rompe el módulo espacial en la práctica**:
--   `/v1/spatial/warehouses` volverá a devolver 500 por `statement_timeout`, y
--   `count` sobre 29.312 ubicaciones volverá a tardar 59 segundos.
--
--   Se avisa con un WARNING que dice el número medido, para que quien lo ejecute
--   sepa qué acaba de hacer. El rollback existe por reversibilidad, no porque
--   volver atrás tenga sentido.
--
--   Las definiciones son copia literal de las que había, no una reconstrucción de
--   memoria.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY warehouse_scope ON core.warehouses;
CREATE POLICY warehouse_scope ON core.warehouses
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(id))
    WITH CHECK (core.can_access_warehouse(id));

DROP POLICY warehouse_scope ON spatial.locations;
CREATE POLICY warehouse_scope ON spatial.locations
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON spatial.nodes;
CREATE POLICY warehouse_scope ON spatial.nodes
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON spatial.sites;
CREATE POLICY warehouse_scope ON spatial.sites
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON spatial.import_batches;
CREATE POLICY warehouse_scope ON spatial.import_batches
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY site_scope ON spatial.reference_frames;
CREATE POLICY site_scope ON spatial.reference_frames
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        EXISTS (SELECT 1 FROM spatial.sites s
                 WHERE s.id = reference_frames.site_id
                   AND core.can_access_warehouse(s.warehouse_id))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM spatial.sites s
                 WHERE s.id = reference_frames.site_id
                   AND core.can_access_warehouse(s.warehouse_id))
    );

DROP FUNCTION IF EXISTS core.warehouse_in_scope(uuid);

DO $$
DECLARE v_n int; v_filas bigint;
BEGIN
    SELECT count(1) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'warehouse_in_scope';
    IF v_n <> 0 THEN RAISE EXCEPTION 'core.warehouse_in_scope deberia estar eliminada'; END IF;

    -- Las 6 políticas están de vuelta con el predicado viejo.
    SELECT count(1) INTO v_n FROM pg_policies
     WHERE qual LIKE '%can_access_warehouse(%';
    IF v_n <> 6 THEN
        RAISE EXCEPTION 'deberian haber vuelto 6 politicas con can_access_warehouse, hay %', v_n;
    END IF;

    -- Y FORCE RLS intacto: recrear políticas no debe haberlo tocado.
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname, c.relname) IN (
        ('core', 'warehouses'), ('spatial', 'locations'), ('spatial', 'nodes'),
        ('spatial', 'sites'), ('spatial', 'import_batches'),
        ('spatial', 'reference_frames'))
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_n <> 6 THEN RAISE EXCEPTION 'FORCE RLS falta en % de las 6 tablas', 6 - v_n; END IF;

    SELECT count(1) INTO v_filas FROM spatial.locations WHERE deleted_at IS NULL;
    RAISE WARNING
        'rollback 0060: el predicado por fila esta de vuelta. Con % ubicaciones, '
        '`count(1)` como olo_app pasa de 8,9 ms a ~59.000 ms y /v1/spatial/warehouses '
        'volvera a devolver 500 por statement_timeout (30 s). El aislamiento sigue '
        'siendo correcto; lo que se rompe es que el modulo espacial sea usable.',
        v_filas;

    RAISE NOTICE 'OK rollback 0060: 6 politicas con el predicado de antes · '
                 'warehouse_in_scope eliminada · FORCE RLS intacto';
END
$$;
