-- ═══════════════════════════════════════════════════════════════════════════════
-- 0099 · La ocupación HUECO A HUECO, y una sola regla para «¿de qué rack es?»
--
-- ── DE DONDE SALE ─────────────────────────────────────────────────────────────
--
-- El visor 3D tiene 40.422 piezas de estantería y DATO en cinco huecos de 29.312: los cinco
-- que se han inspeccionado. Es un modelo del espacio, no del stock.
--
-- Pero el catálogo importado sí trae, para cada una de las 29.312 ubicaciones, la palabra con
-- la que el WMS la describe —`OCUP`, `DISP`, `BLOQ`, `BLOQES`, `BLOQFI`, `RESREC`, `PROB`— y
-- su estado en el vocabulario cerrado del espacio —`available` / `blocked`—. Con eso se puede
-- pintar el almacén entero.
--
-- Medido sobre los 30 racks colocados: 7.090 OCUP, 1.168 BLOQES, 651 DISP, 486 BLOQFI,
-- 233 BLOQ, 37 RESREC, 8 PROB. Y 88 donde las dos columnas se contradicen.
--
-- ── LO QUE ESTO NO ES ─────────────────────────────────────────────────────────
--
-- No es ocupación viva. Es lo que el WMS declaró en la fecha de la importación, y por eso la
-- vista expone la palabra tal cual en vez de traducirla a un booleano «lleno/vacío»: `BLOQES`
-- y `BLOQFI` son dos motivos distintos de bloqueo, y colapsarlos perdería justo lo que
-- alguien querría mirar. Quien pinta decide el color; la base no decide el significado.
--
-- ── POR QUE HAY DOS VISTAS Y NO UNA ───────────────────────────────────────────
--
-- Porque hay dos preguntas, y una de ellas ya estaba contestada en dos sitios distintos.
--
-- `v_location_rack` contesta «¿de qué RACK es este hueco?». La regla —el nodo si ya es un
-- rack, y si no su padre— la escribió 0095 dentro de `v_trip_stops` para arreglar un fallo
-- que hacía que un recorrido midiera cero metros. Escribirla aquí otra vez seria la tercera
-- copia de una regla que, cuando se separa, hace que el mapa diga una cosa y la distancia
-- otra. Asi que se saca a su propia vista y `v_trip_stops` SE REESCRIBE encima de ella:
-- queda una definicion, no tres.
--
-- `v_location_occupancy` contesta «¿qué dice el WMS de este hueco?», y de paso marca los
-- conflictos con la MISMA condicion que 0059 usa para contarlos:
--
--     (location_situation LIKE 'BLOQ%' AND status <> 'blocked')
--  OR (location_situation = 'DISP'    AND status <> 'available')
--
-- Que sea la misma no es una promesa: al final de esta migracion se comprueba que el recuento
-- de la vista coincide con el que ya publica `spatial.floor_plan`. Si algun dia alguien
-- cambia una de las dos, esa comprobacion es la que lo cuenta.
--
-- Notese que `OCUP` con `blocked` NO cuenta como conflicto, y es deliberado: 0059 dejo fuera
-- ese caso porque «hay un palet» no afirma nada sobre si el hueco se puede usar.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · De qué rack es un hueco ───────────────────────────────────────────────
CREATE OR REPLACE VIEW spatial.v_location_rack
WITH (security_invoker = true) AS
SELECT l.id AS location_id,
       l.tenant_id,
       l.warehouse_id,
       l.code,
       --  En este catálogo cada CUERPO es su propio nodo, así que el rack de una ubicación
       --  es su nodo si ya es un rack y, si no, su padre. Sin esto, cruzar un hueco con la
       --  colocación del plano no encuentra nada: la lección de 0095.
       CASE WHEN n.node_type = 'rack' THEN n.id ELSE n.parent_node_id END AS rack_node_id,
       l.logical_column   AS bay_index,
       l.logical_level    AS level,
       l.logical_position AS position
  FROM spatial.locations l
  LEFT JOIN spatial.nodes n ON n.id = l.node_id
 WHERE l.deleted_at IS NULL;

GRANT SELECT ON spatial.v_location_rack TO olo_app, authenticated;

-- ── 2 · Qué dice el WMS de cada hueco ─────────────────────────────────────────
CREATE OR REPLACE VIEW spatial.v_location_occupancy
WITH (security_invoker = true) AS
SELECT r.location_id,
       r.tenant_id,
       r.warehouse_id,
       r.code,
       r.rack_node_id,
       r.bay_index,
       r.level,
       r.position,
       --  La palabra del WMS, SIN traducir. Vocabulario abierto: el dia que aparezca `RESPRO`
       --  esta vista lo sirve igual y quien pinta lo trata como desconocido, que es mejor que
       --  una vista que lo tira.
       l.location_situation AS situation,
       --  Y el vocabulario CERRADO del espacio, que es lo que de verdad dice si se puede usar.
       l.status,
       --  El conflicto entre los dos. MISMA condicion que `status_situation_conflicts` de
       --  0059; la comprobacion del final ata las dos.
       (
           (l.location_situation LIKE 'BLOQ%' AND l.status <> 'blocked')
        OR (l.location_situation = 'DISP' AND l.status <> 'available')
       ) AS conflict
  FROM spatial.v_location_rack r
  JOIN spatial.locations l ON l.id = r.location_id;

GRANT SELECT ON spatial.v_location_occupancy TO olo_app, authenticated;

-- ── 3 · `v_trip_stops`, ahora encima de la regla compartida ───────────────────
--
-- Mismas columnas, mismo orden y mismo significado que dejó 0095: lo único que cambia es de
-- dónde sale `rack_node_id`. Se reescribe con `CREATE OR REPLACE`, que exige conservar
-- nombre, tipo y orden — y por eso se copian los quince campos tal cual—.
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
       r.rack_node_id,
       l.logical_column   AS bay_index,
       l.logical_level    AS level,
       l.logical_position AS position,
       s.created_at,
       s.updated_at,
       s.version
  FROM spatial.trip_stops s
  JOIN spatial.locations l ON l.id = s.location_id
  LEFT JOIN spatial.v_location_rack r ON r.location_id = l.id
 WHERE s.deleted_at IS NULL AND l.deleted_at IS NULL;

GRANT SELECT ON spatial.v_trip_stops TO olo_app, authenticated;

DO $$
DECLARE
    v_wh uuid;
    v_vista int;
    v_plano int;
    v_racks int;
    v_huecos int;
BEGIN
    -- ── La regla del rack sigue dando lo mismo ────────────────────────────────
    --
    -- La misma comprobación que 0095: los tres huecos de RCL47 tienen que resolver a UN rack.
    -- Es lo que estaba mal entonces y lo que se acaba de mover de sitio.
    SELECT count(DISTINCT rack_node_id) INTO v_racks
      FROM spatial.v_location_rack
     WHERE code IN ('RCL47-C001-N01-1', 'RCL47-C010-N01-1', 'RCL47-C020-N01-1');
    IF v_racks <> 1 THEN
        RAISE EXCEPTION
            'los tres huecos de RCL47 deberian dar UN rack y dan %. Mover la regla la ha '
            'roto, y el sintoma seria un recorrido de cero metros.', v_racks;
    END IF;

    -- ── El conflicto se cuenta igual que en 0059 ──────────────────────────────
    SELECT warehouse_id INTO v_wh FROM spatial.floor_plan GROUP BY warehouse_id
     ORDER BY count(*) DESC LIMIT 1;

    SELECT count(*) INTO v_vista
      FROM spatial.v_location_occupancy WHERE warehouse_id = v_wh AND conflict;
    SELECT coalesce(sum(status_situation_conflicts), 0) INTO v_plano
      FROM spatial.floor_plan WHERE warehouse_id = v_wh;

    IF v_vista <> v_plano THEN
        RAISE EXCEPTION
            'la vista cuenta % conflictos y `floor_plan` %. Son la MISMA regla escrita dos '
            'veces y acaban de separarse: el color del plano diria una cosa y el resumen '
            'otra.', v_vista, v_plano;
    END IF;

    SELECT count(*) INTO v_huecos FROM spatial.v_location_occupancy WHERE warehouse_id = v_wh;
    RAISE NOTICE 'OK · % hueco(s) con situacion del WMS y % conflicto(s), que es lo mismo que '
                 'ya publicaba floor_plan.', v_huecos, v_vista;
END $$;
