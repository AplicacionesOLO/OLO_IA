-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de 0102_rls_predicate_performance_pendiente.sql
--
-- Restaura las 11 políticas a su forma anterior: `core.can_access_warehouse
-- (columna)` sin envolver. Vuelve a ser lento (~8 s por página con miles de
-- filas), pero es exactamente lo que había antes de 0102 — mismo texto que
-- capturó `pg_policies` antes de aplicar la migración.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY solo_su_almacen ON incidents.incidents;
CREATE POLICY solo_su_almacen ON incidents.incidents
    AS RESTRICTIVE FOR ALL TO public
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY solo_su_almacen ON inventory.clusters;
CREATE POLICY solo_su_almacen ON inventory.clusters
    AS RESTRICTIVE FOR ALL TO public
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY hereda_del_cluster ON inventory.cluster_members;
CREATE POLICY hereda_del_cluster ON inventory.cluster_members
    AS RESTRICTIVE FOR ALL TO public
    USING (
        EXISTS (
            SELECT 1 FROM inventory.clusters c
             WHERE c.id = cluster_members.cluster_id
               AND core.can_access_warehouse(c.warehouse_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM inventory.clusters c
             WHERE c.id = cluster_members.cluster_id
               AND core.can_access_warehouse(c.warehouse_id)
        )
    );

DROP POLICY warehouse_scope ON perception.detections;
CREATE POLICY warehouse_scope ON perception.detections
    AS PERMISSIVE FOR ALL TO public
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON perception.inference_jobs;
CREATE POLICY warehouse_scope ON perception.inference_jobs
    AS PERMISSIVE FOR ALL TO public
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY job_scope ON perception.job_events;
CREATE POLICY job_scope ON perception.job_events
    AS PERMISSIVE FOR ALL TO public
    USING (
        EXISTS (
            SELECT 1 FROM perception.inference_jobs j
             WHERE j.tenant_id = job_events.tenant_id
               AND j.id = job_events.job_id
               AND core.can_access_warehouse(j.warehouse_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM perception.inference_jobs j
             WHERE j.tenant_id = job_events.tenant_id
               AND j.id = job_events.job_id
               AND core.can_access_warehouse(j.warehouse_id)
        )
    );

DROP POLICY warehouse_scope ON perception.media;
CREATE POLICY warehouse_scope ON perception.media
    AS PERMISSIVE FOR ALL TO public
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON spatial.observation_sources;
CREATE POLICY warehouse_scope ON spatial.observation_sources
    AS PERMISSIVE FOR ALL TO public
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON spatial.rack_observations;
CREATE POLICY warehouse_scope ON spatial.rack_observations
    AS PERMISSIVE FOR ALL TO public
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON spatial.rack_placements;
CREATE POLICY warehouse_scope ON spatial.rack_placements
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

DROP POLICY warehouse_scope ON spatial.warehouse_layouts;
CREATE POLICY warehouse_scope ON spatial.warehouse_layouts
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));
