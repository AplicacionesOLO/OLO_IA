-- ═══════════════════════════════════════════════════════════════════════════
-- 0027_ai_assets.sql
-- Crea     : platform.ai_assets + políticas RLS + trigger de updated_at
-- Depende de: 0025
-- Riesgo   : bajo
--
-- SOLO METADATOS (decisión 13). Ningún binario en PostgreSQL: el contenido vive
-- en Supabase Storage y aquí queda su ficha. El acceso a Storage es por API y
-- URLs firmadas (decisión 14) — `olo_app` no tiene USAGE sobre el schema
-- `storage` (medido), así que por SQL no sería posible ni queriéndolo.
--
-- SEPARADO DE ai_images a propósito. Un vídeo no es una imagen del dataset, y
-- una imagen tiene miniaturas que no son items entrenables. Una sola tabla
-- obligaría a que la mitad de las columnas fueran nullable y a distinguir los
-- casos por convención en lugar de por CHECK.
--
-- `object_path` la GENERA el servidor a partir de UUIDs. El nombre que subió el
-- usuario se guarda solo como dato para poder mostrarlo. Aceptarlo en la ruta
-- invitaría a path traversal y a colisiones.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.ai_assets (
    id                 uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id         uuid         NOT NULL
                                    REFERENCES platform.ai_projects(id) ON DELETE RESTRICT,

    kind               varchar(20)  NOT NULL,
    bucket             varchar(63)  NOT NULL,
    object_path        text         NOT NULL,
    original_filename  text         NOT NULL,
    content_type       varchar(100) NOT NULL,
    bytes              bigint       NOT NULL,
    sha256             char(64)     NOT NULL,

    width              integer      NULL,
    height             integer      NULL,
    duration_ms        integer      NULL,

    uploaded_at        timestamptz  NOT NULL DEFAULT now(),

    created_at         timestamptz  NOT NULL DEFAULT now(),
    created_by         uuid         NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    updated_by         uuid         NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version            integer      NOT NULL DEFAULT 1,
    deleted_at         timestamptz  NULL,

    CONSTRAINT chk_asset_kind CHECK (kind IN
        ('image', 'video', 'frame', 'thumbnail', 'weights', 'run_artifact')),
    CONSTRAINT chk_asset_bytes   CHECK (bytes > 0),
    CONSTRAINT chk_asset_sha256  CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_asset_version CHECK (version >= 1),
    CONSTRAINT chk_asset_dims    CHECK (
        (width IS NULL) = (height IS NULL)
        AND (width  IS NULL OR width  > 0)
        AND (height IS NULL OR height > 0)
    ),
    -- Un vídeo sin duración no permite calcular cuántos frames se extraerán ni
    -- validar el máximo del proyecto.
    CONSTRAINT chk_asset_video_duracion CHECK (
        kind <> 'video' OR duration_ms IS NOT NULL
    ),
    CONSTRAINT chk_asset_duracion_positiva CHECK (
        duration_ms IS NULL OR duration_ms > 0
    ),

    -- Destino de las FK compuestas de ai_images (0028).
    CONSTRAINT uq_asset_proyecto_id UNIQUE (project_id, id),

    -- Un objeto de Storage se registra una sola vez.
    CONSTRAINT uq_asset_objeto UNIQUE (bucket, object_path)
);

COMMENT ON TABLE platform.ai_assets IS
    'Ficha de cada binario en Supabase Storage. PostgreSQL guarda metadatos, nunca contenido.';
COMMENT ON COLUMN platform.ai_assets.object_path IS
    'Ruta canonica generada por el servidor a partir de UUIDs. Nunca derivada del nombre del usuario.';
COMMENT ON COLUMN platform.ai_assets.sha256 IS
    'Hash del contenido. Base de la deduplicacion: la misma imagen dos veces produciria fuga entre train y val.';

-- ⚠ DEDUPLICACIÓN POR CONTENIDO.
--
--   La misma foto subida dos veces con nombres distintos entraría dos veces en
--   el dataset: una podría acabar en `train` y otra en `val`, y eso es FUGA DE
--   DATOS — el modelo puntúa alto contra material que ya vio. Es un fallo cuyo
--   único síntoma son métricas demasiado buenas, así que conviene que el motor
--   lo impida y no una comprobación de aplicación que alguien pueda saltarse.
--
--   Solo aplica a imágenes y frames: dos miniaturas idénticas de imágenes
--   distintas son legítimas, y dos ficheros de pesos pueden coincidir.
CREATE UNIQUE INDEX uq_asset_contenido ON platform.ai_assets (project_id, sha256)
    WHERE kind IN ('image', 'frame') AND deleted_at IS NULL;

CREATE INDEX idx_asset_proyecto_kind ON platform.ai_assets (project_id, kind)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_asset_updated_at
    BEFORE UPDATE ON platform.ai_assets
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.ai_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY asset_platform_only ON platform.ai_assets
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

CREATE POLICY asset_read ON platform.ai_assets
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY asset_insert ON platform.ai_assets
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY asset_update ON platform.ai_assets
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol   int;
    v_force boolean;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'ai_assets';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'ai_assets';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
         WHERE schemaname = 'platform' AND indexname = 'uq_asset_contenido'
    ) THEN
        RAISE EXCEPTION 'falta el índice de deduplicación por sha256';
    END IF;

    RAISE NOTICE 'OK 0027: RLS forzada, 4 políticas, deduplicación por contenido activa';
END
$$;
