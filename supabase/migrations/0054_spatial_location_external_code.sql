-- ═══════════════════════════════════════════════════════════════════════════
-- 0054_spatial_location_external_code.sql
-- Crea   : external_code · code_form en spatial.locations
-- Depende de: 0052 (atributos), 0053 (normalize_spatial_code)
-- Riesgo : bajo · dos columnas, sin tocar datos
--
-- TRES IDENTIDADES, cada una con un dueño distinto (ADR-013 §14.6):
--
--   code                  dirección NORMALIZADA, uso interno   DANADO-C001-N01-1
--   external_code         `Ubicación` EXACTA del WMS           DAÑADO-C001-N01-1
--   external_location_id  `Id Ubicación` del WMS (ya en 0052)  80DAÑADO0010101
--
-- `external_code` es COLUMNA PROPIA y no `raw_source`: es la identidad que
-- reconcilia con el WMS, necesita índice único y tiene que verse en la API.
-- Enterrada en un JSONB sería un dato de segunda.
--
-- CLASIFICACIÓN, medida antes de escribir esto:
--
--   estructurados  29.310 de 29.310  ·  cumplen ^[^-]+-C\d{3}-N\d{2}-\d$
--   opacos                  0        ·  ninguno hoy
--
--   La clasificación existe igualmente, porque el WMS ya demostró que inventa
--   códigos: `DAÑADO` y `PHA LO` traen Ñ y espacio, y las 4 huérfanas del
--   inventario aparecieron sin estar en el catálogo. El día que llegue un código
--   de cinco segmentos se marcará `opaque` y el parser NO se le aplicará, en lugar
--   de devolver basura en silencio.
--
-- ⚠ Un CHECK impide declarar `structured` una fila que no cumpla el patrón: la
--   etiqueta no puede mentir. Es la diferencia entre una clasificación y un
--   comentario.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠ EL DEFAULT ES `opaque`, NO `structured`.
--
--   `structured` es una AFIRMACIÓN sobre la forma del código —dice que rack, cuerpo,
--   nivel y posición significan algo— y una afirmación no puede ser el valor por
--   defecto. El primer intento de esta migración usaba `DEFAULT 'structured'` y
--   falló al añadir el CHECK: la fila `ALM-01-01` del seed no cumple el patrón de
--   cuatro segmentos, así que el default la convertía en una mentira.
--
--   Con `opaque` por defecto, una fila que no declara su forma no reclama nada. El
--   importador la declara `structured` cuando lo ha comprobado.
ALTER TABLE spatial.locations
    ADD COLUMN external_code varchar(60) NULL,
    ADD COLUMN code_form     varchar(12) NOT NULL DEFAULT 'opaque';

-- Las filas existentes se clasifican por lo que SON, no por un default: solo las
-- que cumplen el patrón y tienen la dirección completa pasan a `structured`.
UPDATE spatial.locations
   SET code_form = 'structured'
 WHERE code ~ '^[A-Z0-9][A-Z0-9._]*-C[0-9]{3}-N[0-9]{2}-[0-9]$'
   AND logical_column IS NOT NULL
   AND logical_level IS NOT NULL
   AND logical_position IS NOT NULL;

COMMENT ON COLUMN spatial.locations.external_code IS
    'Ubicacion EXACTA del WMS, con Ñ y espacios si los trae. `code` es su normalizacion. Columna propia y no raw_source porque es la identidad que reconcilia con el WMS (ADR-013 14.6).';
COMMENT ON COLUMN spatial.locations.code_form IS
    'structured = cumple <ref>-C###-N##-P y rack/cuerpo/nivel/posicion significan algo. opaque = el parser NO se aplica. Medido: 29.310 structured, 0 opaque.';

ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_code_form CHECK (code_form IN ('structured', 'opaque')),

    -- La etiqueta no puede mentir: si dice `structured`, el codigo lo cumple.
    ADD CONSTRAINT chk_loc_form_coherente CHECK (
        code_form <> 'structured'
        OR code ~ '^[A-Z0-9][A-Z0-9._]*-C[0-9]{3}-N[0-9]{2}-[0-9]$'
    ),

    -- `code` DEBE ser la normalizacion de `external_code`. Impide que las dos
    -- identidades divirjan sin que nadie lo note.
    ADD CONSTRAINT chk_loc_code_normalizado CHECK (
        external_code IS NULL
        OR code = core.normalize_spatial_code(external_code)
    ),

    -- Una ubicacion estructurada SIN nivel o SIN posicion no tiene direccion: el
    -- codigo afirma un hueco concreto y las columnas no lo respaldan.
    ADD CONSTRAINT chk_loc_structured_completa CHECK (
        code_form <> 'structured'
        OR (logical_column IS NOT NULL
            AND logical_level IS NOT NULL
            AND logical_position IS NOT NULL)
    );

-- El patrón de `code` se amplía para admitir el guion bajo que produce la
-- normalización de `PHA LO`.
ALTER TABLE spatial.locations DROP CONSTRAINT chk_loc_code;
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_code CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$');

-- Rangos laxos a propósito (ADR-013 §14.5): protegen de basura sin exigir una
-- migración el día que aparezca una tercera posición o un nivel 12.
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_nivel_rango CHECK (
        logical_level IS NULL OR logical_level BETWEEN 1 AND 99
    ),
    ADD CONSTRAINT chk_loc_posicion_rango CHECK (
        logical_position IS NULL OR logical_position BETWEEN 1 AND 9
    );

CREATE UNIQUE INDEX uq_loc_external_code ON spatial.locations
    (tenant_id, warehouse_id, external_code)
    WHERE external_code IS NOT NULL AND deleted_at IS NULL;

-- La clave natural de la hoja: un hueco por (cuerpo, nivel, posición).
CREATE UNIQUE INDEX uq_loc_direccion ON spatial.locations
    (node_id, logical_level, logical_position)
    WHERE logical_level IS NOT NULL AND logical_position IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_loc_form ON spatial.locations (tenant_id, warehouse_id, code_form)
    WHERE deleted_at IS NULL;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_n int; v_rech boolean; v_loc uuid; v_node uuid;
    v_t uuid; v_wh uuid;
    -- Valores originales de la fila de prueba, para restaurarla tal cual.
    v_code_orig varchar(30); v_form_orig varchar(12);
    v_col_orig smallint; v_niv_orig integer; v_pos_orig smallint;
BEGIN
    SELECT count(1) INTO v_n FROM pg_attribute a
     WHERE a.attrelid = 'spatial.locations'::regclass AND NOT a.attisdropped
       AND a.attname IN ('external_code', 'code_form');
    IF v_n <> 2 THEN RAISE EXCEPTION 'faltan columnas de 0054'; END IF;

    -- Clasificación por lo que las filas SON. `ALM-01-01` del seed no cumple el
    -- patrón de cuatro segmentos, así que debe quedar `opaque`.
    SELECT count(1) INTO v_n FROM spatial.locations WHERE code_form = 'structured';
    RAISE NOTICE 'filas structured: %  ·  opaque: %',
        v_n, (SELECT count(1) FROM spatial.locations WHERE code_form = 'opaque');
    IF EXISTS (SELECT 1 FROM spatial.locations
                WHERE code_form = 'structured'
                  AND code !~ '^[A-Z0-9][A-Z0-9._]*-C[0-9]{3}-N[0-9]{2}-[0-9]$') THEN
        RAISE EXCEPTION 'alguna fila se declara structured sin cumplir el patron';
    END IF;

    -- ⚠ `ORDER BY` y captura de los valores ORIGINALES. El primer intento usaba
    --   `LIMIT 1` sin orden y restauraba un literal `'ALM-01-01'`: al reaplicar
    --   eligió la otra fila y colisionó con el índice único. Un bloque de
    --   verificación que no es idempotente rompe la reaplicación.
    SELECT l.id, l.node_id, l.tenant_id, l.warehouse_id,
           l.code, l.code_form, l.logical_column, l.logical_level, l.logical_position
      INTO v_loc, v_node, v_t, v_wh,
           v_code_orig, v_form_orig, v_col_orig, v_niv_orig, v_pos_orig
      FROM spatial.locations l ORDER BY l.id LIMIT 1;
    IF v_loc IS NULL THEN
        RAISE WARNING 'sin ubicaciones: las pruebas no corrieron';
        RAISE NOTICE 'OK 0054 PARCIAL: 2 columnas, 6 CHECK, 3 indices';
        RETURN;
    END IF;

    -- 1 · `structured` con un código que no cumple el patrón se rechaza
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET code = 'SIN.PATRON', code_form = 'structured'
         WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'se acepto structured con un codigo que no cumple el patron';
    END IF;

    -- 2 · el mismo código como `opaque` SI se acepta: es para lo que existe
    UPDATE spatial.locations
       SET code = 'SIN.PATRON', code_form = 'opaque',
           logical_column = NULL, logical_level = NULL, logical_position = NULL
     WHERE id = v_loc;
    RAISE NOTICE 'un codigo no conforme como opaque: aceptado';

    -- 3 · `structured` sin nivel ni posición se rechaza
    v_rech := false;
    BEGIN
        UPDATE spatial.locations
           SET code = 'RCL07-C018-N05-2', code_form = 'structured',
               logical_column = 18, logical_level = NULL, logical_position = 2
         WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto structured sin logical_level'; END IF;

    -- 4 · completa SI se acepta
    UPDATE spatial.locations
       SET code = 'RCL07-C018-N05-2', code_form = 'structured',
           logical_column = 18, logical_level = 5, logical_position = 2
     WHERE id = v_loc;

    -- 5 · las dos identidades no pueden divergir
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET external_code = 'OTRA-C001-N01-1' WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'se acepto un external_code cuya normalizacion no es code';
    END IF;

    -- 6 · EL CASO REAL: PHA LO. `code` normalizado, `external_code` exacto.
    UPDATE spatial.locations
       SET code = 'PHA_LO-C001-N01-1', external_code = 'PHA LO-C001-N01-1',
           logical_column = 1, logical_level = 1, logical_position = 1
     WHERE id = v_loc;
    IF (SELECT external_code FROM spatial.locations WHERE id = v_loc)
       <> 'PHA LO-C001-N01-1' THEN
        RAISE EXCEPTION 'el external_code de PHA LO no se conservo con su espacio';
    END IF;
    IF (SELECT code FROM spatial.locations WHERE id = v_loc) <> 'PHA_LO-C001-N01-1' THEN
        RAISE EXCEPTION 'el code normalizado de PHA LO no es el esperado';
    END IF;
    -- Y sigue teniendo 4 segmentos: es la razon de usar `_` y no `-`.
    IF array_length(string_to_array(
           (SELECT code FROM spatial.locations WHERE id = v_loc), '-'), 1) <> 4 THEN
        RAISE EXCEPTION 'el code de PHA LO no tiene 4 segmentos';
    END IF;

    -- 7 · DAÑADO
    UPDATE spatial.locations
       SET code = 'DANADO-C001-N01-1', external_code = 'DAÑADO-C001-N01-1'
     WHERE id = v_loc;
    IF (SELECT external_code FROM spatial.locations WHERE id = v_loc)
       <> 'DAÑADO-C001-N01-1' THEN
        RAISE EXCEPTION 'la Ñ de DAÑADO no se conservo en external_code';
    END IF;

    -- 8 · rangos
    v_rech := false;
    BEGIN UPDATE spatial.locations SET logical_position = 10 WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true; END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto logical_position = 10'; END IF;

    -- Y el 3 SI: es la razon de BETWEEN 1 AND 9 en lugar de IN (1,2)
    UPDATE spatial.locations SET logical_position = 3 WHERE id = v_loc;
    UPDATE spatial.locations SET logical_position = 1 WHERE id = v_loc;

    v_rech := false;
    BEGIN UPDATE spatial.locations SET logical_level = 100 WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true; END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto logical_level = 100'; END IF;
    UPDATE spatial.locations SET logical_level = 12 WHERE id = v_loc;

    -- Restaurar la fila EXACTAMENTE como estaba, con los valores capturados al
    -- principio. Es lo que hace el bloque idempotente y la reaplicación posible.
    UPDATE spatial.locations
       SET code = v_code_orig, external_code = NULL, code_form = v_form_orig,
           logical_column = v_col_orig, logical_level = v_niv_orig,
           logical_position = v_pos_orig
     WHERE id = v_loc;

    IF (SELECT code FROM spatial.locations WHERE id = v_loc) <> v_code_orig THEN
        RAISE EXCEPTION 'la fila de prueba no volvio a su codigo original %', v_code_orig;
    END IF;

    RAISE NOTICE
        'OK 0054: external_code y code_form · 6 CHECK nuevos · 3 indices · '
        '8 pruebas vivas: structured no puede mentir, opaque acepta lo no conforme, '
        'structured exige nivel y posicion, las identidades no divergen, '
        'PHA LO y DANADO conservan su external_code exacto con 4 segmentos, '
        'posicion 10 y nivel 100 rechazados pero 3 y 12 aceptados';
END
$$;
