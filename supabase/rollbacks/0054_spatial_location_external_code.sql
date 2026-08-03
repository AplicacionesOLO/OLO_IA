-- ROLLBACK de 0054_spatial_location_external_code.sql
--
-- ⚠ LA GUARDA IMPORTANTE: si algún `code` difiere de su `external_code`, la
--   normalización llevaba información que solo vive en `external_code` —la Ñ de
--   `DAÑADO`, el espacio de `PHA LO`— y borrar la columna la perdería sin vuelta.
--   Con las 3 filas medidas del catálogo, ese rollback ya no sería reversible.

DO $$
DECLARE v_div int;
BEGIN
    SELECT count(1) INTO v_div FROM spatial.locations
     WHERE external_code IS NOT NULL AND external_code <> code;
    IF v_div > 0 THEN
        RAISE EXCEPTION
            '% ubicacion(es) tienen external_code distinto de code: la normalizacion '
            'perdio informacion que solo esta en esa columna (Ñ, espacios). Exportala '
            'antes de revertir.', v_div;
    END IF;
END
$$;

DROP INDEX IF EXISTS spatial.idx_loc_form;
DROP INDEX IF EXISTS spatial.uq_loc_direccion;
DROP INDEX IF EXISTS spatial.uq_loc_external_code;

ALTER TABLE spatial.locations
    DROP CONSTRAINT chk_loc_posicion_rango,
    DROP CONSTRAINT chk_loc_nivel_rango,
    DROP CONSTRAINT chk_loc_structured_completa,
    DROP CONSTRAINT chk_loc_code_normalizado,
    DROP CONSTRAINT chk_loc_form_coherente,
    DROP CONSTRAINT chk_loc_code_form;

-- El patrón de `code` vuelve al de 0012, sin el guion bajo.
ALTER TABLE spatial.locations DROP CONSTRAINT chk_loc_code;
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_code CHECK (code ~ '^[A-Z0-9][A-Z0-9.-]*$');

ALTER TABLE spatial.locations
    DROP COLUMN external_code,
    DROP COLUMN code_form;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_attribute a
     WHERE a.attrelid = 'spatial.locations'::regclass AND NOT a.attisdropped
       AND a.attname IN ('external_code', 'code_form');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % columna(s) de 0054', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_constraint co
     WHERE co.conrelid = 'spatial.locations'::regclass
       AND co.conname IN ('chk_loc_code_form', 'chk_loc_form_coherente',
                          'chk_loc_code_normalizado', 'chk_loc_structured_completa',
                          'chk_loc_nivel_rango', 'chk_loc_posicion_rango');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % CHECK de 0054', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'spatial'
       AND c.relname IN ('uq_loc_external_code', 'uq_loc_direccion', 'idx_loc_form');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % indice(s) de 0054', v_n; END IF;

    -- 0052 y 0053 intactas.
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = 'spatial.locations'::regclass
                      AND a.attname = 'logical_level' AND NOT a.attisdropped) THEN
        RAISE EXCEPTION 'logical_level desaparecio: este rollback no debe tocar 0052';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM spatial.node_types WHERE code = 'bay') THEN
        RAISE EXCEPTION 'el tipo bay desaparecio: este rollback no debe tocar 0053';
    END IF;

    RAISE NOTICE
        'OK rollback 0054: sin external_code ni code_form · 6 CHECK y 3 indices '
        'retirados · patron de code vuelto al de 0012 · 0052 y 0053 intactas';
END
$$;
