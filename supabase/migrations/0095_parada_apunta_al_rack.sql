-- ═══════════════════════════════════════════════════════════════════════════════
-- 0095 · La parada de un recorrido tiene que decir su RACK, no su cuerpo
--
-- ── EL FALLO ──────────────────────────────────────────────────────────────────
--
-- `v_trip_stops` (0094) expone `l.node_id AS rack_node_id`, dando por hecho que el nodo de
-- una ubicación es su rack. No lo es: en este catálogo cada CUERPO es su propio nodo.
--
-- Comprobado con tres huecos del mismo rack:
--
--     RCL47-C001-N01-1  →  node_id deee29c0…  node_type 'bay'  parent 89d1b041… 'rack'
--     RCL47-C010-N01-1  →  node_id 127284b3…  node_type 'bay'  parent 89d1b041… 'rack'
--     RCL47-C020-N01-1  →  node_id 08d20233…  node_type 'bay'  parent 89d1b041… 'rack'
--
-- Los tres son del rack `89d1b041…` —el mismo que usa la capa de inspección— y la vista
-- devolvía tres identificadores distintos, ninguno de ellos un rack.
--
-- ── POR QUE IMPORTA TANTO ─────────────────────────────────────────────────────
--
-- Porque la simulación sitúa cada parada cruzando su rack con la colocación del plano. Con
-- el identificador de un cuerpo, ese cruce NO ENCUENTRA NADA: la parada se queda «sin
-- sitio», y un recorrido de diez paradas mide cero metros.
--
-- Y lo peor es que no habría fallado ruidosamente. La simulación está escrita para decir qué
-- paradas se saltó — precisamente para que un total corto no pase por bueno— así que el
-- síntoma habría sido «mi recorrido dice 0 m» sin ninguna pista de por qué.
--
-- Salió de una sonda contra la base real, no de leer el código.
--
-- ── LA REGLA ──────────────────────────────────────────────────────────────────
--
-- El rack de una ubicación es su nodo si ese nodo YA es un rack, y si no, su padre. Es la
-- misma regla que usa la consulta de ubicaciones por rack en el repositorio:
--
--     l.node_id = :rack OR l.node_id IN (SELECT id FROM nodes WHERE parent_node_id = :rack)
--
-- Se escribe una vez, aquí, para que no haya dos formas de contestar «¿de qué rack es este
-- hueco?». Es la lección de `_ORDEN`, que se escribió tres veces y dio tres respuestas.
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
       --  El RACK: el nodo si ya lo es, y si no su padre. Un `bay` cuelga del rack.
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

-- ── Comprobación: los tres huecos del mismo rack dan el MISMO rack ────────────
--
-- Sobre el catálogo real y sin crear ningún recorrido: se comprueba la regla, que es lo que
-- estaba mal, no la vista entera.
DO $$
DECLARE
    v_racks int;
BEGIN
    SELECT count(DISTINCT CASE WHEN n.node_type = 'rack' THEN n.id ELSE n.parent_node_id END)
      INTO v_racks
      FROM spatial.locations l
      LEFT JOIN spatial.nodes n ON n.id = l.node_id
     WHERE l.code IN ('RCL47-C001-N01-1', 'RCL47-C010-N01-1', 'RCL47-C020-N01-1')
       AND l.deleted_at IS NULL;

    IF v_racks <> 1 THEN
        RAISE EXCEPTION
            'los tres huecos de RCL47 deberian dar UN rack y dan %. La regla no sirve para '
            'este catalogo y la simulacion mediria cero metros.', v_racks;
    END IF;

    RAISE NOTICE 'OK · los tres huecos de RCL47 resuelven al mismo rack. La parada ya sabe '
                 'donde esta.';
END $$;
