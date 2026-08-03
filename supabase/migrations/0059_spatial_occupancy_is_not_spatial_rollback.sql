-- ═══════════════════════════════════════════════════════════════════════════
-- 0059_spatial_occupancy_is_not_spatial_rollback.sql
-- Revierte : 0059 · devuelve `floor_plan` y `warehouse_summary` a la forma de 0057
--
-- ⚠ Revertir REINTRODUCE un defecto conocido: `occupied_count` vuelve a solapar
--   con `available_count` y `blocked_count`, y los tres vuelven a sumar 45.174
--   sobre 29.312 ubicaciones. El rollback existe para poder volver atrás, no
--   porque volver atrás sea buena idea. Deja un WARNING en el registro.
--
--   Las definiciones son copia literal de 0057, no una reconstrucción de memoria:
--   un rollback que «más o menos» restaura el estado anterior no restaura nada.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS spatial.floor_plan;
DROP VIEW IF EXISTS spatial.warehouse_summary;

-- ── floor_plan, tal cual la dejó 0057 ──────────────────────────────────────
CREATE VIEW spatial.floor_plan
WITH (security_invoker = true) AS
SELECT
    rack.tenant_id,
    rack.warehouse_id,
    rack.id                       AS rack_id,
    rack.node_code                AS rack_code,
    rack.external_code            AS rack_external_code,
    rack.logical_index            AS rack_index,
    rack.node_type                AS rack_node_type,
    rack.node_function,
    nf.display_name               AS function_label,
    aisle.id                      AS aisle_id,
    aisle.node_code               AS aisle_code,
    rack.site_id,
    COUNT(DISTINCT bay.id)                                          AS bay_count,
    COUNT(l.id)                                                     AS location_count,
    COUNT(l.id) FILTER (WHERE l.location_situation = 'OCUP')         AS occupied_count,
    COUNT(l.id) FILTER (WHERE l.status = 'available')                AS available_count,
    COUNT(l.id) FILTER (WHERE l.status = 'blocked')                  AS blocked_count,
    COUNT(l.id) FILTER (WHERE l.origin = 'inferred')                 AS inferred_count,
    COUNT(l.id) FILTER (WHERE l.is_bulk_area)                        AS bulk_count,
    ROUND(
        100.0 * COUNT(l.id) FILTER (WHERE l.location_situation = 'OCUP')
        / NULLIF(COUNT(l.id), 0), 1
    )                                                                AS occupancy_percentage,
    MIN(l.logical_x) AS min_logical_x, MAX(l.logical_x) AS max_logical_x,
    MIN(l.logical_y) AS min_logical_y, MAX(l.logical_y) AS max_logical_y,
    MAX(l.logical_level) AS max_level
FROM spatial.nodes rack
LEFT JOIN spatial.nodes bay
       ON bay.parent_node_id = rack.id AND bay.node_type = 'bay' AND bay.deleted_at IS NULL
LEFT JOIN spatial.locations l
       ON l.node_id = COALESCE(bay.id, rack.id) AND l.deleted_at IS NULL
LEFT JOIN spatial.nodes aisle
       ON aisle.id = rack.parent_node_id AND aisle.node_type = 'aisle'
LEFT JOIN spatial.node_functions nf ON nf.code = rack.node_function
WHERE rack.deleted_at IS NULL
  AND rack.node_type IN ('rack', 'storage_area')
GROUP BY rack.tenant_id, rack.warehouse_id, rack.id, rack.node_code,
         rack.external_code, rack.logical_index, rack.node_type, rack.node_function,
         nf.display_name, aisle.id, aisle.node_code, rack.site_id;

COMMENT ON VIEW spatial.floor_plan IS
    'Plano agregado: UNA fila por rack con sus recuentos. 347 filas en lugar de 29.310, para que el frontend dibuje la vista general sin descargar el catalogo entero.';

-- ── warehouse_summary, tal cual la dejó 0057 ───────────────────────────────
CREATE VIEW spatial.warehouse_summary
WITH (security_invoker = true) AS
SELECT
    w.tenant_id,
    w.id                 AS warehouse_id,
    w.code               AS warehouse_code,
    w.name               AS warehouse_name,
    nodos.site_count,
    nodos.aisle_count,
    nodos.rack_count,
    nodos.bay_count,
    ubic.location_count,
    ubic.occupied_count,
    ubic.available_count,
    ubic.blocked_count,
    ubic.inferred_count,
    ubic.opaque_count,
    ubic.with_world_geometry,
    lotes.last_import_at,
    lotes.total_rows_rejected
FROM core.warehouses w
CROSS JOIN LATERAL (
    SELECT
        (SELECT count(1) FROM spatial.sites s
          WHERE s.warehouse_id = w.id AND s.deleted_at IS NULL)              AS site_count,
        count(1) FILTER (WHERE n.node_type = 'aisle')                        AS aisle_count,
        count(1) FILTER (WHERE n.node_type = 'rack')                         AS rack_count,
        count(1) FILTER (WHERE n.node_type = 'bay')                          AS bay_count
      FROM spatial.nodes n
     WHERE n.warehouse_id = w.id AND n.deleted_at IS NULL
) nodos
CROSS JOIN LATERAL (
    SELECT
        count(1)                                                            AS location_count,
        count(1) FILTER (WHERE l.location_situation = 'OCUP')               AS occupied_count,
        count(1) FILTER (WHERE l.status = 'available')                      AS available_count,
        count(1) FILTER (WHERE l.status = 'blocked')                        AS blocked_count,
        count(1) FILTER (WHERE l.origin = 'inferred')                       AS inferred_count,
        count(1) FILTER (WHERE l.code_form = 'opaque')                      AS opaque_count,
        count(1) FILTER (WHERE l.world_position IS NOT NULL)                AS with_world_geometry
      FROM spatial.locations l
     WHERE l.warehouse_id = w.id AND l.deleted_at IS NULL
) ubic
CROSS JOIN LATERAL (
    SELECT max(b.finished_at)   AS last_import_at,
           sum(b.rows_rejected) AS total_rows_rejected
      FROM spatial.import_batches b
     WHERE b.warehouse_id = w.id AND b.status = 'completed'
) lotes
WHERE w.deleted_at IS NULL;

COMMENT ON VIEW spatial.warehouse_summary IS
    'KPIs de un almacen en UNA fila. `with_world_geometry` mide cuanto falta para el gemelo metrico: 0 hasta el importador CAD.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.floor_plan        FROM olo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.warehouse_summary FROM olo_app;
GRANT SELECT ON spatial.floor_plan        TO olo_app;
GRANT SELECT ON spatial.warehouse_summary TO olo_app;

DO $$
DECLARE v_n int; v_solape record;
BEGIN
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname IN ('floor_plan', 'warehouse_summary')
       AND c.reloptions @> ARRAY['security_invoker=true'];
    IF v_n <> 2 THEN RAISE EXCEPTION 'security_invoker falta en % vista(s)', 2 - v_n; END IF;

    SELECT count(1) INTO v_n FROM information_schema.views
     WHERE table_schema = 'spatial' AND table_name IN ('floor_plan', 'warehouse_summary')
       AND is_insertable_into = 'YES';
    IF v_n <> 0 THEN RAISE EXCEPTION '% vista(s) son insertables', v_n; END IF;

    -- El contrato de 0057 está de vuelta: `occupied_count` existe otra vez.
    SELECT count(1) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'warehouse_summary'
       AND column_name = 'occupied_count';
    IF v_n <> 1 THEN RAISE EXCEPTION 'occupied_count deberia haber vuelto'; END IF;

    -- Y con él, el defecto. Se mide y se avisa en lugar de restaurarlo callando.
    SELECT location_count, available_count, blocked_count, occupied_count
      INTO v_solape FROM spatial.warehouse_summary
     WHERE location_count > 0 ORDER BY location_count DESC LIMIT 1;

    IF v_solape.location_count IS NOT NULL
       AND v_solape.available_count + v_solape.blocked_count + v_solape.occupied_count
           <> v_solape.location_count THEN
        RAISE WARNING
            'rollback 0059: se ha reintroducido el defecto de 0057 · disponibles (%) + '
            'bloqueadas (%) + «ocupadas» (%) = % sobre % ubicaciones. `occupied_count` '
            'sale de location_situation y solapa con las otras dos. NO lo apile en un '
            'grafico.',
            v_solape.available_count, v_solape.blocked_count, v_solape.occupied_count,
            v_solape.available_count + v_solape.blocked_count + v_solape.occupied_count,
            v_solape.location_count;
    END IF;

    RAISE NOTICE 'OK rollback 0059: floor_plan y warehouse_summary con el contrato de '
                 '0057 · security_invoker=true · ninguna insertable';
END
$$;
