-- ROLLBACK de 0050_spatial_node_tree.sql
--
-- SIN `CASCADE`. Orden inverso a las dependencias:
--   `nodes` referencia los tres catálogos, así que va primero.
--   `node_edges` referencia `node_types`, así que va antes que él.
--   La función del trigger, al final: mientras exista el trigger no se puede borrar.
--
-- Si el DROP de `nodes` falla es porque `spatial.locations` ya apunta a él (0052
-- sin revertir), y ese fallo es la señal deseada.

DROP TABLE spatial.nodes;
DROP TABLE spatial.node_edges;
DROP TABLE spatial.node_functions;
DROP TABLE spatial.node_types;

DROP FUNCTION core.spatial_node_guard();


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_tab int;
    v_fn  int;
    v_pol int;
BEGIN
    SELECT count(1) INTO v_tab FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial'
       AND c.relname IN ('nodes', 'node_edges', 'node_functions', 'node_types');
    IF v_tab <> 0 THEN RAISE EXCEPTION 'quedan % tabla(s) de 0050', v_tab; END IF;

    SELECT count(1) INTO v_fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'spatial_node_guard';
    IF v_fn <> 0 THEN RAISE EXCEPTION 'core.spatial_node_guard() sigue existiendo'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies WHERE schemaname = 'spatial'
       AND tablename IN ('nodes', 'node_edges', 'node_functions', 'node_types');
    IF v_pol <> 0 THEN RAISE EXCEPTION 'quedan % politica(s) huerfana(s)', v_pol; END IF;

    -- Lo de 0048 y 0049 sigue en pie: este rollback no debe tocarlo.
    IF (SELECT count(1) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'spatial'
           AND c.relname IN ('areas', 'locations', 'sites', 'reference_frames')) <> 4 THEN
        RAISE EXCEPTION 'falta alguna tabla de 0048/0049: este rollback no debe tocarlas';
    END IF;

    RAISE NOTICE
        'OK rollback 0050: sin nodes, node_edges, node_functions ni node_types · '
        'sin la funcion del trigger · sin politicas huerfanas · 0048 y 0049 intactas';
END
$$;
