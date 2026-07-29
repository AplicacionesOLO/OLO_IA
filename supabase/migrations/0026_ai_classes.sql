-- ═══════════════════════════════════════════════════════════════════════════
-- 0026_ai_classes.sql
-- Crea     : platform.ai_classes, platform.prevent_class_index_change() +
--            trigger, políticas RLS
-- Depende de: 0025
-- Riesgo   : bajo
--
-- ⚠ POR QUÉ `class_index` ES INMUTABLE (decisión 4). Es la trampa menos evidente
--   de todo el módulo, y la más peligrosa, porque NO PRODUCE NINGÚN ERROR.
--
--   Los pesos de YOLO no guardan nombres de clase: guardan ÍNDICES. Un modelo
--   entrenado con `0=pallet, 1=caja` y consultado después en un proyecto donde
--   alguien borró `pallet` —y `caja` pasó a ser 0— devuelve «caja» donde detecta
--   pallets. No falla, no avisa: MIENTE.
--
--   No basta con no exponer el campo en la API. La única defensa fiable está en
--   el motor, porque una migración futura, un script de corrección o una
--   consulta manual pueden cambiarlo igual.
--
--   De ahí las tres reglas:
--     1. `class_index` se asigna al crear y nunca se modifica ni se reutiliza.
--     2. Las clases se DESACTIVAN (is_active = false), no se renumeran.
--     3. Cada versión de dataset congela la lista de clases (0029), así que un
--        modelo siempre se puede interpretar con el vocabulario que usó.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE platform.ai_classes (
    id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id   uuid        NOT NULL
                             REFERENCES platform.ai_projects(id) ON DELETE RESTRICT,

    name         varchar(60) NOT NULL,
    class_index  smallint    NOT NULL,
    color        char(7)     NOT NULL,
    description  text        NULL,
    is_active    boolean     NOT NULL DEFAULT true,

    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid        NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid        NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version      integer     NOT NULL DEFAULT 1,
    deleted_at   timestamptz NULL,

    CONSTRAINT chk_class_index  CHECK (class_index >= 0),
    CONSTRAINT chk_class_name   CHECK (length(btrim(name)) >= 1),
    CONSTRAINT chk_class_color  CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT chk_class_version CHECK (version >= 1),

    -- Destino de las FK compuestas de ai_annotations (0030). Es lo que impide que
    -- una anotación de un proyecto apunte a una clase de otro.
    CONSTRAINT uq_class_proyecto_id UNIQUE (project_id, id),

    -- El índice YOLO es único por proyecto y NO se reutiliza aunque la clase se
    -- borre lógicamente: por eso no lleva el filtro `WHERE deleted_at IS NULL`.
    CONSTRAINT uq_class_indice UNIQUE (project_id, class_index)
);

COMMENT ON TABLE platform.ai_classes IS
    'Clases del proyecto. class_index es el indice YOLO: INMUTABLE y no reutilizable.';
COMMENT ON COLUMN platform.ai_classes.class_index IS
    'Indice que los pesos YOLO guardan. Renumerarlo hace que un modelo entrenado devuelva la etiqueta equivocada sin error alguno.';
COMMENT ON COLUMN platform.ai_classes.is_active IS
    'Desactivar es la via correcta de retirar una clase. Excluye sus anotaciones de datasets FUTUROS; no altera los ya congelados.';

-- El nombre sí puede liberarse al borrar: solo es etiqueta legible.
CREATE UNIQUE INDEX uq_class_nombre ON platform.ai_classes (project_id, name)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_class_activas ON platform.ai_classes (project_id, class_index)
    WHERE is_active AND deleted_at IS NULL;

CREATE TRIGGER trg_class_updated_at
    BEFORE UPDATE ON platform.ai_classes
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── La guarda de inmutabilidad ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION platform.prevent_class_index_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.class_index IS DISTINCT FROM OLD.class_index THEN
        RAISE EXCEPTION
            'class_index es inmutable (clase %, % -> %). Los pesos YOLO guardan '
            'indices, no nombres: renumerar hace que un modelo entrenado devuelva '
            'la etiqueta equivocada sin producir ningun error. Desactiva la clase '
            'en lugar de renumerarla.',
            OLD.id, OLD.class_index, NEW.class_index
            USING ERRCODE = 'raise_exception';
    END IF;

    -- El proyecto tampoco: mover una clase de proyecto invalidaría todas sus
    -- anotaciones y los datasets congelados que la incluyan.
    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'project_id de una clase es inmutable'
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION platform.prevent_class_index_change() IS
    'Inmutabilidad de class_index y project_id. En el motor y no solo en la API: una migracion o un script manual pueden cambiarlo igual.';

CREATE TRIGGER trg_class_index_inmutable
    BEFORE UPDATE ON platform.ai_classes
    FOR EACH ROW
    EXECUTE FUNCTION platform.prevent_class_index_change();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE platform.ai_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_classes FORCE ROW LEVEL SECURITY;

CREATE POLICY class_platform_only ON platform.ai_classes
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

CREATE POLICY class_read ON platform.ai_classes
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY class_insert ON platform.ai_classes
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY class_update ON platform.ai_classes
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol   int;
    v_force boolean;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'ai_classes';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename = 'ai_classes';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'platform' AND c.relname = 'ai_classes'
           AND t.tgname = 'trg_class_index_inmutable'
    ) THEN
        RAISE EXCEPTION 'falta el trigger de inmutabilidad de class_index';
    END IF;

    RAISE NOTICE 'OK 0026: RLS forzada, 4 políticas, trigger de inmutabilidad presente';
END
$$;
