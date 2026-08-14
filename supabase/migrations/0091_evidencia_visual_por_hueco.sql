-- ═══════════════════════════════════════════════════════════════════════════════
-- 0091 · La prueba visual: ver EL FOTOGRAMA donde la IA detectó cada cosa
--
-- ── QUÉ SE PODÍA HACER HASTA AHORA, Y QUÉ NO ──────────────────────────────────
--
-- La reconciliación dice «en RCL47-C018-N01-2 hay un pallet 22O0010471953 y el WMS
-- declara otros dos». Quien lo lee tiene que creérselo: no hay forma de ver qué miró la
-- cámara. Si la lectura está mal —un código mal decodificado, una caja sobre el pallet del
-- vecino— no se puede saber sin volver al vídeo, buscar el segundo y mirar a ojo.
--
-- Y hay una asimetría peor: para DEFENDER una discrepancia ante quien opera el almacén hace
-- falta enseñarla. «El sistema dice» no discute con «yo estuve ahí».
--
-- ── LO QUE SE GUARDA, Y POR QUÉ TRES ──────────────────────────────────────────
--
-- Tres recortes por hueco, uno por cada eje de la lectura:
--
--     qr_ubicacion   ¿de qué hueco hablamos?
--     pallet         ¿qué hay dentro?
--     qr_pallet      ¿qué pallet concreto es?
--
-- No es una elección estética: son los tres ejes que `v_reconciliation` compara por
-- separado desde 0064, y cada uno falla por su cuenta. Una sola foto del hueco entero no
-- deja ver si el QR se leyó bien.
--
-- El puente ya elige exactamente esas tres detecciones para construir cada lectura, así que
-- las imágenes son las que YA se usaron para decidir — no unas parecidas.
--
-- ── DÓNDE SE RECORTA, Y POR QUÉ AHÍ ───────────────────────────────────────────
--
-- En el worker, mientras analiza. Es el único momento en que los píxeles son gratis: tiene
-- el fotograma de 8K decodificado en memoria. Hacerlo después obligaría a descargar 141 MB
-- de vídeo y volver a buscar el instante, y el vídeo se puede haber borrado.
--
-- Por eso la ruta del recorte vive en la DETECCIÓN: es quien sabe de qué fotograma salió.
-- La lectura solo copia las tres que usó.
--
-- ── POR QUÉ NO SE REUTILIZA `readings.image_id` ───────────────────────────────
--
-- Porque apunta a `ai.images`, que es el material de ENTRENAMIENTO. Meter ahí la prueba de
-- una discrepancia mezclaría dos cosas con ciclos de vida opuestos: el dataset se cura y se
-- versiona, la prueba se congela y se conserva. Y además es UNA imagen donde hacen falta
-- tres. La columna se queda como está, sin usar, hasta que alguien decida qué hacer con ella.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · La detección recuerda de dónde se recortó ─────────────────────────────

ALTER TABLE perception.detections
    ADD COLUMN IF NOT EXISTS crop_path text;

COMMENT ON COLUMN perception.detections.crop_path IS
    'Ruta en el bucket `perception-media` del recorte de esta deteccion. NULL cuando el '
    'worker no lo guardo —analisis viejos, o `save_detected_frames` desactivado—. La ruta y '
    'no una URL: las firmadas caducan en una hora y guardarlas seria guardar basura.';

-- ── 2 · La lectura se queda con las tres que usó ──────────────────────────────
--
-- Tres columnas y no un `jsonb`: son tres cosas fijas con nombre propio, y cada una
-- corresponde a uno de los tres ejes que la vista ya compara. Un `jsonb` permitiria meter
-- una cuarta sin decidirlo, que es justo lo que no se quiere.

ALTER TABLE inventory.readings
    ADD COLUMN IF NOT EXISTS crop_location_path text,
    ADD COLUMN IF NOT EXISTS crop_content_path text,
    ADD COLUMN IF NOT EXISTS crop_pallet_path text;

COMMENT ON COLUMN inventory.readings.crop_location_path IS
    'Recorte de la etiqueta del hueco (`qr_ubicacion`), la que decidio la atribucion.';
COMMENT ON COLUMN inventory.readings.crop_content_path IS
    'Recorte de lo que hay dentro (`pallet` o `hueco_vacio`), lo que decidio el contenido.';
COMMENT ON COLUMN inventory.readings.crop_pallet_path IS
    'Recorte de la etiqueta del pallet (`qr_pallet`), la que decidio la identidad.';

-- ── 3 · El instante del video ─────────────────────────────────────────────────
--
-- `observed_at` es la hora del recorrido, no el milisegundo del video, y sin el milisegundo
-- no se puede volver al fotograma. Hace falta para poder REGENERAR un recorte que falte
-- —un analisis viejo, o uno que se hizo con los recortes apagados— y para poder saltar el
-- video justo ahi desde la pantalla.

ALTER TABLE inventory.readings
    ADD COLUMN IF NOT EXISTS frame_ms integer;

COMMENT ON COLUMN inventory.readings.frame_ms IS
    'Milisegundo del video del que salio esta lectura. `observed_at` es la hora del '
    'recorrido; esto es el instante dentro del material, que es lo que permite volver al '
    'fotograma. NULL en lecturas anteriores a 0091.';

ALTER TABLE inventory.readings
    ADD CONSTRAINT chk_read_frame_ms CHECK (frame_ms IS NULL OR frame_ms >= 0);

-- ── 4 · Comprobación ──────────────────────────────────────────────────────────

DO $$
DECLARE
    v_lecturas int;
BEGIN
    --  Ninguna fila cambia: son columnas nuevas y nulas. Se comprueba que siguen ahi las
    --  438 lecturas y que ninguna se quedo con una ruta a medias.
    SELECT count(*) INTO v_lecturas FROM inventory.readings;

    IF EXISTS (
        SELECT 1 FROM inventory.readings
         WHERE crop_location_path = '' OR crop_content_path = '' OR crop_pallet_path = ''
    ) THEN
        RAISE EXCEPTION 'una ruta vacia no es una ruta: usa NULL';
    END IF;

    RAISE NOTICE 'OK · % lectura(s) intactas, listas para recibir su prueba visual', v_lecturas;
END $$;
