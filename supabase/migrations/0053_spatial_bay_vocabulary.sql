-- ═══════════════════════════════════════════════════════════════════════════
-- 0053_spatial_bay_vocabulary.sql
-- Crea   : node_type `bay` · arista rack→bay · logical_index · external_code en
--          nodes · can_hold_locations · core.normalize_spatial_code()
-- Depende de: 0050 (árbol y catálogos)
-- Riesgo : bajo · amplía vocabulario cerrado, sin tocar datos
--
-- ADR-013 §14.1. `bay` es el cuerpo del rack —`C018`—, el hueco entre dos
-- bastidores. Es un objeto físico con geometría propia, y por eso es un nodo y no
-- una columna: cuando llegue el CAD habrá dónde colgar su malla.
--
-- DOS CORRECCIONES AL PROPIO ADR, ambas por no tener respaldo:
--
--   · NO se crea la arista `site → rack`. `site` NO es un node_type: es una tabla.
--     Un rack sin pasillo es un NODO RAÍZ —`parent_node_id IS NULL`— y el trigger
--     `core.spatial_node_guard()` ya lo admite devolviendo temprano. La arista
--     habría sido imposible de expresar contra un catálogo que no contiene `site`.
--
--   · NO se crea `bay → storage_area`. Ningún dato lo justifica: en las 29.310
--     filas medidas no hay un solo cuerpo subdividido. Añadir una arista «por si
--     acaso» es exactamente lo que la matriz existe para evitar.
--
-- `can_hold_locations` es nuevo y no estaba en el ADR. Lo añado porque sin él una
-- ubicación puede colgar de un `building` o de un `rack` directamente, y la
-- jerarquía que el frontend renderiza deja de estar bien formada. Es dato, no
-- código: dos valores en el catálogo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Normalización determinista de códigos ───────────────────────────────
--
-- ⚠ EL ESPACIO SE CONVIERTE EN `_`, NUNCA EN `-`. El guion es el separador de
--   segmentos: `PHA LO` → `PHA-LO` daría `PHA-LO-C001-N01-1`, CINCO segmentos, y
--   rompería la reconstrucción. Es un error que produce un resultado plausible.
--
-- Sin depender de la extensión `unaccent`: la transliteración es explícita y
-- cerrada, así que es reproducible sin instalar nada.
CREATE OR REPLACE FUNCTION core.normalize_spatial_code(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT regexp_replace(
             translate(
               upper(btrim(coalesce(p_raw, ''))),
               'ÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ ',
               'AAAAAAEEEEIIIIOOOOOUUUUNC_'
             ),
             '[^A-Z0-9._-]', '_', 'g'
           )
$$;

COMMENT ON FUNCTION core.normalize_spatial_code(text) IS
    'Normaliza un codigo espacial: mayusculas, diacriticos transliterados, espacio -> guion bajo. El espacio NUNCA pasa a guion porque el guion separa segmentos. Determinista: la reconstruccion depende de que lo sea.';


-- ── 2 · `bay` entra en el vocabulario cerrado ──────────────────────────────
-- `storage_area` baja a 7 para dejar el 6 al cuerpo: un cuerpo contiene huecos,
-- un área de suelo también, y las dos son el ultimo nivel antes de la ubicación.
UPDATE spatial.node_types SET depth_hint = 7 WHERE code = 'storage_area';

INSERT INTO spatial.node_types (code, display_name, depth_hint, notes) VALUES
    ('bay', 'Cuerpo', 6,
     'Cuerpo del rack: el hueco entre dos bastidores. Es C018 en RCL07-C018-N05-2. '
     'Objeto fisico con geometria propia. Medidos 2.701 en el catalogo.');

-- Qué tipos pueden ser padre de una ubicación. Sin esto, un hueco podria colgar
-- de un edificio.
ALTER TABLE spatial.node_types
    ADD COLUMN can_hold_locations boolean NOT NULL DEFAULT false;

UPDATE spatial.node_types SET can_hold_locations = true
 WHERE code IN ('bay', 'storage_area');

COMMENT ON COLUMN spatial.node_types.can_hold_locations IS
    'Si un nodo de este tipo puede ser padre de una spatial.locations. Solo bay y storage_area: una ubicacion no cuelga de un edificio ni de un rack directamente.';


-- ── 3 · La arista nueva ────────────────────────────────────────────────────
-- `aisle → rack` ya existe desde 0050. Aqui solo falta el cuerpo.
INSERT INTO spatial.node_edges (parent_type, child_type, notes) VALUES
    ('rack', 'bay', 'El cuerpo cuelga del rack. Medido: media de 11 cuerpos por rack RCL, maximo 32.');


-- ── 4 · `logical_index` y `external_code` en los nodos ─────────────────────
ALTER TABLE spatial.nodes
    -- El 18 de `C018` y el 7 de `RCL07`, como entero. Ordena el canvas sin que
    -- nadie parta una cadena.
    ADD COLUMN logical_index smallint    NULL,
    -- El valor EXACTO del WMS. Columna propia y no raw_source: es la identidad que
    -- reconcilia, y necesita indice e ir en la API (ADR-013 §14.6).
    ADD COLUMN external_code varchar(40) NULL;

ALTER TABLE spatial.nodes
    ADD CONSTRAINT chk_node_logical_index CHECK (
        logical_index IS NULL OR logical_index >= 0
    ),
    -- Si hay external_code, `node_code` DEBE ser su normalización. Impide que las
    -- dos identidades divirjan sin que nadie se entere.
    ADD CONSTRAINT chk_node_code_normalizado CHECK (
        external_code IS NULL
        OR node_code = core.normalize_spatial_code(external_code)
    );

COMMENT ON COLUMN spatial.nodes.logical_index IS
    'Indice numerico del codigo: 18 en C018, 7 en RCL07. Para ordenar sin parsear.';
COMMENT ON COLUMN spatial.nodes.external_code IS
    'Codigo EXACTO del WMS, con Ñ y espacios si los trae. node_code es su normalizacion. DAÑADO y PHA LO son los dos casos medidos.';

CREATE INDEX idx_node_logical ON spatial.nodes
    (tenant_id, warehouse_id, node_type, logical_index) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_node_external ON spatial.nodes
    (tenant_id, warehouse_id, external_code)
    WHERE external_code IS NOT NULL AND deleted_at IS NULL;
-- Dos cuerpos con el mismo numero en el mismo rack son imposibles.
CREATE UNIQUE INDEX uq_node_indice_en_padre ON spatial.nodes
    (parent_node_id, node_type, logical_index)
    WHERE parent_node_id IS NOT NULL AND logical_index IS NOT NULL AND deleted_at IS NULL;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_n int; v_rech boolean;
    v_t uuid; v_wh uuid; v_site uuid; v_rack uuid; v_bay uuid;
BEGIN
    SELECT count(1) INTO v_n FROM spatial.node_types;
    IF v_n <> 7 THEN RAISE EXCEPTION 'se esperaban 7 node_types, hay %', v_n; END IF;

    SELECT count(1) INTO v_n FROM spatial.node_types WHERE can_hold_locations;
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'solo bay y storage_area deben admitir ubicaciones, admiten %', v_n;
    END IF;

    SELECT count(1) INTO v_n FROM spatial.node_edges;
    IF v_n <> 13 THEN RAISE EXCEPTION 'se esperaban 13 aristas, hay %', v_n; END IF;

    IF NOT EXISTS (SELECT 1 FROM spatial.node_edges
                    WHERE parent_type = 'rack' AND child_type = 'bay') THEN
        RAISE EXCEPTION 'falta la arista rack->bay';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM spatial.node_edges
                    WHERE parent_type = 'aisle' AND child_type = 'rack') THEN
        RAISE EXCEPTION 'falta la arista aisle->rack (deberia venir de 0050)';
    END IF;
    -- Y las dos que NO deben existir, por no tener respaldo en el dato.
    IF EXISTS (SELECT 1 FROM spatial.node_edges WHERE child_type = 'rack'
                AND parent_type NOT IN ('aisle', 'floor', 'zone', 'building')) THEN
        RAISE EXCEPTION 'hay una arista hacia rack desde un tipo inesperado';
    END IF;
    IF EXISTS (SELECT 1 FROM spatial.node_edges
                WHERE parent_type = 'bay' AND child_type = 'storage_area') THEN
        RAISE EXCEPTION 'bay->storage_area no debe existir: ningun dato la justifica';
    END IF;

    -- ── La normalización, probada en los dos casos reales ──────────────────
    IF core.normalize_spatial_code('DAÑADO') <> 'DANADO' THEN
        RAISE EXCEPTION 'DANADO: la transliteracion dio %', core.normalize_spatial_code('DAÑADO');
    END IF;
    IF core.normalize_spatial_code('PHA LO') <> 'PHA_LO' THEN
        RAISE EXCEPTION 'PHA_LO: el espacio dio %', core.normalize_spatial_code('PHA LO');
    END IF;
    -- ⚠ La comprobación que importa: el espacio NO se convierte en guion, porque
    --   eso añadiría un segmento.
    IF core.normalize_spatial_code('PHA LO') LIKE '%-%' THEN
        RAISE EXCEPTION
            'el espacio se convirtio en guion: PHA-LO-C001-N01-1 tendria 5 segmentos '
            'y la reconstruccion se romperia';
    END IF;
    IF array_length(string_to_array(
           core.normalize_spatial_code('PHA LO') || '-C001-N01-1', '-'), 1) <> 4 THEN
        RAISE EXCEPTION 'el codigo normalizado de PHA LO no tiene 4 segmentos';
    END IF;
    -- Idempotente: normalizar lo ya normalizado no cambia nada.
    IF core.normalize_spatial_code(core.normalize_spatial_code('PHA LO'))
       <> core.normalize_spatial_code('PHA LO') THEN
        RAISE EXCEPTION 'la normalizacion no es idempotente';
    END IF;
    IF core.normalize_spatial_code('RCL07') <> 'RCL07' THEN
        RAISE EXCEPTION 'un codigo ya limpio no debe cambiar';
    END IF;

    -- ── Pruebas de jerarquía con `bay` ────────────────────────────────────
    SELECT t.id INTO v_t FROM core.tenants t LIMIT 1;
    SELECT w.id INTO v_wh FROM core.warehouses w WHERE w.tenant_id = v_t LIMIT 1;
    IF v_wh IS NULL THEN
        RAISE WARNING 'sin almacen: las pruebas de jerarquia no corrieron';
        RAISE NOTICE 'OK 0053 PARCIAL: 7 tipos, 13 aristas, normalizacion probada';
        RETURN;
    END IF;

    INSERT INTO spatial.sites (tenant_id, warehouse_id, name, code)
    VALUES (v_t, v_wh, 'Sitio prueba 0053', 'T0053') RETURNING id INTO v_site;

    -- Un rack SIN pasillo es una RAÍZ. Es el caso de los 347 del catálogo.
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, node_type,
                               node_code, name, logical_index, external_code)
    VALUES (v_t, v_wh, v_site, 'rack', 'RCL07', 'Rack 07', 7, 'RCL07')
    RETURNING id INTO v_rack;

    -- El cuerpo cuelga del rack.
    INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                               node_type, node_code, name, logical_index)
    VALUES (v_t, v_wh, v_site, v_rack, 'bay', 'C018', 'Cuerpo 018', 18)
    RETURNING id INTO v_bay;

    -- 1 · la arista INVERSA se rechaza: un rack no cuelga de un cuerpo
    v_rech := false;
    BEGIN
        INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                                   node_type, node_code, name)
        VALUES (v_t, v_wh, v_site, v_bay, 'rack', 'T0053-X', 'Rack en cuerpo');
    EXCEPTION WHEN sqlstate 'P0001' THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto un rack colgando de un cuerpo'; END IF;

    -- 2 · dos cuerpos con el MISMO indice en el mismo rack son imposibles
    v_rech := false;
    BEGIN
        INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, parent_node_id,
                                   node_type, node_code, name, logical_index)
        VALUES (v_t, v_wh, v_site, v_rack, 'bay', 'C018B', 'Cuerpo duplicado', 18);
    EXCEPTION WHEN unique_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se aceptaron dos cuerpos con logical_index 18'; END IF;

    -- 3 · node_code que NO es la normalizacion de external_code
    v_rech := false;
    BEGIN
        UPDATE spatial.nodes SET external_code = 'DAÑADO' WHERE id = v_rack;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'se acepto un external_code cuya normalizacion no es node_code';
    END IF;

    -- 4 · y el par coherente SI se acepta
    UPDATE spatial.nodes SET node_code = 'DANADO', external_code = 'DAÑADO' WHERE id = v_rack;
    IF (SELECT external_code FROM spatial.nodes WHERE id = v_rack) <> 'DAÑADO' THEN
        RAISE EXCEPTION 'el external_code exacto no se conservo';
    END IF;

    DELETE FROM spatial.nodes WHERE id = v_bay;
    DELETE FROM spatial.nodes WHERE id = v_rack;
    DELETE FROM spatial.sites WHERE id = v_site;

    RAISE NOTICE
        'OK 0053: 7 node_types (bay anadido) · 13 aristas (rack->bay; SIN site->rack '
        'ni bay->storage_area) · can_hold_locations solo en bay y storage_area · '
        'logical_index y external_code en nodes · normalizacion probada en DANADO y '
        'PHA_LO con el espacio a guion bajo · 4 pruebas de jerarquia en vivo';
END
$$;
