-- ═══════════════════════════════════════════════════════════════════════════════
-- Rollback de 0091 · quita la prueba visual
--
-- Deshacer esto BORRA las rutas de los recortes. Los objetos siguen en el bucket
-- `perception-media` —nadie los toca— pero se queda sin saber cuál pertenece a qué
-- lectura, y recuperarlo exigiría volver a analizar el vídeo.
--
-- Antes de ejecutarlo conviene saber cuántas lecturas pierden su prueba: la consulta está
-- abajo y se imprime.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_con_prueba int;
    v_recortes int;
BEGIN
    SELECT count(*) INTO v_con_prueba FROM inventory.readings
     WHERE crop_location_path IS NOT NULL
        OR crop_content_path IS NOT NULL
        OR crop_pallet_path IS NOT NULL;
    SELECT count(*) INTO v_recortes FROM perception.detections WHERE crop_path IS NOT NULL;
    RAISE NOTICE 'Se pierden las rutas de % lectura(s) y % deteccion(es). Los objetos se '
                 'quedan en el bucket, huerfanos.', v_con_prueba, v_recortes;
END $$;

ALTER TABLE inventory.readings DROP CONSTRAINT IF EXISTS chk_read_frame_ms;

ALTER TABLE inventory.readings
    DROP COLUMN IF EXISTS crop_location_path,
    DROP COLUMN IF EXISTS crop_content_path,
    DROP COLUMN IF EXISTS crop_pallet_path,
    DROP COLUMN IF EXISTS frame_ms;

ALTER TABLE perception.detections DROP COLUMN IF EXISTS crop_path;

DO $$
BEGIN
    RAISE NOTICE 'OK · vuelta atras: las lecturas ya no saben de que fotograma salieron';
END $$;
