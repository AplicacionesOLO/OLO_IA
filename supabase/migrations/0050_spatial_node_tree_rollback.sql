-- ═══════════════════════════════════════════════════════════════════════════
-- 0050_spatial_node_tree_rollback.sql
-- Revierte : 0050 · `spatial.nodes`, los tres catálogos y el guardián del árbol
--
-- ⚠ Se elimina `spatial.nodes`, así que hay que revertir 0051 ANTES: mientras
--   `spatial.locations` referencie nodos, el `DROP TABLE` con RESTRICT falla. La
--   comprobación de abajo lo nombra en lugar de dejar el error genérico de
--   PostgreSQL.
--
--   Se usa RESTRICT (por omisión) y no CASCADE a propósito: CASCADE se llevaría
--   por delante lo que otras migraciones hayan colgado de estas tablas, en
--   silencio.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_dep text; v_nodos int;
BEGIN
    -- ¿Alguien referencia `spatial.nodes` todavía?
    SELECT string_agg(DISTINCT origen.relname, ', ' ORDER BY origen.relname) INTO v_dep
      FROM pg_constraint c
      JOIN pg_class origen  ON origen.oid = c.conrelid
      JOIN pg_class destino ON destino.oid = c.confrelid
      JOIN pg_namespace n   ON n.oid = destino.relnamespace
     WHERE c.contype = 'f' AND n.nspname = 'spatial' AND destino.relname = 'nodes'
       AND origen.relname <> 'nodes';
    IF v_dep IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede revertir 0050: % referencia(n) a spatial.nodes. Revierta '
            'primero las migraciones posteriores (0051 repunta locations a nodes).',
            v_dep;
    END IF;

    SELECT count(1) INTO v_nodos FROM spatial.nodes;
    IF v_nodos > 0 THEN
        RAISE WARNING 'rollback 0050: se eliminan % nodo(s)', v_nodos;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS spatial_node_guard ON spatial.nodes;
DROP FUNCTION IF EXISTS core.spatial_node_guard();

-- Orden: primero la tabla que referencia los catálogos, luego los catálogos.
DROP TABLE IF EXISTS spatial.nodes;
DROP TABLE IF EXISTS spatial.node_edges;
DROP TABLE IF EXISTS spatial.node_functions;
DROP TABLE IF EXISTS spatial.node_types;

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial'
       AND c.relname IN ('nodes', 'node_edges', 'node_functions', 'node_types');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % tabla(s) de 0050', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'spatial_node_guard';
    IF v_n <> 0 THEN RAISE EXCEPTION 'el guardian del arbol sigue existiendo'; END IF;

    SELECT count(1) INTO v_n FROM pg_policies
     WHERE schemaname = 'spatial' AND tablename IN ('nodes', 'node_edges',
                                                   'node_functions', 'node_types');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % politica(s) huerfana(s)', v_n; END IF;

    RAISE NOTICE 'OK rollback 0050: nodes y los 3 catalogos eliminados en orden de '
                 'dependencia · guardian del arbol fuera · sin politicas huerfanas';
END
$$;
