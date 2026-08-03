-- ═══════════════════════════════════════════════════════════════════════════
-- 0052_spatial_location_attributes_rollback.sql
-- Revierte : 0052 · 15 columnas, sus reglas y el renombrado `level`→`logical_level`
--
-- ⚠ PIERDE DATOS. `logical_column`, `logical_position`, `logical_x/y/z`,
--   `location_situation`, `external_location_id`, `origin`, `is_bulk_area` y
--   `raw_source` se eliminan. Con el catálogo importado eso son **29.310 filas**,
--   incluido el `raw_source` que guarda el crudo del WMS y los valores de
--   capacidad que 0058 descartó. Nada de eso se puede reconstruir desde la base.
--
--   Aborta si hay datos, salvo confirmación explícita:
--       SET LOCAL olo.confirm_destructive = '0052';
--
--   El renombrado SÍ se revierte sin pérdida. Pero ⚠ `supabase/seed.sql` escribe
--   en `logical_level`: tras revertir, el seed falla hasta que se vuelva a
--   `level`. Es un consumidor del renombrado que ya se olvidó una vez, y por eso
--   este rollback lo avisa con un WARNING en lugar de dejarlo para que aparezca
--   como un error inexplicable.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_con_datos int; v_conf text;
BEGIN
    SELECT count(1) INTO v_con_datos FROM spatial.locations
     WHERE logical_column IS NOT NULL OR logical_position IS NOT NULL
        OR location_situation IS NOT NULL OR external_location_id IS NOT NULL
        OR raw_source IS NOT NULL;
    IF v_con_datos > 0 THEN
        v_conf := coalesce(current_setting('olo.confirm_destructive', true), '');
        IF v_conf <> '0052' THEN
            RAISE EXCEPTION
                'Revertir 0052 destruiria atributos de % ubicacion(es), incluido '
                'raw_source con el crudo del WMS. Si es lo que quiere: SET LOCAL '
                'olo.confirm_destructive = %L;', v_con_datos, '0052';
        END IF;
        RAISE WARNING 'rollback 0052: se destruyen atributos de % ubicaciones',
                      v_con_datos;
    END IF;
END
$$;

DROP INDEX IF EXISTS spatial.uq_loc_external;
DROP INDEX IF EXISTS spatial.idx_loc_frame;
DROP INDEX IF EXISTS spatial.idx_loc_granel;
DROP INDEX IF EXISTS spatial.idx_loc_origin;
DROP INDEX IF EXISTS spatial.idx_loc_rejilla;

-- Se listan también los CHECK de capacidad de 0058 y 0059 por si se revierte 0052
-- sin haber revertido aquellas: `DROP CONSTRAINT IF EXISTS` no falla si no están,
-- y así el rollback no depende de un orden que nadie garantiza.
ALTER TABLE spatial.locations
    DROP CONSTRAINT IF EXISTS chk_loc_logicos_no_negativos,
    DROP CONSTRAINT IF EXISTS chk_loc_origin,
    DROP CONSTRAINT IF EXISTS chk_loc_peso_sin_centinela,
    DROP CONSTRAINT IF EXISTS chk_loc_unidades_sin_centinela,
    DROP CONSTRAINT IF EXISTS chk_loc_volumen_sin_centinela,
    DROP CONSTRAINT IF EXISTS chk_loc_peso_plausible,
    DROP CONSTRAINT IF EXISTS chk_loc_unidades_plausible,
    DROP CONSTRAINT IF EXISTS chk_loc_volumen_plausible,
    DROP CONSTRAINT IF EXISTS chk_loc_world_exige_marco,
    DROP CONSTRAINT IF EXISTS chk_loc_raw,
    DROP CONSTRAINT IF EXISTS chk_loc_status,
    DROP CONSTRAINT IF EXISTS fk_loc_frame,
    DROP COLUMN IF EXISTS external_location_id,
    DROP COLUMN IF EXISTS is_bulk_area,
    DROP COLUMN IF EXISTS location_situation,
    DROP COLUMN IF EXISTS logical_column,
    DROP COLUMN IF EXISTS logical_position,
    DROP COLUMN IF EXISTS logical_x,
    DROP COLUMN IF EXISTS logical_y,
    DROP COLUMN IF EXISTS logical_z,
    DROP COLUMN IF EXISTS origin,
    DROP COLUMN IF EXISTS raw_source,
    DROP COLUMN IF EXISTS world_bbox,
    DROP COLUMN IF EXISTS world_footprint,
    DROP COLUMN IF EXISTS world_frame_id,
    DROP COLUMN IF EXISTS world_position;

-- El vocabulario de estado de antes de 0052, con `occupied` y `reserved`. Volver
-- a admitirlos es parte de la reversión, aunque contradiga SPA-12: la invariante
-- la introdujo 0052, y revertir 0052 revierte también la invariante.
ALTER TABLE spatial.locations
    ADD CONSTRAINT chk_loc_status CHECK (
        status IN ('available', 'occupied', 'reserved', 'blocked')
    );

ALTER TABLE spatial.locations RENAME COLUMN logical_level TO level;

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'locations'
       AND column_name IN ('logical_column', 'logical_position', 'logical_x',
                           'logical_y', 'logical_z', 'world_position',
                           'world_footprint', 'world_bbox', 'world_frame_id',
                           'external_location_id', 'location_situation', 'origin',
                           'raw_source', 'is_bulk_area', 'logical_level');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % columna(s) de 0052', v_n; END IF;

    SELECT count(1) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'locations'
       AND column_name = 'level';
    IF v_n <> 1 THEN RAISE EXCEPTION '`level` deberia haber vuelto'; END IF;

    RAISE WARNING 'rollback 0052: `supabase/seed.sql` escribe en `logical_level` y '
                  'fallara hasta que se vuelva a `level`';
    RAISE NOTICE 'OK rollback 0052: 15 columnas fuera · vocabulario de estado con '
                 'occupied/reserved restaurado · logical_level -> level';
END
$$;
