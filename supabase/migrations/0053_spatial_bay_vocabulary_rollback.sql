-- ═══════════════════════════════════════════════════════════════════════════
-- 0053_spatial_bay_vocabulary_rollback.sql
-- Revierte : 0053 · el tipo `bay`, `logical_index` y `external_code` en nodos
--
-- ⚠⚠ NO ES LIMPIAMENTE REVERSIBLE CON DATOS PRESENTES, y no es una advertencia
--    decorativa: hay **2.701 nodos de tipo `bay`** con 29.310 ubicaciones
--    colgando. Quitar el tipo exige decidir qué pasa con esos nodos, y esa
--    decisión no la puede tomar un script:
--
--      · borrarlos → se van 29.310 ubicaciones con ellos
--      · reasignarlos a otro tipo → se inventa una estructura que nunca existió
--      · dejarlos con un tipo inexistente → la FK a `node_types` lo impide
--
--    Por eso este rollback **ABORTA** si existe algún nodo `bay`. Es reversible
--    solo sobre una base sin catálogo importado. Un rollback que eligiera por su
--    cuenta entre las tres opciones sería peor que uno que se niega.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_bays int; v_ubic int;
BEGIN
    SELECT count(1) INTO v_bays FROM spatial.nodes WHERE node_type = 'bay';
    SELECT count(1) INTO v_ubic FROM spatial.locations l
      JOIN spatial.nodes n ON n.id = l.node_id WHERE n.node_type = 'bay';

    IF v_bays > 0 THEN
        RAISE EXCEPTION
            'NO se puede revertir 0053: existen % nodo(s) de tipo `bay` con % '
            'ubicacion(es) colgando. Que hacer con ellos es una decision de '
            'producto, no de un script. Vacie el catalogo espacial primero.',
            v_bays, v_ubic;
    END IF;
END
$$;

DROP INDEX IF EXISTS spatial.uq_node_external;
DROP INDEX IF EXISTS spatial.uq_node_indice_en_padre;
DROP INDEX IF EXISTS spatial.idx_node_logical;

DELETE FROM spatial.node_edges WHERE parent_type = 'bay' OR child_type = 'bay';
DELETE FROM spatial.node_types WHERE code = 'bay';

ALTER TABLE spatial.nodes
    DROP CONSTRAINT IF EXISTS chk_node_code_normalizado,
    DROP CONSTRAINT IF EXISTS chk_node_logical_index,
    DROP COLUMN IF EXISTS logical_index,
    DROP COLUMN IF EXISTS external_code;

ALTER TABLE spatial.node_types
    DROP COLUMN IF EXISTS can_hold_locations;

-- `core.normalize_spatial_code()` se CONSERVA a propósito: el CHECK
-- `chk_loc_code_normalizado` de 0054 la usa. Si se revierte 0054 primero —el
-- orden correcto— ya no habrá quien la use; eliminarla aquí rompería 0054 si
-- alguien invierte el orden, y un rollback no debe depender de que se ejecute en
-- el orden correcto para no destruir otra migración.

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM spatial.node_types WHERE code = 'bay';
    IF v_n <> 0 THEN RAISE EXCEPTION 'el tipo `bay` sigue en el catalogo'; END IF;

    SELECT count(1) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'nodes'
       AND column_name IN ('logical_index', 'external_code');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % columna(s) de 0053 en nodes', v_n; END IF;

    SELECT count(1) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'node_types'
       AND column_name = 'can_hold_locations';
    IF v_n <> 0 THEN RAISE EXCEPTION 'can_hold_locations sigue en node_types'; END IF;

    RAISE NOTICE 'OK rollback 0053: tipo `bay` y sus aristas fuera · logical_index y '
                 'external_code eliminados de nodes · normalize_spatial_code() '
                 'CONSERVADA porque el CHECK de 0054 la usa';
END
$$;
