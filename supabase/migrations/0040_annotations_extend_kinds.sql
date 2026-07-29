-- ═══════════════════════════════════════════════════════════════════════════
-- 0040_annotations_extend_kinds.sql
-- Altera   : ai.annotations — 6 tipos, 2 columnas nuevas, matriz de CHECK
-- Depende de: 0033 (ai.annotations en su schema), 0031 (dominio ai.annotation_kind)
-- Riesgo   : bajo (0 filas)
--
-- ⚠ EL CHECK ACTUAL BLOQUEA CLASIFICACIÓN Y OCR.
--
--   Hoy dice, en esencia: `kind <> 'bbox' AND geometry IS NOT NULL`. Es decir,
--   todo lo que no sea una caja DEBE tener geometría. Y eso es falso para dos de
--   los tipos que la plataforma necesita:
--
--     · un clasificador de pallets anota LA IMAGEN ENTERA: no hay geometría;
--     · un OCR anota una región Y un texto, y el texto no cabe en `geometry` con
--       ningún sentido.
--
--   Con doce familias de modelo, `kind` tiene que crecer. La matriz de abajo dice
--   exactamente qué columnas exige cada tipo, y el motor la impone.
--
-- MATRIZ
--   kind          cx,cy,w,h    geometry    text_value    numeric_value
--   bbox          requerido    NULL        NULL          NULL
--   polygon       NULL         requerido   NULL          NULL
--   keypoints     NULL         requerido   NULL          NULL
--   image_label   NULL         NULL        NULL          NULL
--   text_region   requerido    NULL        REQUERIDO     NULL
--   count         NULL         NULL        NULL          REQUERIDO
--
-- Se CONSERVAN intactos los CHECK de normalización y de caja dentro de la imagen:
-- siguen aplicando a `bbox` y a `text_region`, y no estorban al resto porque sus
-- coordenadas son NULL.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_filas int;
BEGIN
    SELECT count(1) INTO v_filas FROM ai.annotations;
    IF v_filas > 0 THEN
        RAISE EXCEPTION
            'ai.annotations tiene % filas. El cambio de tipo de `kind` y los CHECK '
            'nuevos podrían rechazarlas: revisa los datos antes de aplicar.', v_filas;
    END IF;
END
$$;

ALTER TABLE ai.annotations
    ADD COLUMN text_value    text    NULL,
    ADD COLUMN numeric_value numeric NULL;

COMMENT ON COLUMN ai.annotations.text_value IS
    'Texto transcrito. Solo para kind = text_region: es el resultado que un OCR debe aprender a producir.';
COMMENT ON COLUMN ai.annotations.numeric_value IS
    'Cantidad observada. Solo para kind = count: la etiqueta es un numero, no una region.';

-- Unifica el vocabulario con el dominio de 0031. La columna era varchar(12) con
-- su propio CHECK; pasa a ser la misma fuente que usan las capacidades de
-- ai.architectures, así que un tipo nuevo se declara en un solo sitio.
ALTER TABLE ai.annotations DROP CONSTRAINT chk_ann_kind;
ALTER TABLE ai.annotations ALTER COLUMN kind TYPE ai.annotation_kind;

-- La matriz, en un solo CHECK. Junto y no separado en seis porque el motor
-- reporta el nombre del constraint violado, y `chk_ann_forma` con la matriz
-- delante en el comentario es más útil que seis nombres que hay que cruzar.
ALTER TABLE ai.annotations DROP CONSTRAINT chk_ann_forma;
ALTER TABLE ai.annotations ADD CONSTRAINT chk_ann_forma CHECK (
    CASE kind
        WHEN 'bbox' THEN
            cx IS NOT NULL AND cy IS NOT NULL AND w IS NOT NULL AND h IS NOT NULL
            AND geometry IS NULL AND text_value IS NULL AND numeric_value IS NULL
        WHEN 'polygon' THEN
            cx IS NULL AND cy IS NULL AND w IS NULL AND h IS NULL
            AND geometry IS NOT NULL AND text_value IS NULL AND numeric_value IS NULL
        WHEN 'keypoints' THEN
            cx IS NULL AND cy IS NULL AND w IS NULL AND h IS NULL
            AND geometry IS NOT NULL AND text_value IS NULL AND numeric_value IS NULL
        WHEN 'image_label' THEN
            cx IS NULL AND cy IS NULL AND w IS NULL AND h IS NULL
            AND geometry IS NULL AND text_value IS NULL AND numeric_value IS NULL
        WHEN 'text_region' THEN
            cx IS NOT NULL AND cy IS NOT NULL AND w IS NOT NULL AND h IS NOT NULL
            AND geometry IS NULL AND text_value IS NOT NULL AND numeric_value IS NULL
        WHEN 'count' THEN
            cx IS NULL AND cy IS NULL AND w IS NULL AND h IS NULL
            AND geometry IS NULL AND text_value IS NULL AND numeric_value IS NOT NULL
        ELSE false
    END
);

-- Un texto transcrito vacío no es una transcripción: es un error de captura.
ALTER TABLE ai.annotations ADD CONSTRAINT chk_ann_texto_no_vacio CHECK (
    text_value IS NULL OR length(btrim(text_value)) > 0
);

-- Contar no admite cantidades negativas ni fraccionarias.
ALTER TABLE ai.annotations ADD CONSTRAINT chk_ann_cantidad CHECK (
    numeric_value IS NULL OR (numeric_value >= 0 AND numeric_value = trunc(numeric_value))
);

-- Una imagen no puede llevar dos veces la misma etiqueta de clasificación.
-- Multietiqueta SÍ —una imagen puede ser a la vez «pallet» y «dañado»— y es un
-- caso real, así que la restricción es por (imagen, clase) y no por imagen.
CREATE UNIQUE INDEX uq_ann_etiqueta_imagen
    ON ai.annotations (image_id, class_id)
    WHERE kind = 'image_label' AND deleted_at IS NULL;

COMMENT ON TABLE ai.annotations IS
    'Anotaciones de 6 tipos. Coordenadas normalizadas 0..1 (formato nativo YOLO). La matriz de columnas por tipo la impone chk_ann_forma.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_owner  uuid;
    v_proj   uuid;
    v_cls    uuid;
    v_asset  uuid;
    v_img    uuid;
    v_ok     int := 0;
    v_tipo   text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'annotations'
           AND column_name IN ('text_value', 'numeric_value')
        HAVING count(1) = 2
    ) THEN
        RAISE EXCEPTION 'faltan text_value o numeric_value';
    END IF;

    -- Se consulta pg_attribute y NO information_schema.columns: para una columna
    -- de tipo dominio, `udt_name` devuelve el tipo SUBYACENTE (varchar), no el
    -- nombre del dominio. Con la vista informativa esta comprobación no puede
    -- distinguir un varchar suelto de un dominio sobre varchar.
    SELECT t.typname INTO v_tipo
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t      ON t.oid = a.atttypid
     WHERE n.nspname = 'ai' AND c.relname = 'annotations' AND a.attname = 'kind';
    IF v_tipo <> 'annotation_kind' THEN
        RAISE EXCEPTION 'kind debe usar el dominio ai.annotation_kind, usa %', v_tipo;
    END IF;

    SELECT id INTO v_owner FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;
    IF v_owner IS NULL THEN
        RAISE NOTICE 'AVISO: sin usuario owner, se omiten las pruebas vivas';
        RETURN;
    END IF;

    INSERT INTO ai.projects (name, slug, created_by)
    VALUES ('Verif 0040', 'verif-0040', v_owner) RETURNING id INTO v_proj;
    INSERT INTO ai.classes (project_id, name, class_index, color, created_by)
    VALUES (v_proj, 'etiqueta', 0, '#123456', v_owner) RETURNING id INTO v_cls;
    INSERT INTO ai.assets (project_id, kind, bucket, object_path, original_filename,
                           content_type, bytes, sha256, width, height, created_by)
    VALUES (v_proj, 'image', 'ai-source', 'verif/0040.jpg', 'v.jpg', 'image/jpeg',
            512, repeat('f', 64), 800, 600, v_owner) RETURNING id INTO v_asset;
    INSERT INTO ai.images (project_id, asset_id, source, created_by)
    VALUES (v_proj, v_asset, 'upload', v_owner) RETURNING id INTO v_img;

    -- 1 · image_label SIN geometría: debe ACEPTARSE. Era imposible antes de 0040.
    INSERT INTO ai.annotations (project_id, image_id, class_id, kind, created_by)
    VALUES (v_proj, v_img, v_cls, 'image_label', v_owner);
    v_ok := v_ok + 1;

    -- 2 · text_region con región y texto
    INSERT INTO ai.annotations (project_id, image_id, class_id, kind,
                                cx, cy, w, h, text_value, created_by)
    VALUES (v_proj, v_img, v_cls, 'text_region',
            0.5, 0.5, 0.3, 0.1, 'SSCC 003456789012345678', v_owner);
    v_ok := v_ok + 1;

    -- 3 · count con cantidad
    INSERT INTO ai.annotations (project_id, image_id, class_id, kind,
                                numeric_value, created_by)
    VALUES (v_proj, v_img, v_cls, 'count', 12, v_owner);
    v_ok := v_ok + 1;

    -- 4 · text_region SIN texto: rechazado
    BEGIN
        INSERT INTO ai.annotations (project_id, image_id, class_id, kind,
                                    cx, cy, w, h, created_by)
        VALUES (v_proj, v_img, v_cls, 'text_region', 0.5, 0.5, 0.2, 0.2, v_owner);
        RAISE EXCEPTION 'se acepto un text_region sin text_value';
    EXCEPTION WHEN check_violation THEN v_ok := v_ok + 1;
    END;

    -- 5 · bbox sin coordenadas: rechazado
    BEGIN
        INSERT INTO ai.annotations (project_id, image_id, class_id, kind, created_by)
        VALUES (v_proj, v_img, v_cls, 'bbox', v_owner);
        RAISE EXCEPTION 'se acepto un bbox sin coordenadas';
    EXCEPTION WHEN check_violation THEN v_ok := v_ok + 1;
    END;

    -- 6 · count sin cantidad: rechazado
    BEGIN
        INSERT INTO ai.annotations (project_id, image_id, class_id, kind, created_by)
        VALUES (v_proj, v_img, v_cls, 'count', v_owner);
        RAISE EXCEPTION 'se acepto un count sin numeric_value';
    EXCEPTION WHEN check_violation THEN v_ok := v_ok + 1;
    END;

    -- 7 · dos image_label con la misma clase en la misma imagen: rechazado
    BEGIN
        INSERT INTO ai.annotations (project_id, image_id, class_id, kind, created_by)
        VALUES (v_proj, v_img, v_cls, 'image_label', v_owner);
        RAISE EXCEPTION 'se acepto una etiqueta de clasificacion duplicada';
    EXCEPTION WHEN unique_violation THEN v_ok := v_ok + 1;
    END;

    -- 8 · el CHECK de caja dentro de la imagen sigue vivo para text_region
    BEGIN
        INSERT INTO ai.annotations (project_id, image_id, class_id, kind,
                                    cx, cy, w, h, text_value, created_by)
        VALUES (v_proj, v_img, v_cls, 'text_region', 0.98, 0.5, 0.2, 0.2, 'x', v_owner);
        RAISE EXCEPTION 'se acepto una region que sale de la imagen';
    EXCEPTION WHEN check_violation THEN v_ok := v_ok + 1;
    END;

    DELETE FROM ai.annotations WHERE project_id = v_proj;
    DELETE FROM ai.images      WHERE project_id = v_proj;
    DELETE FROM ai.assets      WHERE project_id = v_proj;
    DELETE FROM ai.classes     WHERE project_id = v_proj;
    DELETE FROM ai.projects    WHERE id = v_proj;

    IF v_ok <> 8 THEN RAISE EXCEPTION 'solo % de 8 comprobaciones vivas pasaron', v_ok; END IF;

    RAISE NOTICE
        'OK 0040: 6 tipos con dominio, +2 columnas, matriz verificada en vivo (image_label sin geometria, text_region con texto, count con cantidad, y 5 rechazos correctos)';
END
$$;
