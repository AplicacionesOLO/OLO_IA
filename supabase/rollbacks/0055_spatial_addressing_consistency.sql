-- ROLLBACK de 0055_spatial_addressing_consistency.sql
--
-- Solo retira reglas: no hay datos que revertir. El trigger primero, porque
-- mientras exista no se puede borrar su función.
--
-- ⚠ Después de esto, nada impide que una ubicación cuelgue de un rack ni que su
--   código discrepe del árbol. Es el estado anterior, no un estado bueno: si se
--   revierte 0055 con datos importados, hay que volver a aplicarla antes de
--   permitir cualquier escritura.

DROP TRIGGER spatial_location_guard ON spatial.locations;

DROP FUNCTION core.spatial_location_guard();
DROP FUNCTION core.build_location_code(text, integer, integer, integer);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'spatial' AND c.relname = 'locations'
       AND t.tgname = 'spatial_location_guard';
    IF v_n <> 0 THEN RAISE EXCEPTION 'el trigger sigue existiendo'; END IF;

    SELECT count(1) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'core'
       AND p.proname IN ('spatial_location_guard', 'build_location_code');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % funcion(es) de 0055', v_n; END IF;

    -- 0053 y 0054 intactas: este rollback no debe tocarlas.
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                    WHERE ns.nspname = 'core' AND p.proname = 'normalize_spatial_code') THEN
        RAISE EXCEPTION 'normalize_spatial_code desaparecio: es de 0053';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = 'spatial.locations'::regclass
                      AND a.attname = 'code_form' AND NOT a.attisdropped) THEN
        RAISE EXCEPTION 'code_form desaparecio: es de 0054';
    END IF;
    -- Y el trigger de la jerarquía de nodos sigue en pie: es de 0050.
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                    JOIN pg_namespace ns ON ns.oid = c.relnamespace
                   WHERE ns.nspname = 'spatial' AND c.relname = 'nodes'
                     AND t.tgname = 'spatial_node_guard') THEN
        RAISE EXCEPTION 'spatial_node_guard desaparecio: es de 0050';
    END IF;

    RAISE NOTICE
        'OK rollback 0055: sin trigger de ubicacion, sin spatial_location_guard ni '
        'build_location_code · 0050, 0053 y 0054 intactas';
END
$$;
