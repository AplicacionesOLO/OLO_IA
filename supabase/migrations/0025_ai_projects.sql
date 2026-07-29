-- ═══════════════════════════════════════════════════════════════════════════
-- 0025_ai_projects.sql
-- Crea     : platform.ai_projects + políticas RLS + trigger de updated_at
-- Depende de: 0019, 0020 (core.is_platform_owner), 0010 (core.users),
--             0005 (core.set_updated_at)
-- Riesgo   : bajo
--
-- Sobre «versión» de la especificación: un proyecto no tiene versión propia. Lo
-- que se versiona es el MODELO y el DATASET. La columna `version` de aquí es el
-- entero de bloqueo optimista que viaja como ETag, igual que en el resto del
-- esquema.
--
-- `current_model_version_id` NO se crea todavía: apuntaría a
-- platform.ai_model_versions, del bloque de modelos. Se añadirá con un ALTER
-- entonces. Crear la columna ahora sin la FK sería una referencia colgante como
-- la de core.users.avatar_file_id, que apunta a una tabla que nunca se creó.
--
-- CONFIGURACIÓN DE FRAMES POR PROYECTO, no límite global rígido (decisión
-- operativa). Los defaults son los valores iniciales acordados: 1 frame por
-- segundo, 1000 frames por vídeo, 20 minutos de duración máxima. Los CHECK son
-- topes de cordura, no política.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.ai_projects (
    id           uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),

    name         varchar(120) NOT NULL,
    slug         varchar(120) NOT NULL,
    description  text         NULL,

    base_model   varchar(60)  NOT NULL,
    task         varchar(20)  NOT NULL DEFAULT 'detect',
    status       varchar(24)  NOT NULL DEFAULT 'draft',

    -- Extracción de frames
    frame_interval_seconds  numeric(6,3) NOT NULL DEFAULT 1.0,
    max_frames_per_video    integer      NOT NULL DEFAULT 1000,
    max_video_duration_secs integer      NOT NULL DEFAULT 1200,

    -- Auditoría de la casa
    created_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   uuid         NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    updated_by   uuid         NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version      integer      NOT NULL DEFAULT 1,
    deleted_at   timestamptz  NULL,

    -- `task` existe desde el principio aunque solo implementemos 'detect':
    -- determina la forma de las anotaciones y de los pesos, y añadirlo después
    -- obligaría a reinterpretar filas existentes.
    CONSTRAINT chk_proj_task   CHECK (task IN ('detect', 'segment', 'pose')),
    CONSTRAINT chk_proj_status CHECK (status IN (
        'draft', 'collecting', 'annotating', 'training', 'published', 'archived')),
    CONSTRAINT chk_proj_slug   CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT chk_proj_name   CHECK (length(btrim(name)) >= 2),
    CONSTRAINT chk_proj_version CHECK (version >= 1),

    CONSTRAINT chk_proj_frame_interval
        CHECK (frame_interval_seconds > 0 AND frame_interval_seconds <= 60),
    CONSTRAINT chk_proj_max_frames
        CHECK (max_frames_per_video BETWEEN 1 AND 100000),
    CONSTRAINT chk_proj_max_duracion
        CHECK (max_video_duration_secs BETWEEN 1 AND 7200)
);

COMMENT ON TABLE platform.ai_projects IS
    'Proyecto de entrenamiento YOLO. Alcance PLATAFORMA: sin tenant_id, aislado por core.is_platform_owner().';
COMMENT ON COLUMN platform.ai_projects.version IS
    'Bloqueo optimista (ETag/If-Match). NO es la version del modelo ni del dataset.';
COMMENT ON COLUMN platform.ai_projects.frame_interval_seconds IS
    'Segundos entre frames extraidos. Por proyecto, no global. Default 1.0 = 1 fps.';

-- Slug único solo entre los vivos: borrar un proyecto libera su slug.
CREATE UNIQUE INDEX uq_proj_slug ON platform.ai_projects (slug)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_proj_status ON platform.ai_projects (status)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_proj_updated_at
    BEFORE UPDATE ON platform.ai_projects
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.ai_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_projects FORCE ROW LEVEL SECURITY;

CREATE POLICY proj_platform_only ON platform.ai_projects
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

CREATE POLICY proj_read ON platform.ai_projects
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY proj_insert ON platform.ai_projects
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY proj_update ON platform.ai_projects
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);

-- Sin DELETE: el borrado es lógico, vía deleted_at.


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_force boolean;
    v_pol   int;
    v_grant boolean;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'ai_projects';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'ai_projects';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    -- Comprueba que el ALTER DEFAULT PRIVILEGES de 0019 surtió efecto de verdad.
    -- Si se hubiera omitido `FOR ROLE postgres`, esta tabla habría nacido sin
    -- permisos para olo_app y el fallo aparecería en el primer endpoint.
    SELECT has_table_privilege('olo_app', 'platform.ai_projects', 'SELECT')
      INTO v_grant;
    IF NOT v_grant THEN
        RAISE EXCEPTION 'olo_app no tiene SELECT: los default privileges de 0019 no se aplicaron';
    END IF;

    RAISE NOTICE 'OK 0025: RLS forzada, 4 políticas, olo_app con privilegios heredados de 0019';
END
$$;
