-- ═══════════════════════════════════════════════════════════════════════════════
-- 0094 · Recorridos: cuánto se anda y cuánto se tarda
--
-- ── QUE PROBLEMA RESUELVE ─────────────────────────────────────────────────────
--
-- El almacén ya está modelado a escala: racks con sus medidas reales, huecos con su
-- estado, figuras a su tamaño. Con eso se puede MIRAR, y no se puede DECIDIR.
--
-- La pregunta que un jefe de almacén hace de verdad es «¿cuánto se anda en este picking?»
-- y «¿se andaría menos si muevo esta hilera?». Para contestarla hace falta una tercera
-- cosa: recorridos que se puedan medir y comparar.
--
-- Un recorrido de aquí produce un número: «340 m, 4 min 50 s». Y ese número CAMBIA cuando
-- se mueve un rack, que es exactamente lo que lo hace útil.
--
-- ── POR QUE LAS PARADAS SON UBICACIONES REALES ────────────────────────────────
--
-- Porque un recorrido tiene que sobrevivir a que alguien mueva la hilera. Si las paradas
-- fueran puntos en metros, mover un rack dejaría el recorrido apuntando al aire y su
-- distancia seguiría diciendo lo mismo — un número que ya no describe nada—.
--
-- Apuntando al hueco `RCL47-C018-N01-2`, mover ese rack cambia la distancia sola. Ahí está
-- todo el valor: comparar dos disposiciones es volver a calcular, no volver a dibujar.
--
-- ── DONDE SE CALCULA LA DISTANCIA, Y POR QUE NO AQUI ──────────────────────────
--
-- En el navegador. Y no es pereza: los metros de un hueco no están en la base.
--
-- Un hueco sabe a qué rack, cuerpo, nivel y posición pertenece —eso es estructura lógica—
-- pero su posición en metros sale de CRUZAR esa estructura con la colocación del rack
-- (`spatial.rack_placements`: centro, giro, largo) y con las medidas del almacén (0092).
-- Esa aritmética ya existe, probada, en `placasDeHuecos` y `celdasDeRack` del visor.
--
-- Escribirla otra vez en SQL serían dos implementaciones de la misma proyección, y ya
-- sabemos cómo acaba eso: `_ORDEN` se escribió tres veces con tres criterios y el mapa
-- decía una cosa mientras la cobertura decía otra.
--
-- Así que aquí se guarda la DEFINICION del recorrido —qué paradas, en qué orden, a qué
-- velocidad, cuánto se para en cada una— y el resultado se calcula donde está la geometría.
--
-- ── EL TIEMPO SALE DE LA VELOCIDAD, NO SE TECLEA ──────────────────────────────
--
-- Cada recorrido lleva la velocidad de quien lo hace: un operario a pie 1,2 m/s, un
-- montacargas 2,5, un dron 3. El tiempo de marcha es distancia entre velocidad, y las
-- paradas añaden sus segundos.
--
-- Teclear duraciones por tramo daría más control y rompería lo único que importa: mover un
-- rack no cambiaría el tiempo, y entonces la simulación no sirve para comparar nada.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · El recorrido ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spatial.trips (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES core.tenants(id),
    warehouse_id    uuid NOT NULL,

    name            varchar(120) NOT NULL,

    -- ── Quién lo hace ─────────────────────────────────────────────────────────
    --
    -- Opcional: un recorrido se puede medir antes de decidir con qué figura se anima. Sin
    -- figura, la línea de tiempo funciona igual y lo que se mueve es un marcador.
    model_id        uuid REFERENCES spatial.asset_models(id),

    -- ── A qué velocidad ───────────────────────────────────────────────────────
    --
    -- En metros por segundo, que es la unidad en la que se mide de verdad. 1,2 es el paso
    -- de una persona cargando; 2,5 un montacargas en pasillo; 3 un dron.
    --
    -- El tope de 30 m/s son 108 km/h: nada que se mueva dentro de un almacén llega ahí, y
    -- corta el error de unidad de quien teclee km/h.
    speed_mps       double precision NOT NULL DEFAULT 1.2,

    notes           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    version         integer NOT NULL DEFAULT 1,
    deleted_at      timestamptz,

    CONSTRAINT fk_trip_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_trip_speed CHECK (speed_mps > 0 AND speed_mps <= 30)
);

-- Un nombre por almacén: dos «Picking mañana» son dos recorridos que nadie distingue al
-- comparar resultados, que es para lo que existen.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_nombre
    ON spatial.trips (warehouse_id, lower(name))
    WHERE deleted_at IS NULL;

COMMENT ON TABLE spatial.trips IS
    'Un recorrido que se puede medir: paradas en ubicaciones REALES y una velocidad. La '
    'distancia y el tiempo se calculan donde esta la geometria —el navegador—, porque los '
    'metros de un hueco salen de cruzar su estructura logica con la colocacion del rack.';

-- ── 2 · Las paradas ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spatial.trip_stops (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES core.tenants(id),
    trip_id         uuid NOT NULL REFERENCES spatial.trips(id) ON DELETE CASCADE,

    -- El ORDEN es parte del dato: un recorrido con las mismas paradas en otro orden es otro
    -- recorrido, y casi siempre con otra distancia.
    seq             integer NOT NULL,

    -- ── Dónde ─────────────────────────────────────────────────────────────────
    --
    -- Un hueco de verdad. `ON DELETE RESTRICT` y no `CASCADE`: si alguien borra una
    -- ubicación del catálogo, un recorrido no puede quedarse con un agujero en medio sin
    -- que nadie se entere. Que falle y se decida.
    location_id     uuid NOT NULL,

    -- ── Qué se hace ahí ───────────────────────────────────────────────────────
    --
    -- Lista cerrada. La operación no cambia la distancia pero sí el tiempo, y sobre todo
    -- dice QUE es el recorrido: «recoger, recoger, dejar» es picking y «revisar, revisar»
    -- es un inventario.
    operation       varchar(16) NOT NULL DEFAULT 'pasar',

    -- Segundos parado. Es la otra mitad del tiempo total, y la que no depende de la
    -- geometria: recoger una caja tarda lo que tarda aunque el rack se mueva.
    dwell_s         double precision NOT NULL DEFAULT 0,

    notes           text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    version         integer NOT NULL DEFAULT 1,
    deleted_at      timestamptz,

    -- `RESTRICT` y no `CASCADE`: si alguien borra una ubicacion del catalogo, un recorrido
    -- no puede quedarse con un agujero en medio sin que nadie se entere. Que falle y se
    -- decida si el recorrido sigue teniendo sentido.
    CONSTRAINT fk_stop_location
        FOREIGN KEY (location_id) REFERENCES spatial.locations(id) ON DELETE RESTRICT,
    CONSTRAINT chk_stop_operation CHECK (
        operation IN ('salida', 'recoger', 'dejar', 'revisar', 'pasar', 'vuelta')
    ),
    -- Una hora parado en un hueco no es una parada, es un error de unidad —minutos donde
    -- van segundos— y a las tres paradas el total ya no significa nada.
    CONSTRAINT chk_stop_dwell CHECK (dwell_s >= 0 AND dwell_s <= 3600),
    CONSTRAINT chk_stop_seq CHECK (seq >= 0)
);

-- Un solo orden por recorrido: dos paradas con el mismo `seq` no se pueden ordenar, y el
-- resultado dependeria de como las devolviera la base.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stop_orden
    ON spatial.trip_stops (trip_id, seq)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_stop_trip
    ON spatial.trip_stops (trip_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE spatial.trip_stops IS
    'Las paradas de un recorrido, en orden, cada una en una ubicacion REAL. Apuntar al '
    'hueco y no a un punto en metros es lo que hace que mover un rack cambie la distancia '
    'sola: comparar dos disposiciones es volver a calcular, no volver a dibujar.';

-- ── 3 · RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE spatial.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.trips FORCE ROW LEVEL SECURITY;

CREATE POLICY trips_select ON spatial.trips
    FOR SELECT USING (tenant_id = core.current_tenant_id());
CREATE POLICY trips_write ON spatial.trips
    FOR ALL USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

ALTER TABLE spatial.trip_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.trip_stops FORCE ROW LEVEL SECURITY;

CREATE POLICY stops_select ON spatial.trip_stops
    FOR SELECT USING (tenant_id = core.current_tenant_id());
CREATE POLICY stops_write ON spatial.trip_stops
    FOR ALL USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.trips TO olo_app, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.trip_stops TO olo_app, authenticated;

-- ── 4 · Las paradas con su ubicación ──────────────────────────────────────────
--
-- Une la parada con el CODIGO del hueco y con su estructura —rack, cuerpo, nivel,
-- posicion—, que es lo que el navegador necesita para situarla en metros. Sin esta vista
-- haria una consulta por parada.
CREATE OR REPLACE VIEW spatial.v_trip_stops
WITH (security_invoker = true) AS
SELECT s.id,
       s.trip_id,
       s.seq,
       s.operation,
       s.dwell_s,
       s.notes,
       s.location_id,
       l.code            AS location_code,
       l.node_id         AS rack_node_id,
       l.logical_column  AS bay_index,
       l.logical_level   AS level,
       l.logical_position AS position,
       s.created_at,
       s.updated_at,
       s.version
  FROM spatial.trip_stops s
  JOIN spatial.locations l ON l.id = s.location_id
 WHERE s.deleted_at IS NULL AND l.deleted_at IS NULL;

GRANT SELECT ON spatial.v_trip_stops TO olo_app, authenticated;

DO $$
BEGIN
    RAISE NOTICE 'OK · recorridos y paradas creados, VACIOS: un recorrido lo define quien '
                 'conoce el almacen, no una migracion.';
END $$;
