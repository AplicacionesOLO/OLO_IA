-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0040_annotations_extend_kinds.sql
--
-- Restaura la forma de 0030: tres tipos, sin text_value ni numeric_value.
--
-- ⚠ Aborta si existen anotaciones de los tipos nuevos: revertir las convertiría en
--   filas inválidas o perdería su contenido. Un `image_label` no se puede
--   representar con el CHECK antiguo, y el texto de un `text_region` no cabe en
--   ninguna columna que sobreviva.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠ Primero: ¿está la migración realmente aplicada?
--
-- Sin esta guarda, revertir una migración no aplicada fallaba con
-- «constraint chk_ann_kind ya existe», un mensaje que apunta al síntoma y no a la
-- causa. Ocurrió durante la ejecución del bloque, cuando 0040 abortó por un
-- defecto de su propia verificación.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'annotations'
           AND column_name = 'text_value'
    ) THEN
        RAISE EXCEPTION
            'La migracion 0040 no esta aplicada (no existe ai.annotations.text_value). '
            'No hay nada que revertir.';
    END IF;
END
$$;

DO $$
DECLARE
    v_nuevas int;
BEGIN
    SELECT count(1) INTO v_nuevas
      FROM ai.annotations
     WHERE kind::text IN ('image_label', 'text_region', 'count');
    IF v_nuevas > 0 THEN
        RAISE EXCEPTION
            'Hay % anotaciones de los tipos nuevos. Revertir las invalidaria o '
            'perderia su contenido. Expórtalas o eliminalas antes.', v_nuevas;
    END IF;
END
$$;

DROP INDEX IF EXISTS ai.uq_ann_etiqueta_imagen;

ALTER TABLE ai.annotations DROP CONSTRAINT IF EXISTS chk_ann_cantidad;
ALTER TABLE ai.annotations DROP CONSTRAINT IF EXISTS chk_ann_texto_no_vacio;
ALTER TABLE ai.annotations DROP CONSTRAINT IF EXISTS chk_ann_forma;

-- Vuelta al varchar(12) con su CHECK propio, como en 0030.
ALTER TABLE ai.annotations ALTER COLUMN kind TYPE varchar(12);
ALTER TABLE ai.annotations
    ADD CONSTRAINT chk_ann_kind CHECK (kind IN ('bbox', 'polygon', 'keypoints'));

ALTER TABLE ai.annotations DROP COLUMN IF EXISTS numeric_value;
ALTER TABLE ai.annotations DROP COLUMN IF EXISTS text_value;

ALTER TABLE ai.annotations ADD CONSTRAINT chk_ann_forma CHECK (
    (kind =  'bbox' AND cx IS NOT NULL AND cy IS NOT NULL
                    AND w  IS NOT NULL AND h  IS NOT NULL
                    AND geometry IS NULL)
 OR (kind <> 'bbox' AND cx IS NULL AND cy IS NULL
                    AND w  IS NULL AND h  IS NULL
                    AND geometry IS NOT NULL)
);

DO $$
DECLARE
    v_cols int;
BEGIN
    SELECT count(1) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'ai' AND table_name = 'annotations'
       AND column_name IN ('text_value', 'numeric_value');
    IF v_cols <> 0 THEN
        RAISE EXCEPTION 'quedan % columnas de las añadidas', v_cols;
    END IF;
    RAISE NOTICE 'OK rollback 0040: 3 tipos, columnas y matriz restauradas a la forma de 0030';
END
$$;
