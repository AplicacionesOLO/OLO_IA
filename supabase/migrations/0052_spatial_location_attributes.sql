-- ═══════════════════════════════════════════════════════════════════════════
-- 0052_spatial_location_attributes.sql
-- Amplía  : spatial.locations con atributos lógicos, físicos y de capacidad
-- Depende de: 0047 (postgis en `extensions`), 0049 (reference_frames), 0051 (node_id)
-- Riesgo  : medio · añade columnas y endurece vocabularios heredados
--
-- LA SEPARACIÓN QUE ESTA MIGRACIÓN HACE INEXPRESABLE DE ROMPER
--
--   `logical_*`   índices del WMS. Enteros. SIN unidad. Se guardan TAL CUAL,
--                 centinelas incluidos, porque son el dato de origen y su
--                 interpretación es del consumidor.
--   `world_*`     geometría métrica. NULL hasta el importador CAD, y SIN
--                 significado sin `world_frame_id`.
--
--   El prefijo es la defensa: quien vea `logical_x = 1000006` no lo sumará a una
--   distancia; quien viera `x` sí podría. Medido: `Eje Z` tiene 9 valores, los
--   mismos que `Nivel`; `Eje X` tiene 254, el mismo número que los
--   `IdAlmacenamiento`; y los máximos son 1.000.006 y 1.000.007. Son índices con
--   aspecto de coordenadas.
--
-- ESTA MIGRACIÓN NO PUEBLA NADA. Añade la estructura y las guardas. Los
-- `logical_*` los rellenará el importador del catálogo (letra C) leyendo
-- `ReporteUbicaciones.xlsx`. Aquí no se inventa ni un valor.
--
-- ⚠ LAS CUATRO REGLAS DE DATOS QUEDAN PROTEGIDAS POR EL MOTOR, no por el
--   importador. Si el importador olvidara normalizar, la fila FALLA en lugar de
--   guardar un dato falso:
--
--     1. `999999999`, `1000000000` y `0` en capacidad → prohibidos. Son centinelas
--        de «sin límite» medidos en el catálogo (25.806 + 388 + 725 filas), no
--        capacidades. Deben llegar como NULL.
--     2. Cualquier `world_*` con valor exige `world_frame_id`. Es SPA-07 y TWN-01:
--        una coordenada sin marco es un número sin unidad.
--     3. `origin` con vocabulario cerrado. `RETIRA`, `LAYOUT`, `PISO1` y `SOBRA`
--        —las 4 ubicaciones del inventario ausentes del catálogo, una de ellas con
--        560 pallets— entran como `inferred`, nunca como `catalog` y nunca
--        rechazadas. La distinción es VISIBLE y contable.
--     4. Ninguna coordenada `world_*` se genera automáticamente. La verificación
--        de esta migración comprueba que el 100 % sigue NULL después de aplicarla.
--
-- PLT-12: toda referencia a PostGIS va CUALIFICADA como `extensions.…`, porque
-- `extensions` no está en el `search_path` de `authenticated` ni de `olo_app`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · `level` pasa a ser `logical_level` ─────────────────────────────────
-- No se añade una columna nueva: `level` YA ES un índice lógico —el `Nivel` del
-- WMS, 9 valores— y tener las dos sería tener dos verdades sobre lo mismo. El
-- renombrado arrastra su CHECK.
ALTER TABLE spatial.locations RENAME COLUMN level TO logical_level;


-- ── 2 · Dirección lógica: los cuatro segmentos del código ──────────────────
ALTER TABLE spatial.locations
    ADD COLUMN logical_column   smallint NULL,
    ADD COLUMN logical_position smallint NULL,
    -- Rejilla del WMS. Enteros SIN unidad, con sus centinelas intactos.
    ADD COLUMN logical_x        integer  NULL,
    ADD COLUMN logical_y        integer  NULL,
    ADD COLUMN logical_z        integer  NULL;

COMMENT ON COLUMN spatial.locations.logical_level IS
    'Nivel del WMS. Antes se llamaba `level`; renombrada en 0052 para que la familia logical_* sea reconocible de un vistazo.';
COMMENT ON COLUMN spatial.locations.logical_x IS
    'Eje X del WMS. INDICE, NO METROS: 254 valores distintos, el mismo numero que los IdAlmacenamiento, y maximo 1.000.006 (centinela). No se normaliza: es el dato de origen.';
COMMENT ON COLUMN spatial.locations.logical_z IS
    'Eje Z del WMS. INDICE DE NIVEL, no altura: tiene exactamente 9 valores, los mismos que Nivel.';


-- ── 3 · Coordenadas del mundo · NULL hasta el importador CAD ───────────────
ALTER TABLE spatial.locations
    ADD COLUMN world_frame_id  uuid NULL,
    ADD COLUMN world_position  extensions.geometry(PointZ)   NULL,
    ADD COLUMN world_footprint extensions.geometry(PolygonZ) NULL,
    ADD COLUMN world_bbox      extensions.geometry(PolygonZ) NULL;

ALTER TABLE spatial.locations
    ADD CONSTRAINT fk_loc_frame FOREIGN KEY (tenant_id, world_frame_id)
        REFERENCES spatial.reference_frames (tenant_id, id);

COMMENT ON COLUMN spatial.locations.world_position IS
    'Posicion metrica en el marco world_frame_id. NULL hasta que el importador CAD la calcule. NUNCA derivada de logical_x/y/z: esos son indices (TWN-07).';


-- ── 4 · Capacidad, procedencia y granel ────────────────────────────────────
ALTER TABLE spatial.locations
    ADD COLUMN external_location_id varchar(40)  NULL,
    ADD COLUMN location_situation   varchar(12)  NULL,
    -- Declarado, NUNCA derivado de un recuento de contenedores: un patio es un
    -- patio aunque hoy esté vacío (SPA-15). Y cambia el ALGORITMO de comparación
    -- con lo observado, no solo el dibujo.
    ADD COLUMN is_bulk_area         boolean      NOT NULL DEFAULT false,
    ADD COLUMN origin               varchar(12)  NOT NULL DEFAULT 'catalog',
    ADD COLUMN raw_source           jsonb        NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN spatial.locations.external_location_id IS
    'Id Ubicacion del WMS: Preambulo + Referencia rellenada a 6 con ESPACIOS + C3 + N2 + P2. Sin el relleno la formula falla en el 87,56 % de las filas, y en silencio.';
COMMENT ON COLUMN spatial.locations.origin IS
    'catalog = la publico ReporteUbicaciones · inferred = existe porque el inventario la menciono (RETIRA, LAYOUT, PISO1, SOBRA) · manual = la creo una persona. `inferred` es una anomalia VISIBLE y contable.';
COMMENT ON COLUMN spatial.locations.location_situation IS
    'Situacion del WMS, vocabulario ABIERTO a proposito: 5 valores en el inventario y 8 en el catalogo. Cerrarlo con CHECK haria que un valor nuevo tumbara la importacion entera.';


-- ── 5 · LAS CUATRO REGLAS, impuestas por el motor ──────────────────────────

-- Regla 1 · los centinelas de capacidad no son capacidades.
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

-- Regla 2 · SPA-07 / TWN-01: una coordenada sin marco es un número sin unidad.
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_world_exige_marco CHECK (
        (world_position IS NULL AND world_footprint IS NULL AND world_bbox IS NULL)
        OR world_frame_id IS NOT NULL
    );

-- Regla 3 · vocabulario cerrado de procedencia.
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_origin CHECK (origin IN ('catalog', 'inferred', 'manual'));

-- Los índices lógicos sí admiten centinelas —son el dato del WMS— pero no
-- negativos: ninguno de los 29.310 medidos lo es.
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_logicos_no_negativos CHECK (
        (logical_column   IS NULL OR logical_column   > 0)
        AND (logical_position IS NULL OR logical_position > 0)
        AND (logical_x IS NULL OR logical_x >= 0)
        AND (logical_y IS NULL OR logical_y >= 0)
        AND (logical_z IS NULL OR logical_z >= 0)
    ),
    ADD CONSTRAINT chk_loc_raw CHECK (jsonb_typeof(raw_source) = 'object');


-- ── 6 · SPA-12 · el estado de la ubicación no describe ocupación ───────────
-- El vocabulario heredado de la migración 0012 admitía `occupied` y `reserved`, y
-- los dos contradicen la arquitectura: la ocupación es del snapshot de `wms`, no
-- del estante. Si estuvieran aquí habría dos verdades sobre si un hueco está
-- ocupado, y la del espacio quedaría obsoleta entre importaciones.
--
-- Con 2 filas de prueba, ambas `available`, corregirlo ahora no cuesta nada.
ALTER TABLE spatial.locations DROP CONSTRAINT chk_loc_status;
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_status CHECK (
        status IN ('available', 'blocked', 'maintenance')
    );

COMMENT ON COLUMN spatial.locations.status IS
    'Estado del ESPACIO: disponible, bloqueado o en mantenimiento. NO contiene `occupied` ni `reserved` (SPA-12): la ocupacion es del snapshot de wms.';


-- ── 7 · Índices ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX uq_loc_external ON spatial.locations (external_location_id)
    WHERE external_location_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_loc_rejilla ON spatial.locations (logical_x, logical_y, logical_z)
    WHERE deleted_at IS NULL;
-- Parcial: las áreas de granel son pocas y se consultan aparte.
CREATE INDEX idx_loc_granel ON spatial.locations (tenant_id, warehouse_id)
    WHERE is_bulk_area AND deleted_at IS NULL;
-- `inferred` es una anomalía que hay que poder contar sin recorrer la tabla.
CREATE INDEX idx_loc_origin ON spatial.locations (tenant_id, warehouse_id, origin)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_loc_frame ON spatial.locations (world_frame_id)
    WHERE world_frame_id IS NOT NULL;

-- NO se crea índice GIST sobre world_position: con la columna al 100 % NULL sería
-- coste de escritura sin ninguna consulta que lo use. Entra con el importador CAD.


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_cols  int;
    v_world int;
    v_n     int;
    v_rech  boolean;
    v_t uuid; v_wh uuid; v_node uuid; v_loc uuid;
BEGIN
    -- Las columnas existen y `level` ya no.
    SELECT count(1) INTO v_cols FROM pg_attribute a
     WHERE a.attrelid = 'spatial.locations'::regclass AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attname IN ('logical_level', 'logical_column', 'logical_position',
                         'logical_x', 'logical_y', 'logical_z',
                         'world_frame_id', 'world_position', 'world_footprint',
                         'world_bbox', 'external_location_id', 'location_situation',
                         'is_bulk_area', 'origin', 'raw_source');
    IF v_cols <> 15 THEN RAISE EXCEPTION 'se esperaban 15 columnas nuevas, hay %', v_cols; END IF;

    IF EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = 'spatial.locations'::regclass
                  AND a.attname = 'level' AND NOT a.attisdropped) THEN
        RAISE EXCEPTION '`level` deberia haberse renombrado a logical_level';
    END IF;

    -- REGLA 4 · ninguna coordenada world_* generada automáticamente.
    SELECT count(1) INTO v_world FROM spatial.locations
     WHERE world_position IS NOT NULL OR world_footprint IS NOT NULL
        OR world_bbox IS NOT NULL OR world_frame_id IS NOT NULL;
    IF v_world <> 0 THEN
        RAISE EXCEPTION
            '% ubicacion(es) tienen world_* con valor. Esta migracion NO debe generar '
            'coordenadas fisicas: solo las crea el importador CAD', v_world;
    END IF;

    -- Todas las filas existentes quedan como `catalog` por el DEFAULT, y ninguna
    -- como `inferred`: aun no se ha importado nada.
    SELECT count(1) INTO v_n FROM spatial.locations WHERE origin <> 'catalog';
    IF v_n <> 0 THEN RAISE EXCEPTION '% fila(s) con origin distinto de catalog', v_n; END IF;

    -- ── PRUEBAS VIVAS DE LAS REGLAS ────────────────────────────────────────
    -- Verificar que un CHECK existe no demuestra que rechace.
    SELECT l.tenant_id, l.warehouse_id, l.node_id, l.id
      INTO v_t, v_wh, v_node, v_loc
      FROM spatial.locations l LIMIT 1;

    IF v_loc IS NULL THEN
        RAISE WARNING 'sin ubicaciones sembradas: las pruebas de reglas no corrieron';
        RAISE NOTICE 'OK 0052 PARCIAL: 15 columnas, world_* vacias, indices y CHECK creados';
        RETURN;
    END IF;

    -- REGLA 1 · centinela 999999999 en peso
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET max_weight_kg = 999999999 WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto el centinela 999999999 como peso maximo'; END IF;

    -- REGLA 1 · centinela 1000000000
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET max_weight_kg = 1000000000 WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto el centinela 1000000000 como peso maximo'; END IF;

    -- REGLA 1 · el 0 tampoco es una capacidad
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET max_units = 0 WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto 0 como maximo de unidades'; END IF;

    -- REGLA 1 · y un valor real SI se acepta
    UPDATE spatial.locations SET max_weight_kg = 1300 WHERE id = v_loc;
    UPDATE spatial.locations SET max_weight_kg = NULL WHERE id = v_loc;

    -- REGLA 2 · una coordenada sin marco es inexpresable
    v_rech := false;
    BEGIN
        UPDATE spatial.locations
           SET world_position = extensions.ST_MakePoint(10, 20, 3)
         WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'se acepto una world_position sin world_frame_id (SPA-07)';
    END IF;

    -- REGLA 3 · vocabulario de procedencia cerrado
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET origin = 'inventado' WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto un origin fuera del vocabulario'; END IF;

    -- REGLA 3 · y los tres válidos sí. `inferred` es el tratamiento acordado para
    -- RETIRA, LAYOUT, PISO1 y SOBRA.
    UPDATE spatial.locations SET origin = 'inferred' WHERE id = v_loc;
    UPDATE spatial.locations SET origin = 'manual'   WHERE id = v_loc;
    UPDATE spatial.locations SET origin = 'catalog'  WHERE id = v_loc;

    -- SPA-12 · `occupied` ya no cabe en el estado del espacio
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET status = 'occupied' WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN
        RAISE EXCEPTION 'se acepto status=occupied: la ocupacion es del snapshot (SPA-12)';
    END IF;
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET status = 'reserved' WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto status=reserved (SPA-12)'; END IF;

    -- Un índice lógico negativo tampoco
    v_rech := false;
    BEGIN
        UPDATE spatial.locations SET logical_x = -1 WHERE id = v_loc;
    EXCEPTION WHEN check_violation THEN v_rech := true;
    END;
    IF NOT v_rech THEN RAISE EXCEPTION 'se acepto un logical_x negativo'; END IF;

    -- Pero el CENTINELA de la rejilla SI se acepta: es el dato del WMS y no se
    -- normaliza. Es la asimetria deliberada frente a la capacidad.
    UPDATE spatial.locations SET logical_x = 1000006, logical_y = 1000007, logical_z = 1
     WHERE id = v_loc;
    IF (SELECT logical_x FROM spatial.locations WHERE id = v_loc) <> 1000006 THEN
        RAISE EXCEPTION 'el centinela de la rejilla deberia conservarse tal cual';
    END IF;
    UPDATE spatial.locations
       SET logical_x = NULL, logical_y = NULL, logical_z = NULL WHERE id = v_loc;

    -- Y world_* sigue vacío al terminar.
    SELECT count(1) INTO v_world FROM spatial.locations
     WHERE world_position IS NOT NULL OR world_frame_id IS NOT NULL;
    IF v_world <> 0 THEN RAISE EXCEPTION 'quedaron world_* con valor tras las pruebas'; END IF;

    RAISE NOTICE
        'OK 0052: 15 columnas nuevas · level -> logical_level · world_* al 100%% NULL · '
        '5 indices (sin GIST) · 10 pruebas vivas: centinelas 999999999/1000000000/0 '
        'rechazados, world sin marco rechazado, origin cerrado, occupied y reserved '
        'rechazados (SPA-12), logical negativo rechazado, centinela de rejilla CONSERVADO';
END
$$;
