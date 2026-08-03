-- ═══════════════════════════════════════════════════════════════════════════
-- 0054_spatial_location_external_code_rollback.sql
-- Revierte : 0054 · `external_code`, `code_form` y sus 6 CHECK
--
-- ⚠ PIERDE DATOS: `external_code` guarda el valor ORIGINAL del WMS con su
--   grafía exacta —`DAÑADO-C001-N01-1`, `PHA LO-C001-N01-1`— que no se puede
--   reconstruir desde el `code` normalizado: la normalización no es inyectiva
--   (el espacio y el guion bajo colapsan al mismo carácter).
--
--   Por eso aborta si hay valores externos distintos del código, salvo
--   confirmación explícita:
--
--       SET LOCAL olo.confirm_destructive = '0054';
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_irrecuperables int; v_conf text;
BEGIN
    SELECT count(1) INTO v_irrecuperables FROM spatial.locations
     WHERE external_code IS NOT NULL AND external_code <> code;
    IF v_irrecuperables > 0 THEN
        v_conf := coalesce(current_setting('olo.confirm_destructive', true), '');
        IF v_conf <> '0054' THEN
            RAISE EXCEPTION
                'Revertir 0054 perderia % valor(es) externo(s) que NO se pueden '
                'reconstruir desde el codigo normalizado. Si es lo que quiere: '
                'SET LOCAL olo.confirm_destructive = ''0054'';', v_irrecuperables;
        END IF;
        RAISE WARNING 'rollback 0054: se pierden % valores externos irrecuperables',
                      v_irrecuperables;
    END IF;
END
$$;

DROP INDEX IF EXISTS spatial.uq_loc_external_code;
DROP INDEX IF EXISTS spatial.uq_loc_direccion;
DROP INDEX IF EXISTS spatial.idx_loc_form;

ALTER TABLE spatial.locations
    DROP CONSTRAINT IF EXISTS chk_loc_code_form,
    DROP CONSTRAINT IF EXISTS chk_loc_code_normalizado,
    DROP CONSTRAINT IF EXISTS chk_loc_form_coherente,
    DROP CONSTRAINT IF EXISTS chk_loc_nivel_rango,
    DROP CONSTRAINT IF EXISTS chk_loc_posicion_rango,
    DROP CONSTRAINT IF EXISTS chk_loc_structured_completa,
    DROP COLUMN IF EXISTS code_form,
    DROP COLUMN IF EXISTS external_code;

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'locations'
       AND column_name IN ('code_form', 'external_code');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % columna(s) de 0054', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_constraint
     WHERE conrelid = 'spatial.locations'::regclass
       AND conname IN ('chk_loc_code_form', 'chk_loc_code_normalizado',
                       'chk_loc_form_coherente', 'chk_loc_nivel_rango',
                       'chk_loc_posicion_rango', 'chk_loc_structured_completa');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % CHECK de 0054', v_n; END IF;

    RAISE NOTICE 'OK rollback 0054: external_code y code_form eliminados · 6 CHECK · '
                 '3 indices';
END
$$;
