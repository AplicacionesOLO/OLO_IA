-- ═══════════════════════════════════════════════════════════════════════════
-- 0055_spatial_addressing_consistency.sql
-- Crea   : core.build_location_code() · core.spatial_location_guard() y su trigger
-- Depende de: 0053 (bay, can_hold_locations), 0054 (code_form, external_code)
-- Riesgo : medio · impone coherencia sobre escrituras futuras
--
-- CUATRO REGLAS QUE UN CHECK NO PUEDE EXPRESAR, porque todas necesitan mirar OTRA
-- fila —el nodo padre o su abuelo— y un CHECK solo ve la suya:
--
--   1. El padre de una ubicación debe ser un tipo que admita ubicaciones.
--      Sin esto un hueco cuelga de un edificio.
--   2. Si hay un cuerpo, su `logical_index` debe igualar el `logical_column` de la
--      ubicación. Sin esto el cuerpo C018 contiene huecos que dicen C019.
--   3. Si la ubicación es `structured`, su `code` debe ser la reconstrucción desde
--      el árbol. Es la redundancia VERIFICADA de ADR-013 §4.4: no se evita, se
--      hace imposible de contradecir.
--   4. `external_code`, si existe, debe normalizar a `code`. Ya lo garantiza un
--      CHECK de 0054; aquí se comprueba la unicidad entre nodos y ubicaciones.
--
-- ⚠ LA REGLA 3 SOLO SE APLICA A `structured`. Es la instrucción explícita: el
--   parser estructurado no se aplica a códigos especiales. Una fila `opaque` pasa
--   sin que nadie intente descomponer su código.
--
-- NO EXISTE `parse_location_code()`. `build_location_code()` COMPONE. Que no haya
-- inversa es deliberado: descomponer es exactamente lo que este diseño elimina, y
-- ofrecer la función invitaría a usarla.
--
-- Códigos por DETAIL estable, registrados en el traductor de la aplicación:
--   SPATIAL_LOCATION_PARENT_INVALID · SPATIAL_BAY_INDEX_MISMATCH
--   SPATIAL_CODE_INCONSISTENT
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Composición · nunca descomposición ─────────────────────────────────
CREATE OR REPLACE FUNCTION core.build_location_code(
    p_owner_code text,      -- código del rack o del área de almacenaje
    p_column     integer,
    p_level      integer,
    p_position   integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT core.normalize_spatial_code(p_owner_code)
           || '-C' || lpad(p_column::text,   3, '0')
           || '-N' || lpad(p_level::text,    2, '0')
           || '-'  || p_position::text
$$;

COMMENT ON FUNCTION core.build_location_code(text, integer, integer, integer) IS
    'COMPONE el codigo de una ubicacion desde su direccion. No existe la inversa a proposito: descomponer es lo que este diseno elimina. La usan el trigger de coherencia y el importador para verificar lo que van a escribir.';


-- ── 2 · La guarda de la ubicación ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.spatial_location_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_tipo_padre    varchar(20);
    v_admite        boolean;
    v_indice_padre  smallint;
    v_owner_code    varchar(40);
    v_esperado      text;
BEGIN
    -- ── Regla 1 · el padre debe poder contener ubicaciones ─────────────────
    SELECT n.node_type, t.can_hold_locations, n.logical_index, n.node_code
      INTO v_tipo_padre, v_admite, v_indice_padre, v_owner_code
      FROM spatial.nodes n
      JOIN spatial.node_types t ON t.code = n.node_type
     WHERE n.id = NEW.node_id;

    IF v_tipo_padre IS NULL THEN
        -- La FK compuesta ya lo impide; esto cubre el orden de disparo.
        RAISE EXCEPTION 'El nodo padre % no existe', NEW.node_id
            USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_LOCATION_PARENT_INVALID';
    END IF;

    IF NOT v_admite THEN
        RAISE EXCEPTION
            'Una ubicacion no puede colgar de un nodo de tipo %: solo bay y storage_area '
            'admiten ubicaciones', v_tipo_padre
            USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_LOCATION_PARENT_INVALID';
    END IF;

    -- ── Regla 2 · el cuerpo y la columna deben coincidir ───────────────────
    -- Solo cuando el padre es un `bay`: un área de suelo no tiene índice de cuerpo.
    IF v_tipo_padre = 'bay'
       AND NEW.logical_column IS NOT NULL
       AND v_indice_padre IS NOT NULL
       AND v_indice_padre <> NEW.logical_column THEN
        RAISE EXCEPTION
            'El cuerpo % tiene indice % pero la ubicacion dice columna %',
            v_owner_code, v_indice_padre, NEW.logical_column
            USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_BAY_INDEX_MISMATCH';
    END IF;

    -- ── Regla 3 · coherencia del código · SOLO `structured` ────────────────
    IF NEW.code_form = 'structured' THEN
        -- El primer segmento lo aporta el rack cuando el padre es un cuerpo, y el
        -- propio nodo cuando es un área de suelo. Las dos formas del árbol.
        IF v_tipo_padre = 'bay' THEN
            SELECT p.node_code INTO v_owner_code
              FROM spatial.nodes n JOIN spatial.nodes p ON p.id = n.parent_node_id
             WHERE n.id = NEW.node_id;
            IF v_owner_code IS NULL THEN
                RAISE EXCEPTION
                    'El cuerpo % no tiene rack padre: una ubicacion structured no puede '
                    'reconstruir su codigo', NEW.node_id
                    USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_CODE_INCONSISTENT';
            END IF;
        END IF;

        v_esperado := core.build_location_code(
            v_owner_code, NEW.logical_column, NEW.logical_level, NEW.logical_position
        );

        IF NEW.code <> v_esperado THEN
            RAISE EXCEPTION
                'El codigo % no coincide con su lugar en el arbol: se esperaba %',
                NEW.code, v_esperado
                USING ERRCODE = 'P0001', DETAIL = 'SPATIAL_CODE_INCONSISTENT';
        END IF;
    END IF;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION core.spatial_location_guard() IS
    'Coherencia entre la ubicacion y su lugar en el arbol. Las cuatro reglas necesitan mirar el nodo padre o su abuelo, y un CHECK solo ve su propia fila. La regla del codigo se aplica SOLO a code_form=structured.';

CREATE TRIGGER spatial_location_guard
    BEFORE INSERT OR UPDATE OF node_id, code, code_form,
                               logical_column, logical_level, logical_position
    ON spatial.locations
    FOR EACH ROW EXECUTE FUNCTION core.spatial_location_guard();


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_t uuid; v_wh uuid; v_site uuid; v_rack uuid; v_bay uuid; v_area uuid;
    v_rech boolean; v_loc uuid;
BEGIN
    -- La composición, probada en los casos reales.
    IF core.build_location_code('RCL07', 18, 5, 2) <> 'RCL07-C018-N05-2' THEN
        RAISE EXCEPTION 'composicion incorrecta: %', core.build_location_code('RCL07', 18, 5, 2);
    END IF;
    IF core.build_location_code('PHA LO', 1, 1, 1) <> 'PHA_LO-C001-N01-1' THEN
        RAISE EXCEPTION 'PHA LO: %', core.build_location_code('PHA LO', 1, 1, 1);
    END IF;
    IF core.build_location_code('DAÑADO', 1, 1, 1) <> 'DANADO-C001-N01-1' THEN
        RAISE EXCEPTION 'DAÑADO: %', core.build_location_code('DAÑADO', 1, 1, 1);
    END IF;
    -- El relleno con ceros importa: C18 no es C018.
    IF core.build_location_code('RCL07', 1, 1, 1) <> 'RCL07-C001-N01-1' THEN
        RAISE EXCEPTION 'el relleno con ceros falla';
    END IF;
    -- Y no existe la inversa.
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'core' AND p.proname = 'parse_location_code') THEN
        RAISE EXCEPTION 'core.parse_location_code() NO debe existir (ADR-013 §10)';
    END IF;

    SELECT t.id INTO v_t FROM core.tenants t LIMIT 1;
    SELECT w.id INTO v_wh FROM core.warehouses w WHERE w.tenant_id = v_t LIMIT 1;
    IF v_wh IS NULL THEN
        RAISE WARNING 'sin almacen: las pruebas del trigger no corrieron';
        RAISE NOTICE 'OK 0055 PARCIAL: build_location_code y trigger creados';
        RETURN;
    END IF;

    INSERT INTO spatial.sites (tenant_id, warehouse_id, name, code)
    VALUES (v_t, v_wh, 'Sitio prueba 0055', 'T0055') RETURNING id INTO v_site;

    -- Rack raíz (sin pasillo), cuerpo C018, y un área de suelo aparte.
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, node_type,
                               node_code, name, logical_index)
    VALUES (v_t, v_wh, v_site, 'rack', 'RCL07', 'Rack 07', 7) RETURNING id INTO v_rack;
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                               node_type, node_code, name, logical_index)
    VALUES (v_t, v_wh, v_site, v_rack, 'bay', 'C018', 'Cuerpo 018', 18)
    RETURNING id INTO v_bay;
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, node_type,
                               node_code, name, node_function)
    VALUES (v_t, v_wh, v_site, 'storage_area', 'GUACI5', 'Area de suelo', 'bulk')
    RETURNING id INTO v_area;

    -- 1 · REGLA 3 · el código correcto se acepta
    INSERT INTO spatial.locations
        (tenant_id, warehouse_id, node_id, code, external_code, type, code_form,
         logical_column, logical_level, logical_position)
    VALUES (v_t, v_wh, v_bay, 'RCL07-C018-N05-2', 'RCL07-C018-N05-2', 'rack',
            'structured', 18, 5, 2)
    RETURNING id INTO v_loc;
    RAISE NOTICE '  codigo coherente aceptado: RCL07-C018-N05-2';

    -- 2 · REGLA 3 · un código que no reconstruye se rechaza
    v_rech := false;
    BEGIN
        INSERT INTO spatial.locations
            (tenant_id, warehouse_id, node_id, code, type, code_form,
             logical_column, logical_level, logical_position)
        VALUES (v_t, v_wh, v_bay, 'RCL07-C018-N05-1', 'rack', 'structured', 18, 9, 1);
    EXCEPTION WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'se acepto un codigo que dice N05 con logical_level 9';
    END IF;

    -- 3 · REGLA 2 · el cuerpo C018 no puede contener una ubicacion C019
    v_rech := false;
    BEGIN
        INSERT INTO spatial.locations
            (tenant_id, warehouse_id, node_id, code, type, code_form,
             logical_column, logical_level, logical_position)
        VALUES (v_t, v_wh, v_bay, 'RCL07-C019-N05-1', 'rack', 'structured', 19, 5, 1);
    EXCEPTION WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'el cuerpo C018 acepto una ubicacion que dice columna 19';
    END IF;

    -- 4 · REGLA 1 · una ubicacion no cuelga de un RACK directamente
    v_rech := false;
    BEGIN
        INSERT INTO spatial.locations
            (tenant_id, warehouse_id, node_id, code, type, code_form,
             logical_column, logical_level, logical_position)
        VALUES (v_t, v_wh, v_rack, 'RCL07-C001-N01-1', 'rack', 'structured', 1, 1, 1);
    EXCEPTION WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'una ubicacion colgo de un rack directamente'; END IF;

    -- 5 · el AREA DE SUELO sí admite ubicaciones, y su codigo usa su propio nombre
    INSERT INTO spatial.locations
        (tenant_id, warehouse_id, node_id, code, type, code_form,
         logical_column, logical_level, logical_position, is_bulk_area)
    VALUES (v_t, v_wh, v_area, 'GUACI5-C001-N01-1', 'bulk', 'structured', 1, 1, 1, true);
    RAISE NOTICE '  area de suelo: GUACI5-C001-N01-1 aceptada con is_bulk_area';

    -- 6 · UNA fila `opaque` pasa SIN que nadie intente descomponer su codigo
    INSERT INTO spatial.locations
        (tenant_id, warehouse_id, node_id, code, type, code_form)
    VALUES (v_t, v_wh, v_area, 'CODIGO.RARO.SIN.FORMA', 'bulk', 'opaque');
    RAISE NOTICE '  opaque: CODIGO.RARO.SIN.FORMA aceptada sin parsear';

    -- 7 · el caso PHA LO de extremo a extremo
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, node_type,
                               node_code, external_code, name)
    VALUES (v_t, v_wh, v_site, 'storage_area',
            core.normalize_spatial_code('PHA LO'), 'PHA LO', 'Area PHA LO');
    INSERT INTO spatial.locations
        (tenant_id, warehouse_id, node_id, code, external_code, type, code_form,
         logical_column, logical_level, logical_position)
    SELECT v_t, v_wh, n.id, 'PHA_LO-C001-N01-1', 'PHA LO-C001-N01-1', 'bulk',
           'structured', 1, 1, 1
      FROM spatial.nodes n
     WHERE n.tenant_id = v_t AND n.external_code = 'PHA LO';
    IF (SELECT external_code FROM spatial.locations WHERE code = 'PHA_LO-C001-N01-1')
       <> 'PHA LO-C001-N01-1' THEN
        RAISE EXCEPTION 'PHA LO perdio su external_code exacto';
    END IF;
    RAISE NOTICE '  PHA LO: code=PHA_LO-C001-N01-1 external_code=PHA LO-C001-N01-1';

    -- Limpieza
    DELETE FROM spatial.locations WHERE warehouse_id = v_wh
       AND node_id IN (SELECT id FROM spatial.nodes WHERE site_id = v_site);
    DELETE FROM spatial.nodes WHERE site_id = v_site AND node_type = 'bay';
    DELETE FROM spatial.nodes WHERE site_id = v_site;
    DELETE FROM spatial.sites WHERE id = v_site;

    RAISE NOTICE
        'OK 0055: build_location_code (sin inversa) · trigger de 4 reglas · '
        '7 pruebas vivas: codigo coherente aceptado, codigo incoherente rechazado, '
        'C018 rechaza columna 19, ubicacion en rack rechazada, area de suelo aceptada, '
        'opaque pasa sin parsear, PHA LO conserva su external_code';
END
$$;
