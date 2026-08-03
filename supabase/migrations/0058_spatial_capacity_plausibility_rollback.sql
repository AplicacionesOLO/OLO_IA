-- ═══════════════════════════════════════════════════════════════════════════
-- 0058_spatial_capacity_plausibility_rollback.sql
-- Revierte : 0058 · vuelve a la enumeración de centinelas de 0052
--
-- ── Qué significa «revertir» aquí, exactamente ─────────────────────────────
--
-- 0058 hizo dos cosas: cambió los CHECK y anuló capacidades implausibles
-- guardando el original en `raw_source.peso_max_crudo`. La reversión de la
-- primera es exacta. La de la segunda tiene un límite que conviene nombrar:
--
--   · Un crudo que el CHECK de 0052 ACEPTA (100.000 … 100.000.000) se
--     restituye a la columna y su marca se borra. Reversión exacta.
--   · Un crudo que el CHECK de 0052 PROHÍBE (999.999.999 y 1.000.000.000) no
--     puede volver a la columna: 0052 lo rechazaría. Se queda como NULL con su
--     `peso_max_crudo` intacto — que es precisamente donde 0052 lo dejaba
--     también, salvo que 0052 lo perdía y esto no.
--
-- Es decir: la reversión NO destruye nada, en ningún caso. Lo que no puede es
-- deshacer una mejora — que la base recuerde lo que el WMS dijo— y eso no es un
-- defecto del rollback, es que 0052 tenía menos información. El recuento de las
-- dos categorías se imprime al final para que la asimetría quede en el registro
-- y no en la memoria de nadie.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE spatial.locations
    DROP CONSTRAINT chk_loc_peso_plausible,
    DROP CONSTRAINT chk_loc_unidades_plausible,
    DROP CONSTRAINT chk_loc_volumen_plausible;

-- ── 1 · Restituir lo restituible, y solo eso ───────────────────────────────
--
-- El filtro es el propio predicado de 0052, escrito una vez: un valor se
-- restituye si y solo si el CHECK que va a volver lo aceptaría.
DO $$
DECLARE v_restituidas int; v_retenidas int;
BEGIN
    UPDATE spatial.locations
       SET max_weight_kg = (raw_source->>'peso_max_crudo')::numeric,
           raw_source    = raw_source - 'peso_max_crudo' - 'capacidad_anulada_por',
           updated_at    = now()
     WHERE raw_source ? 'peso_max_crudo'
       AND (raw_source->>'peso_max_crudo')::numeric > 0
       AND (raw_source->>'peso_max_crudo')::numeric NOT IN (999999999, 1000000000);
    GET DIAGNOSTICS v_restituidas = ROW_COUNT;

    UPDATE spatial.locations
       SET max_units  = (raw_source->>'unidades_max_crudo')::numeric,
           raw_source = raw_source - 'unidades_max_crudo',
           updated_at = now()
     WHERE raw_source ? 'unidades_max_crudo'
       AND (raw_source->>'unidades_max_crudo')::numeric > 0
       AND (raw_source->>'unidades_max_crudo')::numeric NOT IN (999999999, 1000000000);

    UPDATE spatial.locations
       SET max_volume_m3 = (raw_source->>'volumen_max_crudo')::numeric,
           raw_source    = raw_source - 'volumen_max_crudo',
           updated_at    = now()
     WHERE raw_source ? 'volumen_max_crudo'
       AND (raw_source->>'volumen_max_crudo')::numeric > 0
       AND (raw_source->>'volumen_max_crudo')::numeric NOT IN (999999999, 1000000000);

    SELECT count(1) INTO v_retenidas FROM spatial.locations
     WHERE raw_source ? 'peso_max_crudo';

    RAISE NOTICE 'rollback 0058: % capacidad(es) restituida(s) a la columna, '
                 '% retenida(s) en raw_source porque el CHECK de 0052 las prohibe '
                 '(no se pierde ninguna)', v_restituidas, v_retenidas;
END
$$;


-- ── 2 · Los CHECK enumerativos de 0052, tal cual estaban ───────────────────
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_peso_sin_centinela CHECK (
        max_weight_kg IS NULL
        OR (max_weight_kg > 0 AND max_weight_kg NOT IN (999999999, 1000000000))
    ),
    ADD CONSTRAINT chk_loc_unidades_sin_centinela CHECK (
        max_units IS NULL
        OR (max_units > 0 AND max_units NOT IN (999999999, 1000000000))
    ),
    ADD CONSTRAINT chk_loc_volumen_sin_centinela CHECK (
        max_volume_m3 IS NULL
        OR (max_volume_m3 > 0 AND max_volume_m3 NOT IN (999999999, 1000000000))
    );

COMMENT ON COLUMN spatial.locations.max_weight_kg IS
    'Capacidad de peso declarada por el WMS, en kg. NULL cuando el origen escribio un centinela de «sin limite».';

DROP FUNCTION IF EXISTS core.capacity_ceiling(text);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'capacity_ceiling';
    IF v_n <> 0 THEN RAISE EXCEPTION 'core.capacity_ceiling deberia estar eliminada'; END IF;

    -- Los CHECK de 0058 no deben quedar, y los de 0052 sí.
    SELECT count(1) INTO v_n FROM pg_constraint
     WHERE conrelid = 'spatial.locations'::regclass
       AND conname LIKE 'chk_loc_%_plausible';
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % CHECK de plausibilidad', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_constraint
     WHERE conrelid = 'spatial.locations'::regclass
       AND conname LIKE 'chk_loc_%_sin_centinela';
    IF v_n <> 3 THEN RAISE EXCEPTION 'faltan % CHECK enumerativo(s)', 3 - v_n; END IF;

    -- Nada restituible se quedó sin restituir: si aún hay un crudo que 0052
    -- aceptaría, el UPDATE de arriba se dejó una fila.
    SELECT count(1) INTO v_n FROM spatial.locations
     WHERE raw_source ? 'peso_max_crudo'
       AND (raw_source->>'peso_max_crudo')::numeric NOT IN (999999999, 1000000000);
    IF v_n <> 0 THEN
        RAISE EXCEPTION '% fila(s) con crudo restituible sin restituir', v_n;
    END IF;

    -- Y ninguna fila tiene a la vez columna y crudo: eso sería el dato duplicado.
    SELECT count(1) INTO v_n FROM spatial.locations
     WHERE raw_source ? 'peso_max_crudo' AND max_weight_kg IS NOT NULL;
    IF v_n <> 0 THEN
        RAISE EXCEPTION '% fila(s) con peso y peso_max_crudo simultaneos', v_n;
    END IF;

    RAISE NOTICE
        'OK rollback 0058: CHECK enumerativos de 0052 restaurados · '
        'capacity_ceiling eliminada · restitucion completa dentro de lo que 0052 admite · '
        'ningun valor destruido';
END
$$;
