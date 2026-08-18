-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0099 · Se quita la ocupación por hueco
--
-- No se pierde ningún dato: las dos vistas solo LEEN de `spatial.locations`, que no se toca.
-- Lo que hay que deshacer con cuidado es lo otro: `v_trip_stops` se apoya ahora en
-- `v_location_rack`, así que hay que devolverla a la forma de 0095 ANTES de tirar la vista de
-- la que depende. Al revés, PostgreSQL se niega —y con razón—.
--
-- La regla del rack vuelve a quedar escrita dentro de `v_trip_stops`, que es donde estaba. Es
-- una copia otra vez, y por eso el rollback lo dice: es el estado al que se vuelve, no una
-- mejora.
-- ═══════════════════════════════════════════════════════════════════════════════

--  Primero `v_trip_stops` como la dejó 0095: con la regla del rack dentro.
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
       CASE
           WHEN n.node_type = 'rack' THEN n.id
           ELSE n.parent_node_id
       END AS rack_node_id,
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

--  Y ahora sí, las dos vistas nuevas. La de ocupación primero: depende de la del rack.
DROP VIEW IF EXISTS spatial.v_location_occupancy;
DROP VIEW IF EXISTS spatial.v_location_rack;

DO $$
DECLARE
    v_racks int;
BEGIN
    --  La misma comprobación de 0095: si la regla volvió mal, un recorrido mediría cero
    --  metros y nadie relacionaría el síntoma con este rollback.
    SELECT count(DISTINCT rack_node_id) INTO v_racks
      FROM spatial.v_trip_stops
     WHERE location_code IN ('RCL47-C001-N01-1', 'RCL47-C010-N01-1', 'RCL47-C020-N01-1');

    --  Cero es legítimo: puede no haber ningún recorrido con esas paradas.
    IF v_racks > 1 THEN
        RAISE EXCEPTION 'las paradas de RCL47 dan % racks distintos', v_racks;
    END IF;

    RAISE NOTICE 'OK · 0099 deshecha. `v_trip_stops` vuelve a llevar la regla del rack dentro, '
                 'que es una copia — el estado de 0095—.';
END $$;
