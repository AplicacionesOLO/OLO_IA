-- ═══════════════════════════════════════════════════════════════════════════
-- 0058_spatial_capacity_plausibility.sql
-- Modifica : spatial.locations · sustituye la ENUMERACIÓN de centinelas de
--            capacidad por un TECHO DE PLAUSIBILIDAD
-- Depende de: 0052 (columnas de capacidad y sus CHECK)
-- Riesgo   : medio · reclasifica 50 filas ya importadas
--
-- ── Por qué existe ─────────────────────────────────────────────────────────
--
-- 0052 prohibió `999999999` y `1000000000`. La importación real del catálogo
-- demostró que esa lista es incompleta, y que serlo es inevitable:
--
--   valores medidos en «Peso Máximo» (ReporteUbicaciones.xlsx, 29.310 filas,
--   sha256 1622d4167fea…)
--
--          300 kg   1.505 ubicaciones ┐
--        1.300 kg     743 ubicaciones │ capacidades REALES · 2.341 ubicaciones
--        1.800 kg      91 ubicaciones │ en cuerpos con 1..9 posiciones
--        2.000 kg       2 ubicaciones ┘
--   ────────────── ↑ nada entre 2.000 y 100.000: el hueco ↓ ─────────────────
--      100.000 kg       9 ubicaciones ┐
--    1.000.000 kg       3 ubicaciones │ «SIN LÍMITE» · 26.244 ubicaciones
--    9.999.999 kg      16 ubicaciones │ escrito a mano con OCHO grafías
--   10.000.000 kg       2 ubicaciones │ distintas de la misma intención
--   99.999.999 kg      17 ubicaciones │
--  100.000.000 kg       3 ubicaciones │ 0052 solo prohibía las dos primeras
--  999.999.999 kg  25.806 ubicaciones │ de esta lista por su valor exacto ←──┐
-- 1.000.000.000 kg     388 ubicaciones ┘ las otras SEIS entraron enteras ────┘
--
--   (y 727 ubicaciones sin dato alguno de capacidad)
--
-- La lista enumerada de 0052 no era «casi correcta»: dejó pasar seis grafías y
-- la séptima llegará con el siguiente archivo. Lo que separa los dos grupos no
-- es un valor concreto, es un ORDEN DE MAGNITUD, y eso sí se puede expresar
-- como invariante.
--
-- ── Efecto secundario que vale más que la corrección ───────────────────────
--
-- Con la lista enumerada, «el WMS declaró ilimitado» y «el WMS no dijo nada»
-- acababan los dos en NULL, indistinguibles. Al conservar el crudo, las 26.244
-- del primer caso y las 727 del segundo dejan de confundirse: son estados
-- operativos distintos —una ubicación sin límite declarado se puede usar; una
-- sin dato hay que ir a medirla—. La distinción no se inventa aquí, ya estaba en
-- el archivo; lo que faltaba era no destruirla.
--
-- ── El techo, y por qué 50.000 kg ──────────────────────────────────────────
--
-- Una ubicación de almacenaje es una posición de pallet, un hueco de estante o
-- una casilla de suelo. El nivel de una estantería de carga pesada admite del
-- orden de 3.000–4.500 kg; 50.000 kg en UNA ubicación no es un almacén, es un
-- puente grúa. El techo se pone en 50 toneladas por dos razones:
--
--   · Es físicamente defendible con holgura de más de un orden de magnitud
--     sobre el máximo real observado (2.000 kg).
--   · Cae en el HUECO MEDIDO entre 2.000 y 100.000, así que no puede
--     reclasificar ningún dato real presente. La frontera no se elige sobre un
--     valor, se elige sobre un vacío.
--
-- No se borra el dato: el valor original pasa a `raw_source.peso_max_crudo`
-- antes de anularse. Una capacidad implausible no es información sobre la
-- ubicación, pero sí es información sobre el WMS de origen.
--
-- El mismo techo se aplica a `max_units` y `max_volume_m3` por coherencia: el
-- catálogo actual no los trae, y dejarlos con la lista enumerada sería
-- conservar el defecto justo donde todavía no ha dado la cara.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · El techo, como función, para que el importador y el motor no puedan
--        discrepar. IMMUTABLE porque se usa en un CHECK. ───────────────────
CREATE OR REPLACE FUNCTION core.capacity_ceiling(p_kind text)
RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
    SELECT CASE p_kind
             WHEN 'weight_kg' THEN 50000::numeric      -- 50 t en una ubicación
             WHEN 'units'     THEN 100000::numeric     -- 100.000 piezas en un hueco
             WHEN 'volume_m3' THEN 1000::numeric       -- 1.000 m³ = un edificio
           END
$$;

COMMENT ON FUNCTION core.capacity_ceiling(text) IS
    'Techo de plausibilidad por tipo de capacidad. Existe para que el importador y los CHECK usen EL MISMO numero: dos umbrales copiados divergen. Devuelve NULL para un tipo desconocido, lo que hace fallar el CHECK que lo use en lugar de aceptarlo en silencio.';


-- ── 2 · Preservar el valor original ANTES de anularlo ──────────────────────
DO $$
DECLARE v_afectadas int;
BEGIN
    WITH implausibles AS (
        SELECT id, max_weight_kg, max_units, max_volume_m3
          FROM spatial.locations
         WHERE max_weight_kg >= core.capacity_ceiling('weight_kg')
            OR max_units     >= core.capacity_ceiling('units')
            OR max_volume_m3 >= core.capacity_ceiling('volume_m3')
    )
    UPDATE spatial.locations l
       SET raw_source = coalesce(l.raw_source, '{}'::jsonb)
                        || jsonb_strip_nulls(jsonb_build_object(
                             'peso_max_crudo',    i.max_weight_kg,
                             'unidades_max_crudo', i.max_units,
                             'volumen_max_crudo',  i.max_volume_m3,
                             'capacidad_anulada_por', 'implausible_0058')),
           max_weight_kg = CASE WHEN l.max_weight_kg >= core.capacity_ceiling('weight_kg')
                                THEN NULL ELSE l.max_weight_kg END,
           max_units     = CASE WHEN l.max_units >= core.capacity_ceiling('units')
                                THEN NULL ELSE l.max_units END,
           max_volume_m3 = CASE WHEN l.max_volume_m3 >= core.capacity_ceiling('volume_m3')
                                THEN NULL ELSE l.max_volume_m3 END,
           updated_at = now()
      FROM implausibles i
     WHERE i.id = l.id;

    GET DIAGNOSTICS v_afectadas = ROW_COUNT;
    RAISE NOTICE '0058: % ubicacion(es) con capacidad implausible reclasificadas '
                 '(valor original conservado en raw_source)', v_afectadas;
END
$$;


-- ── 3 · Sustituir la enumeración por el techo ──────────────────────────────
--
-- Se conserva `> 0`: una capacidad de cero no es «sin límite», es la ausencia
-- de dato escrita con un número, y `NULL` ya expresa eso.
ALTER TABLE spatial.locations
    DROP CONSTRAINT chk_loc_peso_sin_centinela,
    DROP CONSTRAINT chk_loc_unidades_sin_centinela,
    DROP CONSTRAINT chk_loc_volumen_sin_centinela;

ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_peso_plausible CHECK (
        max_weight_kg IS NULL
        OR (max_weight_kg > 0 AND max_weight_kg < core.capacity_ceiling('weight_kg'))
    ),
    ADD CONSTRAINT chk_loc_unidades_plausible CHECK (
        max_units IS NULL
        OR (max_units > 0 AND max_units < core.capacity_ceiling('units'))
    ),
    ADD CONSTRAINT chk_loc_volumen_plausible CHECK (
        max_volume_m3 IS NULL
        OR (max_volume_m3 > 0 AND max_volume_m3 < core.capacity_ceiling('volume_m3'))
    );

COMMENT ON COLUMN spatial.locations.max_weight_kg IS
    'Capacidad de peso declarada por el WMS, en kg, siempre por debajo de core.capacity_ceiling(''weight_kg''). NULL por DOS motivos distintos que raw_source separa: si existe raw_source.peso_max_crudo el origen declaro «sin limite» (OCHO grafias medidas: 1e5, 1e6, 9999999, 1e7, 99999999, 1e8, 999999999, 1e9); si no existe, el origen no dijo nada y hay que ir a medir la ubicacion.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_n         int;
    v_rech      boolean;
    v_loc       uuid;
    v_peso_orig numeric;
    v_crudo     jsonb;
BEGIN
    -- 4.1 · La función devuelve los tres techos y NULL para lo desconocido.
    IF core.capacity_ceiling('weight_kg') <> 50000
       OR core.capacity_ceiling('units') <> 100000
       OR core.capacity_ceiling('volume_m3') <> 1000 THEN
        RAISE EXCEPTION 'capacity_ceiling devuelve techos inesperados';
    END IF;
    IF core.capacity_ceiling('inventado') IS NOT NULL THEN
        RAISE EXCEPTION 'capacity_ceiling debe devolver NULL para un tipo desconocido';
    END IF;

    -- 4.2 · No queda ninguna capacidad implausible en la tabla.
    SELECT count(1) INTO v_n FROM spatial.locations
     WHERE max_weight_kg >= 50000 OR max_units >= 100000 OR max_volume_m3 >= 1000;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'quedan % fila(s) con capacidad implausible', v_n;
    END IF;

    -- 4.3 · Las que se anularon conservan el original. Si no hay ninguna
    --       (base recién sembrada, sin importar), no se finge una comprobación.
    SELECT count(1) INTO v_n FROM spatial.locations
     WHERE raw_source ? 'peso_max_crudo';
    IF v_n > 0 THEN
        SELECT count(1) INTO v_n FROM spatial.locations
         WHERE raw_source ? 'peso_max_crudo' AND max_weight_kg IS NOT NULL;
        IF v_n <> 0 THEN
            RAISE EXCEPTION '% fila(s) tienen peso_max_crudo y peso a la vez', v_n;
        END IF;
        RAISE NOTICE '0058: originales conservados y verificados en raw_source';
    ELSE
        RAISE NOTICE '0058: no habia capacidades implausibles que reclasificar';
    END IF;

    -- 4.4 · El CHECK rechaza el techo y todo lo que esté por encima, sobre una
    --       fila REAL. Se captura y restaura el valor original: un `LIMIT 1`
    --       sin `ORDER BY` con un valor recodificado a mano fue exactamente el
    --       defecto que hizo fallar la reaplicación de 0054.
    SELECT id, max_weight_kg INTO v_loc, v_peso_orig
      FROM spatial.locations WHERE deleted_at IS NULL ORDER BY code LIMIT 1;

    IF v_loc IS NOT NULL THEN
        SELECT raw_source INTO v_crudo FROM spatial.locations WHERE id = v_loc;

        FOREACH v_n IN ARRAY ARRAY[50000, 99999999, 100000000] LOOP
            v_rech := false;
            BEGIN
                UPDATE spatial.locations SET max_weight_kg = v_n WHERE id = v_loc;
            EXCEPTION WHEN check_violation THEN v_rech := true;
            END;
            IF NOT v_rech THEN
                RAISE EXCEPTION 'se acepto max_weight_kg = % (>= techo)', v_n;
            END IF;
        END LOOP;

        -- Y acepta una capacidad real de estantería.
        UPDATE spatial.locations SET max_weight_kg = 1300 WHERE id = v_loc;
        IF (SELECT max_weight_kg FROM spatial.locations WHERE id = v_loc) <> 1300 THEN
            RAISE EXCEPTION 'se rechazo una capacidad real de 1300 kg';
        END IF;

        -- Restaurar EXACTAMENTE lo que había.
        UPDATE spatial.locations
           SET max_weight_kg = v_peso_orig, raw_source = v_crudo, updated_at = now()
         WHERE id = v_loc;
        IF (SELECT coalesce(max_weight_kg, -1) FROM spatial.locations WHERE id = v_loc)
           <> coalesce(v_peso_orig, -1) THEN
            RAISE EXCEPTION 'no se restauro el peso original de la fila de prueba';
        END IF;
    END IF;

    -- 4.5 · Cero sigue prohibido: no es «sin límite», es un dato ausente.
    IF v_loc IS NOT NULL THEN
        v_rech := false;
        BEGIN
            UPDATE spatial.locations SET max_weight_kg = 0 WHERE id = v_loc;
        EXCEPTION WHEN check_violation THEN v_rech := true;
        END;
        IF NOT v_rech THEN RAISE EXCEPTION 'se acepto max_weight_kg = 0'; END IF;
    END IF;

    -- 4.6 · Los CHECK viejos ya no existen y los nuevos sí.
    SELECT count(1) INTO v_n FROM pg_constraint
     WHERE conrelid = 'spatial.locations'::regclass
       AND conname IN ('chk_loc_peso_sin_centinela', 'chk_loc_unidades_sin_centinela',
                       'chk_loc_volumen_sin_centinela');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % CHECK enumerativo(s)', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_constraint
     WHERE conrelid = 'spatial.locations'::regclass
       AND conname IN ('chk_loc_peso_plausible', 'chk_loc_unidades_plausible',
                       'chk_loc_volumen_plausible');
    IF v_n <> 3 THEN RAISE EXCEPTION 'faltan % CHECK de plausibilidad', 3 - v_n; END IF;

    RAISE NOTICE
        'OK 0058: techo de plausibilidad en lugar de lista de centinelas · '
        'core.capacity_ceiling() como unica fuente del umbral · '
        'valores originales conservados en raw_source · '
        '50000/99999999/100000000 y 0 rechazados, 1300 aceptado';
END
$$;
