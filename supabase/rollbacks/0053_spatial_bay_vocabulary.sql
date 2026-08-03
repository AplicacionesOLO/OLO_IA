-- ROLLBACK de 0053_spatial_bay_vocabulary.sql
--
-- Orden inverso a las dependencias. La guarda del principio es la que importa: si
-- ya existen nodos de tipo `bay`, borrar el tipo dejaría el árbol sin vocabulario
-- para describirlos, así que se falla con un mensaje que dice qué revertir primero.

DO $$
DECLARE v_bays int; v_ext int;
BEGIN
    SELECT count(1) INTO v_bays FROM spatial.nodes WHERE node_type = 'bay';
    IF v_bays > 0 THEN
        RAISE EXCEPTION
            'Existen % nodo(s) de tipo bay. Revierte primero la importacion que los '
            'creo: borrar el tipo dejaria el arbol sin vocabulario para describirlos.',
            v_bays;
    END IF;

    -- `external_code` puede llevar informacion que `node_code` perdio al normalizar
    -- (la Ñ de DAÑADO, el espacio de PHA LO). Borrarlo seria irreversible.
    SELECT count(1) INTO v_ext FROM spatial.nodes
     WHERE external_code IS NOT NULL AND external_code <> node_code;
    IF v_ext > 0 THEN
        RAISE EXCEPTION
            '% nodo(s) tienen external_code distinto de node_code: la normalizacion '
            'perdio informacion que solo esta ahi. Exportala antes de revertir.', v_ext;
    END IF;
END
$$;

DROP INDEX IF EXISTS spatial.uq_node_indice_en_padre;
DROP INDEX IF EXISTS spatial.uq_node_external;
DROP INDEX IF EXISTS spatial.idx_node_logical;

ALTER TABLE spatial.nodes
    DROP CONSTRAINT chk_node_code_normalizado,
    DROP CONSTRAINT chk_node_logical_index;

ALTER TABLE spatial.nodes
    DROP COLUMN logical_index,
    DROP COLUMN external_code;

DELETE FROM spatial.node_edges WHERE parent_type = 'rack' AND child_type = 'bay';

ALTER TABLE spatial.node_types DROP COLUMN can_hold_locations;

DELETE FROM spatial.node_types WHERE code = 'bay';
UPDATE spatial.node_types SET depth_hint = 6 WHERE code = 'storage_area';

-- Al final: mientras el CHECK la use, no se puede borrar.
DROP FUNCTION core.normalize_spatial_code(text);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM spatial.node_types;
    IF v_n <> 6 THEN RAISE EXCEPTION 'se esperaban 6 node_types, hay %', v_n; END IF;
    IF EXISTS (SELECT 1 FROM spatial.node_types WHERE code = 'bay') THEN
        RAISE EXCEPTION 'el tipo bay sigue existiendo';
    END IF;
    IF (SELECT depth_hint FROM spatial.node_types WHERE code = 'storage_area') <> 6 THEN
        RAISE EXCEPTION 'storage_area no volvio a depth_hint 6';
    END IF;

    SELECT count(1) INTO v_n FROM spatial.node_edges;
    IF v_n <> 12 THEN RAISE EXCEPTION 'se esperaban 12 aristas, hay %', v_n; END IF;

    IF EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = 'spatial.nodes'::regclass
                  AND a.attname IN ('logical_index', 'external_code')
                  AND NOT a.attisdropped) THEN
        RAISE EXCEPTION 'quedan columnas de 0053 en spatial.nodes';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = 'spatial.node_types'::regclass
                  AND a.attname = 'can_hold_locations' AND NOT a.attisdropped) THEN
        RAISE EXCEPTION 'can_hold_locations sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'core' AND p.proname = 'normalize_spatial_code') THEN
        RAISE EXCEPTION 'core.normalize_spatial_code() sigue existiendo';
    END IF;

    -- 0050-0052 intactas.
    IF (SELECT count(1) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'spatial' AND c.relkind = 'r') <> 7 THEN
        RAISE EXCEPTION 'el numero de tablas de spatial cambio';
    END IF;

    RAISE NOTICE
        'OK rollback 0053: 6 node_types · 12 aristas · sin logical_index, external_code '
        'ni can_hold_locations · sin la funcion de normalizacion · 7 tablas intactas';
END
$$;
