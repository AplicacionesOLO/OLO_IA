-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0095 · La parada vuelve a apuntar al cuerpo
--
-- Deshacer esto REINTRODUCE EL FALLO a propósito: `v_trip_stops` vuelve a exponer
-- `l.node_id AS rack_node_id`, y como en este catálogo cada cuerpo es su propio nodo, la
-- simulación deja de encontrar la colocación de la parada y un recorrido de diez paradas
-- mide cero metros — sin fallar ruidosamente, solo dando un total corto—.
--
-- Se escribe igualmente porque un rollback que no restaura el estado anterior no es un
-- rollback. Pero se avisa por pantalla: si alguien lo ejecuta sin querer, que lo lea.
--
-- Es la vista de 0094 tal cual, con `l.node_id` en lugar de la regla del padre.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW spatial.v_trip_stops
WITH (security_invoker = true) AS
SELECT s.id,
       s.trip_id,
       s.seq,
       s.operation,
       s.dwell_s,
       s.notes,
       s.location_id,
       l.code AS location_code,
       l.node_id AS rack_node_id,
       l.logical_column   AS bay_index,
       l.logical_level    AS level,
       l.logical_position AS position,
       s.created_at,
       s.updated_at,
       s.version
  FROM spatial.trip_stops s
  JOIN spatial.locations l ON l.id = s.location_id
  LEFT JOIN spatial.nodes n ON n.id = l.node_id
 WHERE s.deleted_at IS NULL AND l.deleted_at IS NULL;

GRANT SELECT ON spatial.v_trip_stops TO olo_app, authenticated;

DO $$
BEGIN
    RAISE WARNING '0095 deshecha: la parada vuelve a apuntar al CUERPO, no al rack. Los '
                  'recorridos mediran 0 m en cuanto se simulen. No es un efecto secundario, '
                  'es el estado al que se ha vuelto.';
END $$;
