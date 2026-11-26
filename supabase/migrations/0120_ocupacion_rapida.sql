-- ═══════════════════════════════════════════════════════════════════════════
-- 0120_ocupacion_rapida.sql
-- Altera    : inventory.v_location_occupancy (mismas columnas, mismo resultado)
-- Depende de: 0068 (la vista original), 0064 (idx_stock_snapshot)
-- Riesgo    : bajo -- CREATE OR REPLACE con columnas identicas; verificado que los
--             347 racks de v_rack_occupancy dan EXACTAMENTE lo mismo.
--
-- La ocupacion (colores del mapa, «Levantar plano» y 3D+) tardaba 7,4 s en Render.
-- EXPLAIN ANALYZE (26/11): la vista unia el catalogo con TODO `wms_stock` —151.846
-- lineas de todas las fotos, las xlsx viejas y la del WMS en vivo— por Seq Scan, y
-- solo al final se quedaba con la foto vigente: 1,4 s de 1,9 s en leer lineas que se
-- tiraban. Ahora se agrupa PRIMERO el stock de la foto vigente (por indice, ~42.000
-- lineas) y despues se une al catalogo: 1,9 s -> 0,77 s en la misma prueba.
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
       coalesce(a.lines, 0)       AS lines,
       (coalesce(a.lines, 0) > 0) AS occupied,
       coalesce(a.pallets, 0)     AS pallets,
       coalesce(a.skus, 0)        AS skus,
       coalesce(a.clients, 0)     AS clients,
       a.units,
       a.first_expiry
  FROM spatial.locations l
  LEFT JOIN inventory.v_current_snapshot cs
       ON cs.tenant_id = l.tenant_id AND cs.warehouse_id = l.warehouse_id
  -- El stock de la foto VIGENTE, agrupado por hueco antes de unir: asi se lee por
  -- `idx_stock_snapshot` solo esa foto y no todas las que se hayan importado.
  LEFT JOIN (
       SELECT st.snapshot_id,
              st.location_id,
              count(st.id)                  AS lines,
              count(DISTINCT st.pallet_code) AS pallets,
              count(DISTINCT st.sku)        AS skus,
              count(DISTINCT st.client_id)  AS clients,
              sum(st.qty)                   AS units,
              min(st.expires_at)            AS first_expiry
         FROM inventory.v_current_snapshot c2
         JOIN inventory.wms_stock st ON st.snapshot_id = c2.snapshot_id
        GROUP BY st.snapshot_id, st.location_id
       ) a
       ON a.snapshot_id = cs.snapshot_id AND a.location_id = l.id
 WHERE l.deleted_at IS NULL;

ALTER VIEW inventory.v_location_occupancy SET (security_invoker = true);
