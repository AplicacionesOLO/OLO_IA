-- ═══════════════════════════════════════════════════════════════════════════
-- 0120_ocupacion_rapida.sql (ROLLBACK)
-- Vuelve a la definicion de 0068 (mismo resultado, mas lenta).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW inventory.v_location_occupancy AS
SELECT l.tenant_id,
       l.warehouse_id,
       l.id                       AS location_id,
       l.code                     AS location_code,
       l.node_id                  AS bay_id,
       l.logical_level            AS level,
       l.status                   AS spatial_status,
       l.location_situation       AS wms_situation,
       cs.snapshot_id,
       cs.taken_at,
       -- Ocupado = el snapshot vigente tiene alguna línea aquí. `count` y no un
       -- `EXISTS` porque el número de líneas es dato: un hueco con 14 líneas
       -- distintas es un hueco compartido por 14 SKU, y eso se quiere ver.
       count(st.id)               AS lines,
       (count(st.id) > 0)         AS occupied,
       count(DISTINCT st.pallet_code) AS pallets,
       count(DISTINCT st.sku)     AS skus,
       count(DISTINCT st.client_id) AS clients,
       sum(st.qty)                AS units,
       min(st.expires_at)         AS first_expiry
  FROM spatial.locations l
  LEFT JOIN inventory.v_current_snapshot cs
       ON cs.tenant_id = l.tenant_id AND cs.warehouse_id = l.warehouse_id
  LEFT JOIN inventory.wms_stock st
       ON st.snapshot_id = cs.snapshot_id AND st.location_id = l.id
 WHERE l.deleted_at IS NULL
 GROUP BY l.tenant_id, l.warehouse_id, l.id, l.code, l.node_id, l.logical_level,
          l.status, l.location_situation, cs.snapshot_id, cs.taken_at;

ALTER VIEW inventory.v_location_occupancy SET (security_invoker = true);
