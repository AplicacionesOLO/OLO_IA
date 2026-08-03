-- ROLLBACK de 0052_spatial_location_attributes.sql
--
-- Devuelve `spatial.locations` a la forma que tenía tras 0051: sin atributos
-- lógicos ni de mundo, con `level` en lugar de `logical_level`, y con el
-- vocabulario de estado heredado de la migración 0012 —incluidos `occupied` y
-- `reserved`, que 0052 había retirado por SPA-12—.
--
-- ⚠ Los índices creados en 0052 desaparecen con sus columnas; solo hay que borrar
--   explícitamente el que NO cuelga de una columna nueva (`idx_loc_origin` sí
--   cuelga de `origin`, así que también se va solo). Se listan igualmente con
--   IF EXISTS para que el rollback sea idempotente.
--
-- ⚠ Si alguna ubicación tuviera `world_*` con valor, este rollback los DESTRUIRÍA
--   al borrar las columnas. Por eso falla antes en ese caso: perder geometría
--   levantada con CAD no es reversible.

DO $$
DECLARE v_world int; v_datos int;
BEGIN
    SELECT count(1) INTO v_world FROM spatial.locations
     WHERE world_position IS NOT NULL OR world_footprint IS NOT NULL
        OR world_bbox IS NOT NULL OR world_frame_id IS NOT NULL;
    IF v_world > 0 THEN
        RAISE EXCEPTION
            '% ubicacion(es) tienen coordenadas world_*. Revertir 0052 borraria esas '
            'columnas y con ellas la geometria levantada. Exportala antes.', v_world;
    END IF;

    -- Aviso, no bloqueo: los índices lógicos se pueden volver a importar.
    SELECT count(1) INTO v_datos FROM spatial.locations
     WHERE logical_column IS NOT NULL OR logical_x IS NOT NULL
        OR external_location_id IS NOT NULL;
    IF v_datos > 0 THEN
        RAISE WARNING
            '% ubicacion(es) tienen datos logicos importados que se perderan. '
            'Son reimportables desde ReporteUbicaciones.xlsx.', v_datos;
    END IF;
END
$$;

DROP INDEX IF EXISTS spatial.uq_loc_external;
DROP INDEX IF EXISTS spatial.idx_loc_rejilla;
DROP INDEX IF EXISTS spatial.idx_loc_granel;
DROP INDEX IF EXISTS spatial.idx_loc_origin;
DROP INDEX IF EXISTS spatial.idx_loc_frame;

ALTER TABLE spatial.locations DROP CONSTRAINT fk_loc_frame;

ALTER TABLE spatial.locations
    DROP CONSTRAINT chk_loc_peso_sin_centinela,
    DROP CONSTRAINT chk_loc_unidades_sin_centinela,
    DROP CONSTRAINT chk_loc_volumen_sin_centinela,
    DROP CONSTRAINT chk_loc_world_exige_marco,
    DROP CONSTRAINT chk_loc_origin,
    DROP CONSTRAINT chk_loc_logicos_no_negativos,
    DROP CONSTRAINT chk_loc_raw;

ALTER TABLE spatial.locations
    DROP COLUMN logical_column,
    DROP COLUMN logical_position,
    DROP COLUMN logical_x,
    DROP COLUMN logical_y,
    DROP COLUMN logical_z,
    DROP COLUMN world_frame_id,
    DROP COLUMN world_position,
    DROP COLUMN world_footprint,
    DROP COLUMN world_bbox,
    DROP COLUMN external_location_id,
    DROP COLUMN location_situation,
    DROP COLUMN is_bulk_area,
    DROP COLUMN origin,
    DROP COLUMN raw_source;

ALTER TABLE spatial.locations RENAME COLUMN logical_level TO level;

-- El vocabulario de estado vuelve al de 0012, con `occupied` y `reserved`.
ALTER TABLE spatial.locations DROP CONSTRAINT chk_loc_status;
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_status CHECK (
        status IN ('available', 'occupied', 'blocked', 'reserved', 'maintenance')
    );

COMMENT ON COLUMN spatial.locations.status IS NULL;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_nuevas int;
    v_level  int;
    v_idx    int;
    v_rech   boolean;
    v_loc    uuid;
BEGIN
    SELECT count(1) INTO v_nuevas FROM pg_attribute a
     WHERE a.attrelid = 'spatial.locations'::regclass AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attname IN ('logical_column', 'logical_position', 'logical_x', 'logical_y',
                         'logical_z', 'world_frame_id', 'world_position',
                         'world_footprint', 'world_bbox', 'external_location_id',
                         'location_situation', 'is_bulk_area', 'origin', 'raw_source',
                         'logical_level');
    IF v_nuevas <> 0 THEN RAISE EXCEPTION 'quedan % columna(s) de 0052', v_nuevas; END IF;

    SELECT count(1) INTO v_level FROM pg_attribute a
     WHERE a.attrelid = 'spatial.locations'::regclass AND a.attname = 'level'
       AND NOT a.attisdropped;
    IF v_level <> 1 THEN RAISE EXCEPTION '`level` no volvio a su nombre original'; END IF;

    SELECT count(1) INTO v_idx FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial'
       AND c.relname IN ('uq_loc_external', 'idx_loc_rejilla', 'idx_loc_granel',
                         'idx_loc_origin', 'idx_loc_frame');
    IF v_idx <> 0 THEN RAISE EXCEPTION 'quedan % indice(s) de 0052', v_idx; END IF;

    -- El vocabulario heredado vuelve a admitir `occupied`: es la prueba de que la
    -- restauración es completa y no solo un borrado de columnas.
    SELECT l.id INTO v_loc FROM spatial.locations l LIMIT 1;
    IF v_loc IS NOT NULL THEN
        v_rech := false;
        BEGIN
            UPDATE spatial.locations SET status = 'occupied' WHERE id = v_loc;
            UPDATE spatial.locations SET status = 'available' WHERE id = v_loc;
        EXCEPTION WHEN check_violation THEN v_rech := true;
        END;
        IF v_rech THEN
            RAISE EXCEPTION 'el vocabulario de estado no volvio al de 0012';
        END IF;
    END IF;

    -- Lo de 0048-0051 sigue en pie.
    IF (SELECT count(1) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'spatial' AND c.relkind = 'r') <> 7 THEN
        RAISE EXCEPTION 'el numero de tablas de spatial cambio: 0052 no debe tocarlo';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = 'spatial.locations'::regclass
                      AND a.attname = 'node_id' AND NOT a.attisdropped) THEN
        RAISE EXCEPTION 'node_id desaparecio: este rollback no debe tocar 0051';
    END IF;

    RAISE NOTICE
        'OK rollback 0052: 15 columnas eliminadas · logical_level -> level · '
        '5 indices y 7 CHECK retirados · vocabulario de estado de 0012 restaurado '
        '(occupied admitido de nuevo) · 7 tablas y node_id intactos';
END
$$;
