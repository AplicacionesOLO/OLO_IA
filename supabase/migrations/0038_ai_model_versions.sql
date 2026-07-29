-- ═══════════════════════════════════════════════════════════════════════════
-- 0038_ai_model_versions.sql
-- Crea     : ai.model_versions + políticas, la FK de ai.models.current_version_id,
--            y amplía ai.validate_model_against_architecture()
-- Depende de: 0037 (models), 0033 (ai.assets)
-- Riesgo   : bajo
--
-- PESOS CONCRETOS. Tres orígenes, y los tres son ciudadanos de primera:
--
--   trained     → entrenamiento propio dentro de la plataforma
--   pretrained  → pesos oficiales de terceros (SAM2, Grounding DINO, CLIP)
--   imported    → pesos que alguien trae de fuera
--
-- ⚠ `run_id` NO SE CREA AQUÍ, Y ES DELIBERADO.
--
--   `ai.training_runs` es del Bloque 4. Una columna `run_id` sin su clave foránea
--   sería una referencia colgante PERMANENTE, no de una migración — el defecto que
--   arrastra `core.users.avatar_file_id` desde la 0010.
--
--   En el Bloque 4 se añaden juntos: la columna, su FK real y el CHECK
--       (origin = 'trained') = (run_id IS NOT NULL)
--
--   Consecuencia útil desde HOY: se puede registrar y publicar un SAM2
--   preentrenado sin nada de infraestructura de entrenamiento.
--
-- ⚠ `weights_asset_id` ES NOT NULL, TAMBIÉN PARA LOS PREENTRENADOS.
--
--   Reproducir un resultado exige los pesos EXACTOS, no el nombre de un fichero
--   que alguien descargó una vez. Implica subirlos a Storage antes de registrar la
--   versión, incluso los oficiales — y eso es lo correcto.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ai.model_versions (
    id                uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id        uuid         NOT NULL,
    model_id          uuid         NOT NULL,

    version           integer      NOT NULL,
    origin            varchar(12)  NOT NULL,

    weights_asset_id  uuid         NOT NULL,
    source_reference  text         NULL,
    notes             text         NULL,

    status            varchar(12)  NOT NULL DEFAULT 'candidate',
    published_at      timestamptz  NULL,
    published_by      uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,

    created_at        timestamptz  NOT NULL DEFAULT now(),
    created_by        uuid         NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    updated_by        uuid         NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version_lock      integer      NOT NULL DEFAULT 1,
    deleted_at        timestamptz  NULL,

    -- FK compuestas: el modelo y los pesos deben ser del MISMO proyecto.
    CONSTRAINT fk_mv_model FOREIGN KEY (project_id, model_id)
        REFERENCES ai.models (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_mv_weights FOREIGN KEY (project_id, weights_asset_id)
        REFERENCES ai.assets (project_id, id) ON DELETE RESTRICT,

    CONSTRAINT uq_mv_version     UNIQUE (model_id, version),
    CONSTRAINT uq_mv_proyecto_id UNIQUE (project_id, id),

    CONSTRAINT chk_mv_version CHECK (version > 0),
    CONSTRAINT chk_mv_lock    CHECK (version_lock >= 1),
    CONSTRAINT chk_mv_origin  CHECK (origin IN ('trained', 'pretrained', 'imported')),
    CONSTRAINT chk_mv_status  CHECK (status IN ('candidate', 'active', 'archived', 'rejected')),

    -- Unos pesos que vienen de fuera deben decir DE DÓNDE. Sin esto, dentro de un
    -- año nadie sabrá qué se publicó.
    CONSTRAINT chk_mv_procedencia CHECK (
        origin = 'trained' OR (source_reference IS NOT NULL
                               AND length(btrim(source_reference)) >= 3)
    ),
    CONSTRAINT chk_mv_publicacion CHECK (
        (published_at IS NULL) = (published_by IS NULL)
    ),
    CONSTRAINT chk_mv_activo_publicado CHECK (
        status <> 'active' OR published_at IS NOT NULL
    )
);

COMMENT ON TABLE ai.model_versions IS
    'Pesos concretos de un modelo. origin: trained | pretrained | imported. run_id llega en el Bloque 4 con su FK.';
COMMENT ON COLUMN ai.model_versions.version_lock IS
    'Bloqueo optimista (ETag). Se llama asi y no `version` porque esa columna ya es el numero de version del modelo.';
COMMENT ON COLUMN ai.model_versions.source_reference IS
    'De donde salieron unos pesos que no entrenamos: URL, release o checksum publicado.';
COMMENT ON COLUMN ai.model_versions.weights_asset_id IS
    'NOT NULL siempre: reproducir exige los pesos exactos, no un nombre. Tambien para los preentrenados.';

-- ⚠ UN SOLO MODELO ACTIVO POR MODELO LÓGICO, GARANTIZADO POR EL MOTOR.
--
--   Es el mecanismo entero de la publicación y del rollback. Dos publicaciones
--   concurrentes y una recibe violación de unicidad, que la API traduce a 409.
--   Ninguna carrera puede dejar dos versiones activas, y el rollback usa la misma
--   operación transaccional que publicar, así que no hay un camino de código
--   distinto que pueda estar roto justo el día que hace falta.
CREATE UNIQUE INDEX uq_mv_activo ON ai.model_versions (model_id)
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX idx_mv_modelo ON ai.model_versions (model_id, version DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_mv_origen ON ai.model_versions (origin);

CREATE TRIGGER trg_mv_updated_at
    BEFORE UPDATE ON ai.model_versions
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── Se cierra la referencia que 0037 dejó abierta ──────────────────────────
ALTER TABLE ai.models
    ADD CONSTRAINT fk_model_current_version
    FOREIGN KEY (current_version_id)
    REFERENCES ai.model_versions(id) ON DELETE SET NULL;

COMMENT ON COLUMN ai.models.current_version_id IS
    'Version activa, desnormalizada para no recorrer todas las versiones en cada lectura. La verdad la impone uq_mv_activo.';


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE ai.model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.model_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY mv_platform_only ON ai.model_versions
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
CREATE POLICY mv_read ON ai.model_versions
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY mv_insert ON ai.model_versions
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY mv_update ON ai.model_versions
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Ampliación del validador: inmutabilidad con versiones existentes ───────
--
-- Ahora que ai.model_versions existe, el validador puede comprobar algo que en
-- 0037 era imposible: que no se cambie la arquitectura de un modelo que ya tiene
-- pesos. Cambiarla invalidaría su interpretación, igual que renumerar class_index.
CREATE OR REPLACE FUNCTION ai.validate_model_against_architecture()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    a RECORD;
    v_versiones int;
BEGIN
    -- ── FASE 1 · Inmutabilidad, ANTES de cualquier comprobación de compatibilidad
    --
    -- El orden importa y la primera versión de esta función lo tenía mal.
    -- Si el modelo ya tiene pesos, el cambio está prohibido de raíz, así que
    -- «arquitectura y tarea son inmutables» es la respuesta correcta. Con el
    -- orden inverso, intentar pasar un modelo `segment` a una arquitectura que
    -- solo hace `detect` devolvía «no soporta la tarea segment»: un mensaje
    -- sobre compatibilidad para una operación que no se permite en ningún caso.
    -- El usuario intentaría entonces encontrar una arquitectura compatible, que
    -- es exactamente el camino equivocado.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.requires_training IS DISTINCT FROM OLD.requires_training THEN
            RAISE EXCEPTION
                'requires_training se deriva de la arquitectura y no se edita'
                USING ERRCODE = 'raise_exception';
        END IF;

        IF NEW.architecture_code IS DISTINCT FROM OLD.architecture_code
           OR NEW.task IS DISTINCT FROM OLD.task THEN
            SELECT count(1) INTO v_versiones
              FROM ai.model_versions
             WHERE model_id = OLD.id AND deleted_at IS NULL;

            IF v_versiones > 0 THEN
                RAISE EXCEPTION
                    'el modelo % ya tiene % version(es) entrenadas o registradas: '
                    'arquitectura y tarea son inmutables. Los pesos existentes '
                    'dejarian de poder interpretarse. Crea un modelo nuevo.',
                    OLD.name, v_versiones
                    USING ERRCODE = 'raise_exception';
            END IF;
        END IF;
    END IF;

    -- ── FASE 2 · Compatibilidad contra el catálogo de capacidades
    SELECT framework_code, supported_tasks, supported_input_types,
           requires_training, is_active
      INTO a
      FROM ai.architectures
     WHERE code = NEW.architecture_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'la arquitectura % no existe en el catalogo', NEW.architecture_code
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NOT a.is_active AND (TG_OP = 'INSERT'
                            OR NEW.architecture_code IS DISTINCT FROM OLD.architecture_code) THEN
        RAISE EXCEPTION 'la arquitectura % esta desactivada', NEW.architecture_code
            USING ERRCODE = 'raise_exception';
    END IF;

    IF NEW.framework_code IS DISTINCT FROM a.framework_code THEN
        RAISE EXCEPTION
            'framework incoherente: % declara %, la arquitectura % pertenece a %',
            NEW.name, NEW.framework_code, NEW.architecture_code, a.framework_code
            USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT (NEW.task = ANY (a.supported_tasks)) THEN
        RAISE EXCEPTION
            'la arquitectura % no soporta la tarea "%". Soporta: %',
            NEW.architecture_code, NEW.task, array_to_string(a.supported_tasks, ', ')
            USING ERRCODE = 'raise_exception';
    END IF;

    IF NOT (NEW.input_type = ANY (a.supported_input_types)) THEN
        RAISE EXCEPTION
            'la arquitectura % no soporta la entrada "%". Soporta: %',
            NEW.architecture_code, NEW.input_type,
            array_to_string(a.supported_input_types, ', ')
            USING ERRCODE = 'raise_exception';
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.requires_training := a.requires_training;
    END IF;

    RETURN NEW;
END
$$;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol    int;
    v_force  boolean;
    v_owner  uuid;
    v_proj   uuid;
    v_model  uuid;
    v_asset  uuid;
    v_v1     uuid;
    v_ok     int := 0;
    v_cols   int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relname = 'model_versions';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'ai' AND tablename = 'model_versions';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    -- `run_id` NO debe existir todavía (decisión A).
    SELECT count(1) INTO v_cols FROM information_schema.columns
     WHERE table_schema = 'ai' AND table_name = 'model_versions' AND column_name = 'run_id';
    IF v_cols <> 0 THEN
        RAISE EXCEPTION 'run_id no debe existir hasta el Bloque 4, con su FK';
    END IF;

    -- La FK que 0037 dejó pendiente
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_model_current_version'
    ) THEN
        RAISE EXCEPTION 'falta la FK de ai.models.current_version_id';
    END IF;

    SELECT id INTO v_owner FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;
    IF v_owner IS NULL THEN
        RAISE NOTICE 'AVISO: sin usuario owner, se omiten las pruebas vivas';
        RETURN;
    END IF;

    INSERT INTO ai.projects (name, slug, created_by)
    VALUES ('Verif 0038', 'verif-0038', v_owner) RETURNING id INTO v_proj;

    INSERT INTO ai.assets (project_id, kind, bucket, object_path, original_filename,
                           content_type, bytes, sha256, created_by)
    VALUES (v_proj, 'weights', 'ai-weights', 'verif/0038/best.pt', 'best.pt',
            'application/octet-stream', 1024, repeat('d', 64), v_owner)
    RETURNING id INTO v_asset;

    INSERT INTO ai.models (project_id, name, slug, framework_code, architecture_code,
                           task, input_type, requires_training, created_by)
    VALUES (v_proj, 'SAM verif', 'sam-verif', 'pytorch', 'sam2-b',
            'segment', 'image', false, v_owner)
    RETURNING id INTO v_model;

    -- 1 · pretrained sin entrenamiento: DEBE poder registrarse (decisión 9)
    INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                   weights_asset_id, source_reference, created_by)
    VALUES (v_proj, v_model, 1, 'pretrained', v_asset,
            'https://ai.meta.com/sam2 · sam2_hiera_base_plus.pt', v_owner)
    RETURNING id INTO v_v1;
    v_ok := v_ok + 1;

    -- 2 · imported sin procedencia: rechazado
    BEGIN
        INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                       weights_asset_id, created_by)
        VALUES (v_proj, v_model, 2, 'imported', v_asset, v_owner);
        RAISE EXCEPTION 'se acepto una version importada sin source_reference';
    EXCEPTION WHEN check_violation THEN
        v_ok := v_ok + 1;
    END;

    -- 3 · dos activas del mismo modelo: rechazado por el índice parcial
    UPDATE ai.model_versions
       SET status = 'active', published_at = now(), published_by = v_owner
     WHERE id = v_v1;
    INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                   weights_asset_id, source_reference, status,
                                   published_at, published_by, created_by)
    VALUES (v_proj, v_model, 3, 'imported', v_asset, 'importado a mano',
            'candidate', NULL, NULL, v_owner);
    BEGIN
        UPDATE ai.model_versions
           SET status = 'active', published_at = now(), published_by = v_owner
         WHERE model_id = v_model AND version = 3;
        RAISE EXCEPTION 'se permitieron DOS versiones activas del mismo modelo';
    EXCEPTION WHEN unique_violation THEN
        v_ok := v_ok + 1;
    END;

    -- 4 · cambiar la arquitectura con versiones existentes: rechazado
    BEGIN
        UPDATE ai.models
           SET architecture_code = 'florence-2-base'
         WHERE id = v_model;
        RAISE EXCEPTION 'se permitio cambiar la arquitectura con versiones existentes';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%inmutables%' THEN v_ok := v_ok + 1; ELSE RAISE; END IF;
    END;

    -- Limpieza
    UPDATE ai.models SET current_version_id = NULL WHERE id = v_model;
    DELETE FROM ai.model_versions WHERE project_id = v_proj;
    DELETE FROM ai.models         WHERE project_id = v_proj;
    DELETE FROM ai.assets         WHERE project_id = v_proj;
    DELETE FROM ai.projects       WHERE id = v_proj;

    IF v_ok <> 4 THEN RAISE EXCEPTION 'solo % de 4 comprobaciones vivas pasaron', v_ok; END IF;

    RAISE NOTICE
        'OK 0038: RLS forzada, 4 politicas, sin run_id, FK de current_version_id, y verificado en vivo: pretrained sin entrenamiento, procedencia obligatoria, un solo activo, arquitectura inmutable';
END
$$;
