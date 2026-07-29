-- ═══════════════════════════════════════════════════════════════════════════
-- 0028_ai_images.sql
-- Crea     : platform.ai_images + políticas RLS + trigger de updated_at
-- Depende de: 0027 (ai_assets), 0025 (ai_projects)
-- Riesgo   : bajo
--
-- ⚠ `entrenada` NO ESTÁ EN LA LISTA DE ESTADOS (decisión 7).
--
--   Los cuatro primeros estados y `archived` son propiedades de la imagen.
--   «Entrenada» no lo es: es propiedad de la relación (imagen, versión de
--   dataset). El caso que lo rompe es rutinario — una imagen entra en el dataset
--   v1, se entrena, queda «entrenada»; luego se ve que su anotación estaba mal,
--   se corrige y entra en el v2. Cierto para v1, falso para v2. Un campo no
--   puede representarlo y en la práctica se queda pegado y deja de reflejar la
--   realidad.
--
--   Se derivará: existe fila en ai_dataset_items de una versión con un
--   entrenamiento exitoso. Siempre exacto, imposible de desincronizar.
--
-- ⚠ FK COMPUESTAS, no simples.
--
--   `(project_id, asset_id) → ai_assets(project_id, id)` es lo que impide que una
--   imagen del proyecto A apunte a un asset del proyecto B. Con una FK simple a
--   `ai_assets(id)` nada lo detendría. Es el mecanismo verificado empíricamente
--   en la fase 0 como garantía de integridad jerárquica.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.ai_images (
    id                     uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id             uuid        NOT NULL
                                       REFERENCES platform.ai_projects(id) ON DELETE RESTRICT,

    asset_id               uuid        NOT NULL,

    source                 varchar(10) NOT NULL,
    source_video_asset_id  uuid        NULL,
    frame_index            integer     NULL,
    frame_timestamp_ms     integer     NULL,

    status                 varchar(16) NOT NULL DEFAULT 'pending',

    annotated_by           uuid        NULL REFERENCES core.users(id) ON DELETE SET NULL,
    annotated_at           timestamptz NULL,
    reviewed_by            uuid        NULL REFERENCES core.users(id) ON DELETE SET NULL,
    reviewed_at            timestamptz NULL,

    created_at             timestamptz NOT NULL DEFAULT now(),
    created_by             uuid        NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at             timestamptz NOT NULL DEFAULT now(),
    updated_by             uuid        NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version                integer     NOT NULL DEFAULT 1,
    deleted_at             timestamptz NULL,

    -- FK compuestas: el asset y el vídeo de origen deben ser del MISMO proyecto.
    CONSTRAINT fk_img_asset FOREIGN KEY (project_id, asset_id)
        REFERENCES platform.ai_assets (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_img_video FOREIGN KEY (project_id, source_video_asset_id)
        REFERENCES platform.ai_assets (project_id, id) ON DELETE RESTRICT,

    -- Destino de las FK compuestas de ai_dataset_items y ai_annotations.
    CONSTRAINT uq_img_proyecto_id UNIQUE (project_id, id),

    -- Un asset es exactamente una imagen del dataset, no varias.
    CONSTRAINT uq_img_asset UNIQUE (asset_id),

    CONSTRAINT chk_img_source CHECK (source IN ('upload', 'frame')),
    CONSTRAINT chk_img_status CHECK (status IN
        ('pending', 'annotated', 'validated', 'rejected', 'archived')),
    CONSTRAINT chk_img_version CHECK (version >= 1),

    -- Los tres campos de frame van juntos o no van. `=` entre booleanos es una
    -- equivalencia estricta: no basta con que no se contradigan.
    CONSTRAINT chk_img_frame_coherente CHECK (
        (source = 'frame') = (source_video_asset_id IS NOT NULL)
        AND (source = 'frame') = (frame_index IS NOT NULL)
        AND (source = 'frame') = (frame_timestamp_ms IS NOT NULL)
    ),
    CONSTRAINT chk_img_frame_indice CHECK (
        frame_index IS NULL OR frame_index >= 0
    ),
    CONSTRAINT chk_img_frame_ts CHECK (
        frame_timestamp_ms IS NULL OR frame_timestamp_ms >= 0
    ),

    -- Coherencia entre estado y quién actuó: no se puede estar `annotated` sin
    -- que conste quién anotó.
    CONSTRAINT chk_img_anotador CHECK (
        (annotated_by IS NULL) = (annotated_at IS NULL)
    ),
    CONSTRAINT chk_img_revisor CHECK (
        (reviewed_by IS NULL) = (reviewed_at IS NULL)
    )
);

COMMENT ON TABLE platform.ai_images IS
    'Imagen anotable y entrenable. El estado NO incluye "entrenada": eso se deriva de ai_dataset_items.';
COMMENT ON COLUMN platform.ai_images.status IS
    'pending -> annotated -> validated (o rejected) -> archived. Solo validated entra en una version de dataset.';
COMMENT ON COLUMN platform.ai_images.source_video_asset_id IS
    'Trazabilidad frame -> video. Permite descartar de golpe todos los frames de un video mal grabado.';

-- Un vídeo no puede producir dos veces el mismo frame.
CREATE UNIQUE INDEX uq_img_frame ON platform.ai_images (source_video_asset_id, frame_index)
    WHERE source = 'frame' AND deleted_at IS NULL;

CREATE INDEX idx_img_estado ON platform.ai_images (project_id, status)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_img_updated_at
    BEFORE UPDATE ON platform.ai_images
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.ai_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_images FORCE ROW LEVEL SECURITY;

CREATE POLICY img_platform_only ON platform.ai_images
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

CREATE POLICY img_read ON platform.ai_images
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY img_insert ON platform.ai_images
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY img_update ON platform.ai_images
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol      int;
    v_force    boolean;
    v_fk_comp  int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'ai_images';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'ai_images';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    -- Las FK deben ser de DOS columnas. Una FK simple compilaría igual y dejaría
    -- pasar referencias cruzadas entre proyectos, así que se comprueba la aridad.
    SELECT count(1) INTO v_fk_comp
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'platform' AND t.relname = 'ai_images'
       AND c.contype = 'f' AND array_length(c.conkey, 1) = 2;

    IF v_fk_comp <> 2 THEN
        RAISE EXCEPTION
            'se esperaban 2 FK compuestas de 2 columnas, hay %', v_fk_comp;
    END IF;

    -- El estado 'trained' no debe existir: si alguien lo añade, la decisión 7
    -- se rompió y hay que enterarse aquí.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_img_status'
           AND pg_get_constraintdef(oid) ILIKE '%trained%'
    ) THEN
        RAISE EXCEPTION 'el estado "trained" no debe existir en ai_images (decisión 7)';
    END IF;

    RAISE NOTICE 'OK 0028: RLS forzada, 4 políticas, 2 FK compuestas, sin estado "trained"';
END
$$;
