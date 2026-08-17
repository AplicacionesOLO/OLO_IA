-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0094 · Recorridos simulados
--
-- Avisa si hay recorridos definidos antes de tirarlos. Un recorrido lo escribió alguien que
-- conoce el almacén —qué huecos, en qué orden, cuánto se para en cada uno— y eso no se
-- recupera de ningún sitio: no sale de una importación ni de un análisis.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_recorridos int;
    v_paradas    int;
BEGIN
    SELECT count(*) INTO v_recorridos FROM spatial.trips WHERE deleted_at IS NULL;
    SELECT count(*) INTO v_paradas FROM spatial.trip_stops WHERE deleted_at IS NULL;
    IF v_recorridos > 0 THEN
        RAISE EXCEPTION
            'hay % recorrido(s) con % parada(s) definidos. Bórralos a mano si de verdad '
            'quieres deshacer: no se recuperan de ninguna importacion.',
            v_recorridos, v_paradas;
    END IF;
END $$;

DROP VIEW IF EXISTS spatial.v_trip_stops;

DROP POLICY IF EXISTS stops_select ON spatial.trip_stops;
DROP POLICY IF EXISTS stops_write ON spatial.trip_stops;
DROP POLICY IF EXISTS trips_select ON spatial.trips;
DROP POLICY IF EXISTS trips_write ON spatial.trips;

--  Las paradas primero: referencian al recorrido.
DROP TABLE IF EXISTS spatial.trip_stops;
DROP TABLE IF EXISTS spatial.trips;

DO $$
BEGIN
    RAISE NOTICE 'OK · 0094 deshecha. Nada mas del esquema cambio.';
END $$;
