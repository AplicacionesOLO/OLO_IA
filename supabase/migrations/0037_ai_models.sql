-- ═══════════════════════════════════════════════════════════════════════════
-- 0037_ai_models.sql
-- Crea     : ai.models, ai.validate_model_against_architecture() + trigger,
--            políticas RLS
-- Depende de: 0036 (architectures), 0033 (ai.projects), 0010 (core.users)
-- Riesgo   : medio — trigger con validación entre tablas
--
-- EL MODELO LÓGICO. No representa unos pesos: representa «qué queremos que el
-- sistema sepa hacer». Los pesos son ai.model_versions.
--
-- Un proyecto tiene VARIOS modelos sobre el mismo pool de imágenes y el mismo
-- vocabulario de clases:
--     Inventario EPA
--       ├─ Detector YOLO      (detect,   yolo11m)
--       ├─ Detector RT-DETR   (detect,   rtdetr-l)   ← compara con el anterior
--       ├─ Segmentador SAM    (segment,  sam2-b)     ← sin entrenamiento
--       ├─ OCR de etiquetas   (ocr,      florence-2-base)
--       └─ Clasificador       (classify, yolo11s)
--
-- ⚠ EL TRIGGER ES LO QUE HACE ÚTIL EL CATÁLOGO DE CAPACIDADES.
--
--   Sin él, `ai.architectures` sería documentación: nada impediría un modelo `ocr`
--   sobre `yolo11n`, y el fallo aparecería al lanzar el entrenamiento, DESPUÉS de
--   reservar una GPU. Un CHECK no puede hacerlo porque son condiciones entre
--   tablas.
--
-- `current_version_id` nace SIN clave foránea y la recibe en 0038, cuando exista
-- ai.model_versions. Es una referencia colgante durante UNA migración, no de forma
-- permanente — lo señalo porque critiqué exactamente esto en
-- `core.users.avatar_file_id`, donde lleva colgando desde la 0010. La alternativa
-- era crear las dos tablas en la misma migración y perder granularidad de rollback.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ai.models (
    id                  uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          uuid          NOT NULL
                                      REFERENCES ai.projects(id) ON DELETE RESTRICT,

    name                varchar(120)  NOT NULL,
    slug                varchar(120)  NOT NULL,
    description         text          NULL,
    purpose             text          NULL,

    framework_code      varchar(30)   NOT NULL
                                      REFERENCES ai.frameworks(code) ON DELETE RESTRICT,
    architecture_code   varchar(60)   NOT NULL
                                      REFERENCES ai.architectures(code) ON DELETE RESTRICT,

    task                ai.task       NOT NULL,
    input_type          ai.input_type NOT NULL,
    status              varchar(24)   NOT NULL DEFAULT 'draft',

    requires_training   boolean       NOT NULL,
    config              jsonb         NOT NULL DEFAULT '{}',

    current_version_id  uuid          NULL,   -- FK en 0038

    created_at          timestamptz   NOT NULL DEFAULT now(),
    created_by          uuid          NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    updated_by          uuid          NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version             integer       NOT NULL DEFAULT 1,
    deleted_at          timestamptz   NULL,

    CONSTRAINT uq_model_proyecto_id UNIQUE (project_id, id),

    CONSTRAINT chk_model_slug    CHECK (slug ~ '^[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT chk_model_name    CHECK (length(btrim(name)) >= 2),
    CONSTRAINT chk_model_version CHECK (version >= 1),
    CONSTRAINT chk_model_status  CHECK (status IN (
        'draft', 'collecting', 'annotating', 'training',
        'published', 'deprecated', 'archived')),
    CONSTRAINT chk_model_config  CHECK (jsonb_typeof(config) = 'object')
);

COMMENT ON TABLE ai.models IS
    'Modelo LOGICO: que queremos que el sistema sepa hacer. Los pesos concretos son ai.model_versions.';
COMMENT ON COLUMN ai.models.purpose IS
    'Para que sirve, en lenguaje de negocio. Con doce modelos por proyecto, name no basta para elegir bien.';
COMMENT ON COLUMN ai.models.requires_training IS
    'Se copia de la arquitectura al crear y se CONGELA: si manana cambia la fila de la arquitectura, los modelos ya creados no deben cambiar de naturaleza.';
COMMENT ON COLUMN ai.models.config IS
    'Lo especifico de cada familia: prompt de SAM2, clases de texto de Grounding DINO, charset del OCR. Sin este campo la tabla seria una union de casos.';

CREATE UNIQUE INDEX uq_model_slug ON ai.models (project_id, slug)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_model_proyecto ON ai.models (project_id, status)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_model_arquitectura ON ai.models (architecture_code);

CREATE TRIGGER trg_model_updated_at
    BEFORE UPDATE ON ai.models
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── Validación contra el catálogo de capacidades ───────────────────────────
CREATE OR REPLACE FUNCTION ai.validate_model_against_architecture()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    a RECORD;
BEGIN
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

    -- El framework tiene que ser el de la arquitectura. Dos columnas que pueden
    -- contradecirse necesitan quien las reconcilie.
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
        -- Se copia de la arquitectura y se congela: el cliente no lo decide.
        NEW.requires_training := a.requires_training;
    ELSE
        IF NEW.requires_training IS DISTINCT FROM OLD.requires_training THEN
            RAISE EXCEPTION
                'requires_training se deriva de la arquitectura y no se edita'
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION ai.validate_model_against_architecture() IS
    'Convierte ai.architectures en capacidades con efecto. Sin esto, un modelo ocr sobre yolo11n solo fallaria al reservar la GPU.';

CREATE TRIGGER trg_model_validate
    BEFORE INSERT OR UPDATE ON ai.models
    FOR EACH ROW EXECUTE FUNCTION ai.validate_model_against_architecture();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE ai.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.models FORCE ROW LEVEL SECURITY;

CREATE POLICY model_platform_only ON ai.models
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
CREATE POLICY model_read ON ai.models
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY model_insert ON ai.models
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY model_update ON ai.models
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol   int;
    v_force boolean;
    v_owner uuid;
    v_proj  uuid;
    v_model uuid;
    v_req   boolean;
    v_ok    int := 0;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relname = 'models';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'ai' AND tablename = 'models';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    -- Pruebas VIVAS del trigger, en una transacción que se deshace. Comprobar que
    -- el trigger existe no demuestra que valide.
    SELECT id INTO v_owner FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;
    IF v_owner IS NULL THEN
        RAISE NOTICE 'AVISO: sin usuario owner, se omiten las pruebas vivas del trigger';
        RETURN;
    END IF;

    INSERT INTO ai.projects (name, slug, created_by)
    VALUES ('Verif 0037', 'verif-0037', v_owner) RETURNING id INTO v_proj;

    -- 1 · tarea no soportada por la arquitectura
    BEGIN
        INSERT INTO ai.models (project_id, name, slug, framework_code,
                               architecture_code, task, input_type,
                               requires_training, created_by)
        VALUES (v_proj, 'OCR imposible', 'ocr-imposible', 'ultralytics',
                'yolo11n', 'ocr', 'image', true, v_owner);
        RAISE EXCEPTION 'el trigger NO rechazo una tarea no soportada';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%no soporta la tarea%' THEN v_ok := v_ok + 1;
        ELSE RAISE; END IF;
    END;

    -- 2 · framework que no corresponde a la arquitectura
    BEGIN
        INSERT INTO ai.models (project_id, name, slug, framework_code,
                               architecture_code, task, input_type,
                               requires_training, created_by)
        VALUES (v_proj, 'Framework cruzado', 'fw-cruzado', 'pytorch',
                'yolo11n', 'detect', 'image', true, v_owner);
        RAISE EXCEPTION 'el trigger NO rechazo un framework incoherente';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%framework incoherente%' THEN v_ok := v_ok + 1;
        ELSE RAISE; END IF;
    END;

    -- 3 · requires_training se copia de la arquitectura, ignorando lo enviado
    INSERT INTO ai.models (project_id, name, slug, framework_code,
                           architecture_code, task, input_type,
                           requires_training, created_by)
    VALUES (v_proj, 'SAM zero-shot', 'sam-zero', 'pytorch',
            'sam2-b', 'segment', 'image', true, v_owner)
    RETURNING id, requires_training INTO v_model, v_req;
    IF v_req THEN
        RAISE EXCEPTION
            'requires_training debia copiarse de sam2-b (false) y quedo en true';
    END IF;
    v_ok := v_ok + 1;

    -- Se deshace todo: la verificación no debe dejar datos sembrados.
    DELETE FROM ai.models   WHERE project_id = v_proj;
    DELETE FROM ai.projects WHERE id = v_proj;

    IF v_ok <> 3 THEN RAISE EXCEPTION 'solo % de 3 comprobaciones vivas pasaron', v_ok; END IF;

    RAISE NOTICE
        'OK 0037: RLS forzada, 4 politicas, trigger verificado en vivo (tarea, framework, requires_training)';
END
$$;
