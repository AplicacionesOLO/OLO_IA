-- ═══════════════════════════════════════════════════════════════════════════
-- 0029_ai_dataset_versions.sql
-- Crea     : platform.ai_dataset_versions, platform.ai_dataset_items,
--            platform.reject_frozen_dataset_change() + triggers, políticas RLS
-- Depende de: 0028 (ai_images), 0026 (ai_classes), 0025 (ai_projects)
-- Riesgo   : medio — dos tablas, cuatro FK compuestas y dos triggers
--
-- ⚠ POR QUÉ LA INMUTABILIDAD NECESITA TRIGGER Y NO SOLO AUSENCIA DE POLÍTICA.
--
--   Una tabla con RLS y sin política de UPDATE no RECHAZA el UPDATE: lo deja en
--   CERO FILAS AFECTADAS, en silencio. Se comprobó en este mismo proyecto al
--   corregir un nombre en core.users — el UPDATE devolvió 0 filas en lugar de
--   fallar.
--
--   Para un dataset congelado eso es insuficiente: quien intente modificarlo
--   debe recibir un error, no creer que funcionó. Van las dos capas:
--     · sin políticas de UPDATE/DELETE → protege de olo_app
--     · trigger que aborta            → protege también de postgres, que tiene
--                                        rolbypassrls y por tanto ignora RLS
--
-- ⚠ POR QUÉ LOS SPLITS SE CONGELAN (decisión 5).
--
--   Si el reparto train/val/test se sortea en cada entrenamiento, dos runs «con
--   la misma configuración» miden cosas distintas y comparar sus mAP no dice
--   nada. Peor: la misma imagen cae en `train` en uno y en `val` en otro, así que
--   el segundo puntúa contra material que el primero ya usó.
--
--   Cada entrenamiento apuntará a EXACTAMENTE una versión de dataset. Eso, y solo
--   eso, permite afirmar «la v3 es mejor que la v2».
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.ai_dataset_versions (
    id              uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid         NOT NULL
                                 REFERENCES platform.ai_projects(id) ON DELETE RESTRICT,

    version         integer      NOT NULL,
    name            varchar(120) NULL,
    notes           text         NULL,

    -- Vocabulario congelado: [{"index": 0, "name": "pallet"}, …]. Es lo que
    -- permite interpretar un modelo con las clases que realmente usó, aunque
    -- después se desactiven o se añadan otras.
    class_snapshot  jsonb        NOT NULL,

    image_count     integer      NOT NULL,
    train_count     integer      NOT NULL,
    val_count       integer      NOT NULL,
    test_count      integer      NOT NULL,
    split_seed      integer      NOT NULL,

    frozen_at       timestamptz  NOT NULL DEFAULT now(),
    created_at      timestamptz  NOT NULL DEFAULT now(),
    created_by      uuid         NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,

    CONSTRAINT uq_dsv_version     UNIQUE (project_id, version),
    CONSTRAINT uq_dsv_proyecto_id UNIQUE (project_id, id),

    CONSTRAINT chk_dsv_version CHECK (version > 0),
    CONSTRAINT chk_dsv_suma    CHECK (image_count = train_count + val_count + test_count),
    CONSTRAINT chk_dsv_no_negativos CHECK (
        image_count >= 0 AND train_count >= 0 AND val_count >= 0 AND test_count >= 0
    ),
    CONSTRAINT chk_dsv_snapshot_array CHECK (jsonb_typeof(class_snapshot) = 'array'),
    -- Un dataset sin clases no puede entrenar nada.
    CONSTRAINT chk_dsv_snapshot_no_vacio CHECK (jsonb_array_length(class_snapshot) > 0)
);

COMMENT ON TABLE platform.ai_dataset_versions IS
    'Instantanea INMUTABLE de un dataset. Un entrenamiento apunta a exactamente una: es lo que hace comparables dos modelos.';
COMMENT ON COLUMN platform.ai_dataset_versions.class_snapshot IS
    'Lista congelada [{index,name}]. Los pesos YOLO guardan indices; sin esto no se podria interpretar un modelo antiguo.';
COMMENT ON COLUMN platform.ai_dataset_versions.split_seed IS
    'Semilla del reparto. Se guarda para poder reproducirlo, no para volver a sortearlo.';

-- Sin trigger de updated_at: la tabla no se actualiza nunca.


CREATE TABLE platform.ai_dataset_items (
    dataset_version_id  uuid       NOT NULL,
    image_id            uuid       NOT NULL,
    project_id          uuid       NOT NULL,
    split               varchar(5) NOT NULL,

    PRIMARY KEY (dataset_version_id, image_id),

    -- FK compuestas: la versión y la imagen deben ser del MISMO proyecto.
    CONSTRAINT fk_dsi_version FOREIGN KEY (project_id, dataset_version_id)
        REFERENCES platform.ai_dataset_versions (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_dsi_image FOREIGN KEY (project_id, image_id)
        REFERENCES platform.ai_images (project_id, id) ON DELETE RESTRICT,

    CONSTRAINT chk_dsi_split CHECK (split IN ('train', 'val', 'test'))
);

COMMENT ON TABLE platform.ai_dataset_items IS
    'Pertenencia imagen -> version de dataset, con su split congelado. De aqui se DERIVA si una imagen esta entrenada.';

CREATE INDEX idx_dsi_split ON platform.ai_dataset_items (dataset_version_id, split);
CREATE INDEX idx_dsi_imagen ON platform.ai_dataset_items (image_id);


-- ── La guarda de inmutabilidad ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION platform.reject_frozen_dataset_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'Una version de dataset es inmutable una vez creada (tabla %, operacion %). '
        'Congelar el reparto train/val/test es lo que hace reproducible un '
        'entrenamiento y comparables dos modelos. Crea una version nueva.',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'raise_exception';
END
$$;

COMMENT ON FUNCTION platform.reject_frozen_dataset_change() IS
    'Aborta UPDATE y DELETE. Sin politica RLS el UPDATE quedaria en 0 filas EN SILENCIO, que no es lo mismo que rechazado.';

CREATE TRIGGER trg_dsv_inmutable
    BEFORE UPDATE OR DELETE ON platform.ai_dataset_versions
    FOR EACH ROW EXECUTE FUNCTION platform.reject_frozen_dataset_change();

CREATE TRIGGER trg_dsi_inmutable
    BEFORE UPDATE OR DELETE ON platform.ai_dataset_items
    FOR EACH ROW EXECUTE FUNCTION platform.reject_frozen_dataset_change();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.ai_dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_dataset_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_dataset_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_dataset_items    FORCE ROW LEVEL SECURITY;

CREATE POLICY dsv_platform_only ON platform.ai_dataset_versions
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
CREATE POLICY dsv_read ON platform.ai_dataset_versions
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY dsv_insert ON platform.ai_dataset_versions
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);

CREATE POLICY dsi_platform_only ON platform.ai_dataset_items
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
CREATE POLICY dsi_read ON platform.ai_dataset_items
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY dsi_insert ON platform.ai_dataset_items
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);

-- Ninguna política de UPDATE ni DELETE en las dos tablas: es la inmutabilidad.


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_mut      int;
    v_force    int;
    v_fk_comp  int;
BEGIN
    SELECT count(1) INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform'
       AND c.relname IN ('ai_dataset_versions', 'ai_dataset_items')
       AND c.relforcerowsecurity;
    IF v_force <> 2 THEN
        RAISE EXCEPTION 'las dos tablas necesitan FORCE RLS, la tienen %', v_force;
    END IF;

    SELECT count(1) INTO v_mut FROM pg_policies
     WHERE schemaname = 'platform'
       AND tablename IN ('ai_dataset_versions', 'ai_dataset_items')
       AND cmd IN ('UPDATE', 'DELETE');
    IF v_mut <> 0 THEN
        RAISE EXCEPTION 'un dataset congelado no admite políticas de mutación, hay %', v_mut;
    END IF;

    SELECT count(1) INTO v_fk_comp
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'platform' AND t.relname = 'ai_dataset_items'
       AND c.contype = 'f' AND array_length(c.conkey, 1) = 2;
    IF v_fk_comp <> 2 THEN
        RAISE EXCEPTION 'ai_dataset_items necesita 2 FK compuestas, tiene %', v_fk_comp;
    END IF;

    IF (SELECT count(1) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'platform'
           AND t.tgname IN ('trg_dsv_inmutable', 'trg_dsi_inmutable')) <> 2 THEN
        RAISE EXCEPTION 'faltan los triggers de inmutabilidad';
    END IF;

    RAISE NOTICE 'OK 0029: 2 tablas con FORCE RLS, 0 políticas de mutación, 2 FK compuestas, 2 triggers de inmutabilidad';
END
$$;
