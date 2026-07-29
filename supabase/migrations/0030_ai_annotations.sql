-- ═══════════════════════════════════════════════════════════════════════════
-- 0030_ai_annotations.sql
-- Crea     : platform.ai_annotations + políticas RLS + trigger de updated_at
-- Depende de: 0028 (ai_images), 0026 (ai_classes), 0025 (ai_projects)
-- Riesgo   : bajo
--
-- Solo la TABLA. El anotador visual es interfaz y no entra en el Bloque 0. Sin
-- esta tabla, dos cosas que sí están en el bloque quedarían sin referente: el
-- estado `annotated` de ai_images no podría alcanzarse nunca, y congelar una
-- versión de dataset no podría validar que las imágenes tienen anotaciones.
--
-- ⚠ COORDENADAS NORMALIZADAS 0..1, NO PÍXELES (decisión 6).
--
--   Es el formato nativo de YOLO —no hay que convertir al exportar— y sobrevive a
--   que la imagen se redimensione o se recomprima. Con píxeles, generar una
--   miniatura o reescalar el dataset invalidaría en silencio todas las
--   anotaciones.
--
-- ⚠ HÍBRIDO TIPADO + JSONB, A PROPÓSITO.
--
--   Columnas tipadas para `bbox` porque es el 99 % de los casos, se puede indexar
--   y EL MOTOR PUEDE VALIDAR LOS RANGOS. Con jsonb, una caja fuera de la imagen
--   entraría sin protestar y reventaría durante el entrenamiento, a mucha
--   distancia de su causa. `geometry` jsonb queda para polígonos y keypoints,
--   cuya forma es variable y cuya validación toca a la aplicación.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.ai_annotations (
    id          uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  uuid         NOT NULL
                             REFERENCES platform.ai_projects(id) ON DELETE RESTRICT,
    image_id    uuid         NOT NULL,
    class_id    uuid         NOT NULL,

    kind        varchar(12)  NOT NULL DEFAULT 'bbox',

    -- bbox en formato YOLO: centro, ancho y alto, normalizados.
    cx          numeric(9,8) NULL,
    cy          numeric(9,8) NULL,
    w           numeric(9,8) NULL,
    h           numeric(9,8) NULL,

    -- Futuro: polygon [[x,y],…] · keypoints [{x,y,v},…]
    geometry    jsonb        NULL,

    origin      varchar(10)  NOT NULL DEFAULT 'human',
    confidence  numeric(4,3) NULL,

    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  uuid         NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    updated_by  uuid         NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version     integer      NOT NULL DEFAULT 1,
    deleted_at  timestamptz  NULL,

    -- FK compuestas: imagen y clase deben ser del MISMO proyecto que la anotación.
    CONSTRAINT fk_ann_image FOREIGN KEY (project_id, image_id)
        REFERENCES platform.ai_images (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_ann_class FOREIGN KEY (project_id, class_id)
        REFERENCES platform.ai_classes (project_id, id) ON DELETE RESTRICT,

    CONSTRAINT chk_ann_kind    CHECK (kind IN ('bbox', 'polygon', 'keypoints')),
    CONSTRAINT chk_ann_origin  CHECK (origin IN ('human', 'model', 'imported')),
    CONSTRAINT chk_ann_version CHECK (version >= 1),

    -- Exactamente una representación: tipada para bbox, jsonb para el resto.
    CONSTRAINT chk_ann_forma CHECK (
        (kind =  'bbox' AND cx IS NOT NULL AND cy IS NOT NULL
                        AND w  IS NOT NULL AND h  IS NOT NULL
                        AND geometry IS NULL)
     OR (kind <> 'bbox' AND cx IS NULL AND cy IS NULL
                        AND w  IS NULL AND h  IS NULL
                        AND geometry IS NOT NULL)
    ),

    -- Normalización: el centro dentro de la imagen y las dimensiones válidas.
    CONSTRAINT chk_ann_centro CHECK (
        (cx IS NULL AND cy IS NULL)
        OR (cx BETWEEN 0 AND 1 AND cy BETWEEN 0 AND 1)
    ),
    CONSTRAINT chk_ann_dimensiones CHECK (
        (w IS NULL AND h IS NULL)
        OR (w > 0 AND w <= 1 AND h > 0 AND h <= 1)
    ),

    -- La caja completa debe caber en la imagen. La tolerancia absorbe el redondeo
    -- de numeric(9,8) sin dejar pasar cajas realmente desbordadas.
    CONSTRAINT chk_ann_caja_dentro_x CHECK (
        cx IS NULL OR (cx - w / 2 >= -0.000001 AND cx + w / 2 <= 1.000001)
    ),
    CONSTRAINT chk_ann_caja_dentro_y CHECK (
        cy IS NULL OR (cy - h / 2 >= -0.000001 AND cy + h / 2 <= 1.000001)
    ),

    -- `confidence` solo tiene sentido si no lo dibujó una persona. Y si lo
    -- dibujó una persona, no puede haber confianza: es verdad, no estimación.
    CONSTRAINT chk_ann_confianza CHECK (
        (origin = 'human') = (confidence IS NULL)
    ),
    CONSTRAINT chk_ann_confianza_rango CHECK (
        confidence IS NULL OR confidence BETWEEN 0 AND 1
    )
);

COMMENT ON TABLE platform.ai_annotations IS
    'Anotaciones. Coordenadas normalizadas 0..1 (formato nativo YOLO): sobreviven a redimensionar la imagen.';
COMMENT ON COLUMN platform.ai_annotations.origin IS
    'human | model | imported. Prepara el bucle de mejora: el modelo preanota y la persona corrige.';
COMMENT ON COLUMN platform.ai_annotations.geometry IS
    'Solo para polygon y keypoints. bbox usa columnas tipadas para que el motor valide los rangos.';

CREATE INDEX idx_ann_imagen ON platform.ai_annotations (image_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_ann_clase ON platform.ai_annotations (class_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_ann_updated_at
    BEFORE UPDATE ON platform.ai_annotations
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.ai_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_annotations FORCE ROW LEVEL SECURITY;

CREATE POLICY ann_platform_only ON platform.ai_annotations
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

CREATE POLICY ann_read ON platform.ai_annotations
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY ann_insert ON platform.ai_annotations
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY ann_update ON platform.ai_annotations
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol     int;
    v_force   boolean;
    v_fk_comp int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'ai_annotations';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'ai_annotations';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    SELECT count(1) INTO v_fk_comp
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'platform' AND t.relname = 'ai_annotations'
       AND c.contype = 'f' AND array_length(c.conkey, 1) = 2;
    IF v_fk_comp <> 2 THEN
        RAISE EXCEPTION 'ai_annotations necesita 2 FK compuestas, tiene %', v_fk_comp;
    END IF;

    RAISE NOTICE 'OK 0030: RLS forzada, 4 políticas, 2 FK compuestas, geometría validada por CHECK';
END
$$;
