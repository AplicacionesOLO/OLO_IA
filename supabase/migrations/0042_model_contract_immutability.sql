-- ═══════════════════════════════════════════════════════════════════════════
-- 0042_model_contract_immutability.sql
-- Altera   : ai.models (DROP framework_code), ai.validate_model_against_architecture()
-- Crea     : ai.protect_architecture_contract() + trigger, vista ai.models_resolved
-- Depende de: 0037, 0038, 0039, 0036
-- Riesgo   : medio
--
-- ⚠ CIERRA TRES AGUJEROS MEDIDOS CONTRA ESTA BASE, no supuestos. El sondeo
--   intentaba mutar cada campo del contrato con una versión existente:
--
--     A input_type       : MUTABLE  → quedó en "frames"
--     D divergencia fw   : SÍ → modelo="ultralytics" arquitectura="pytorch"
--     E divergencia rt   : modelo=true arquitectura=false
--     F quitar la tarea  : PERMITIDO → el modelo detect queda huérfano
--
--   A es un olvido directo: la guarda de 0038 protege `architecture_code` y
--   `task` y no incluyó `input_type`, aunque cambia cómo se alimentan los pesos.
--
--   D, E y F son el hallazgo importante: la guarda comprobaba la coherencia SOLO
--   al tocar el modelo. Nadie protegía la ARQUITECTURA. Editándola, la copia del
--   modelo quedaba obsoleta y el worker —que despacha por framework— invocaría el
--   adaptador equivocado, fallando lejos de la causa.
--
-- ⚠ ESTRATEGIA DE ERRORES. Todo error de negocio lleva:
--       ERRCODE = 'P0001'  ·  MESSAGE = texto para la persona
--       DETAIL  = CÓDIGO_INTERNO_ESTABLE
--
--   Se verificó que `DETAIL` llega a Python como campo estructurado
--   (`asyncpg.RaiseError.detail`), así que la API mapea por código y NUNCA por el
--   texto del mensaje, que puede cambiar sin avisar.
--
--   P0002, P0003 y P0004 NO se usan: PL/pgSQL ya les da semántica propia
--   (NO_DATA_FOUND, TOO_MANY_ROWS, ASSERT_FAILURE) y secuestrarlos confundiría
--   errores de negocio con fallos del lenguaje.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Eliminar el duplicado ──────────────────────────────────────────────
--
-- `framework_code` era duplicado PURO: que `yolo11n` sea de Ultralytics es un
-- hecho de identidad, no una propiedad editable. Eliminar la columna no
-- «protege» el invariante — lo hace INEXPRESABLE. No puede divergir algo que solo
-- existe en un sitio.
DO $$
DECLARE
    v_filas int;
BEGIN
    SELECT count(1) INTO v_filas FROM ai.models;
    IF v_filas > 0 THEN
        RAISE EXCEPTION
            'ai.models tiene % filas. Comprueba que framework_code coincide con la '
            'arquitectura de cada modelo antes de eliminar la columna.', v_filas;
    END IF;
END
$$;

ALTER TABLE ai.models DROP COLUMN framework_code;


-- ── 2 · Vista con el framework resuelto ────────────────────────────────────
--
-- ⚠ `security_invoker = true` es OBLIGATORIO, no opcional.
--
--   Sin él, una vista se evalúa con los privilegios de SU PROPIETARIO —aquí
--   `postgres`, que tiene rolbypassrls—, así que la RLS de las tablas base NO se
--   aplicaría al llamante. La vista sería un agujero que expone `ai.models` a
--   cualquier usuario autenticado, saltándose `is_platform_owner()`.
--
--   Disponible desde PostgreSQL 15; este proyecto corre 17.6. Hay una prueba que
--   lo comprueba con un usuario no owner.
CREATE VIEW ai.models_resolved
WITH (security_invoker = true)
AS
SELECT m.id,
       m.project_id,
       m.name,
       m.slug,
       m.description,
       m.purpose,
       m.architecture_code,
       m.task,
       m.input_type,
       m.status,
       m.requires_training,
       m.config,
       m.created_at, m.created_by, m.updated_at, m.updated_by,
       m.version, m.deleted_at,
       -- DERIVADOS, nunca persistidos en ai.models:
       a.framework_code,
       f.display_name  AS framework_name,
       f.adapter       AS framework_adapter,
       a.display_name  AS architecture_name,
       a.family        AS architecture_family,
       a.weights_extension,
       a.hyperparam_schema,
       a.default_hyperparams,
       a.min_images_recommended
  FROM ai.models m
  JOIN ai.architectures a ON a.code = m.architecture_code
  JOIN ai.frameworks    f ON f.code = a.framework_code;

COMMENT ON VIEW ai.models_resolved IS
    'Modelo con su framework y adaptador RESUELTOS por JOIN. security_invoker=true: la RLS de ai.models se aplica al llamante, no al propietario de la vista.';

GRANT SELECT ON ai.models_resolved TO olo_app, authenticated;


-- ── 3 · Validador del modelo, con input_type y errores estructurados ───────
CREATE OR REPLACE FUNCTION ai.validate_model_against_architecture()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    a RECORD;
    v_versiones int;
    v_campos text[] := '{}';
BEGIN
    -- FASE 1 · Inmutabilidad ANTES de compatibilidad.
    --
    -- El orden importa: si el modelo ya tiene pesos, el cambio está prohibido de
    -- raíz, así que «es inmutable» es la respuesta correcta. Al revés, cambiar a
    -- una arquitectura incompatible devolvía «no soporta la tarea», un mensaje
    -- sobre compatibilidad para una operación prohibida en cualquier caso — y
    -- mandaba al usuario a buscar una arquitectura compatible, que es el camino
    -- equivocado.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.requires_training IS DISTINCT FROM OLD.requires_training THEN
            RAISE EXCEPTION
                'requires_training se deriva de la arquitectura y no se edita'
                USING ERRCODE = 'P0001', DETAIL = 'AI_MODEL_CONTRACT_IMMUTABLE';
        END IF;

        -- El cast a text[] es imprescindible: `text[] || 'literal'` es ambiguo y
        -- PostgreSQL intenta interpretar la cadena como un literal de array,
        -- fallando con «malformed array literal».
        IF NEW.architecture_code IS DISTINCT FROM OLD.architecture_code THEN
            v_campos := v_campos || ARRAY['architecture_code'];
        END IF;
        IF NEW.task IS DISTINCT FROM OLD.task THEN
            v_campos := v_campos || ARRAY['task'];
        END IF;
        -- AGUJERO A, cerrado. Cambiar la entrada altera cómo se alimentan los
        -- pesos: un modelo entrenado sobre imágenes sueltas y consultado como
        -- secuencia produce resultados distintos sin avisar de nada.
        IF NEW.input_type IS DISTINCT FROM OLD.input_type THEN
            v_campos := v_campos || ARRAY['input_type'];
        END IF;

        IF cardinality(v_campos) > 0 THEN
            SELECT count(1) INTO v_versiones
              FROM ai.model_versions
             WHERE model_id = OLD.id AND deleted_at IS NULL;

            IF v_versiones > 0 THEN
                RAISE EXCEPTION
                    'El modelo "%" tiene % version(es) registradas: % no se pueden '
                    'cambiar. Los pesos existentes dejarian de poder interpretarse. '
                    'Crea un modelo nuevo.',
                    OLD.name, v_versiones, array_to_string(v_campos, ', ')
                    USING ERRCODE = 'P0001', DETAIL = 'AI_MODEL_CONTRACT_IMMUTABLE';
            END IF;
        END IF;
    END IF;

    -- FASE 2 · Compatibilidad contra el catálogo.
    SELECT framework_code, supported_tasks, supported_input_types,
           requires_training, is_active
      INTO a
      FROM ai.architectures
     WHERE code = NEW.architecture_code;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'la arquitectura % no existe en el catalogo', NEW.architecture_code
            USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_NOT_FOUND';
    END IF;

    IF NOT a.is_active AND (TG_OP = 'INSERT'
                            OR NEW.architecture_code IS DISTINCT FROM OLD.architecture_code) THEN
        RAISE EXCEPTION 'la arquitectura % esta desactivada', NEW.architecture_code
            USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_INACTIVE';
    END IF;

    IF NOT (NEW.task = ANY (a.supported_tasks)) THEN
        RAISE EXCEPTION
            'La arquitectura % no soporta la tarea "%". Soporta: %.',
            NEW.architecture_code, NEW.task, array_to_string(a.supported_tasks, ', ')
            USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_TASK_UNSUPPORTED';
    END IF;

    IF NOT (NEW.input_type = ANY (a.supported_input_types)) THEN
        RAISE EXCEPTION
            'La arquitectura % no soporta la entrada "%". Soporta: %.',
            NEW.architecture_code, NEW.input_type,
            array_to_string(a.supported_input_types, ', ')
            USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_INPUT_UNSUPPORTED';
    END IF;

    -- `requires_training` se COPIA y se congela: es una instantánea de qué era
    -- cierto al crear el modelo, no un duplicado. Si mañana la arquitectura
    -- cambia, los modelos ya creados no deben cambiar de naturaleza — y el
    -- trigger de ai.architectures impide ese cambio mientras haya modelos.
    IF TG_OP = 'INSERT' THEN
        NEW.requires_training := a.requires_training;
    END IF;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION ai.validate_model_against_architecture() IS
    'Contrato del modelo: inmutabilidad de architecture_code, task e input_type con versiones; compatibilidad contra el catalogo. Errores con DETAIL estable.';


-- ── 4 · Protección de la arquitectura ──────────────────────────────────────
--
-- QUÉ SE PUEDE CAMBIAR Y QUÉ NO, y el criterio de cada grupo:
--
--  LIBRE SIEMPRE — descriptivo o consultivo, no cambia cómo se interpreta nada:
--     display_name · family · notes · min_images_recommended
--     approx_weights_mb · weights_extension · is_active
--
--  LIBRE, y merece explicación — hyperparam_schema y default_hyperparams:
--     Pueden evolucionar sin invalidar nada, y no por descuido: cada
--     `ai.training_runs` congela su `config_snapshot` (diseño del Bloque 4), así
--     que una versión ya registrada lleva consigo los parámetros con los que se
--     entrenó de verdad. El esquema describe lo que las EJECUCIONES NUEVAS pueden
--     pedir; las antiguas no lo consultan. Sin esa instantánea, este campo
--     tendría que ser inmutable y el catálogo no podría corregirse nunca.
--
--  INMUTABLE SIEMPRE — framework_code:
--     Es identidad, no propiedad. Cambiarlo no es una edición legítima: es
--     corrupción de datos. Y determina el adaptador del worker.
--
--  INMUTABLE CON MODELOS — requires_training, requires_annotations:
--     Los modelos guardan una instantánea de requires_training. Permitir el
--     cambio produciría la divergencia E medida en el sondeo.
--
--  SOLO SE PUEDE AMPLIAR — supported_tasks, supported_input_types:
--     Añadir es libre: amplía capacidades sin romper nada. RETIRAR un valor que
--     algún modelo vivo use deja ese modelo huérfano —referencia una arquitectura
--     que ya no declara su tarea— y nada lo detectaría. Es el agujero F.
--     La asimetría es deliberada: el catálogo debe poder crecer sin ceremonia.
CREATE OR REPLACE FUNCTION ai.protect_architecture_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_modelos   int;
    v_retiradas text[];
    v_en_uso    text[];
BEGIN
    -- framework_code: inmutable SIEMPRE, incluso sin modelos. Es identidad.
    IF NEW.framework_code IS DISTINCT FROM OLD.framework_code THEN
        RAISE EXCEPTION
            'El framework de una arquitectura es identidad y no se edita (% -> %). '
            'Si de verdad cambio de framework, registra una arquitectura nueva.',
            OLD.framework_code, NEW.framework_code
            USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_FRAMEWORK_IMMUTABLE';
    END IF;

    SELECT count(1) INTO v_modelos
      FROM ai.models
     WHERE architecture_code = OLD.code AND deleted_at IS NULL;

    IF v_modelos = 0 THEN
        -- Sin modelos vivos, la arquitectura puede corregirse libremente.
        RETURN NEW;
    END IF;

    IF NEW.requires_training IS DISTINCT FROM OLD.requires_training
       OR NEW.requires_annotations IS DISTINCT FROM OLD.requires_annotations THEN
        RAISE EXCEPTION
            'La arquitectura % la usan % modelo(s), que guardan una instantanea de '
            'requires_training. Cambiarlo produciria divergencia.', OLD.code, v_modelos
            USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_IN_USE';
    END IF;

    -- ¿Se retira alguna tarea que un modelo vivo esté usando?
    SELECT array_agg(DISTINCT t) INTO v_retiradas
      FROM unnest(OLD.supported_tasks) AS t
     WHERE NOT (t = ANY (NEW.supported_tasks));

    IF v_retiradas IS NOT NULL THEN
        SELECT array_agg(DISTINCT m.task::text) INTO v_en_uso
          FROM ai.models m
         WHERE m.architecture_code = OLD.code
           AND m.deleted_at IS NULL
           AND m.task::text = ANY (v_retiradas);

        IF v_en_uso IS NOT NULL THEN
            RAISE EXCEPTION
                'No se puede retirar % de las tareas de %: hay modelos que la usan '
                'y quedarian huerfanos. Anadir tareas si esta permitido.',
                array_to_string(v_en_uso, ', '), OLD.code
                USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_TASK_IN_USE';
        END IF;
    END IF;

    -- Lo mismo con los tipos de entrada.
    SELECT array_agg(DISTINCT t) INTO v_retiradas
      FROM unnest(OLD.supported_input_types) AS t
     WHERE NOT (t = ANY (NEW.supported_input_types));

    IF v_retiradas IS NOT NULL THEN
        SELECT array_agg(DISTINCT m.input_type::text) INTO v_en_uso
          FROM ai.models m
         WHERE m.architecture_code = OLD.code
           AND m.deleted_at IS NULL
           AND m.input_type::text = ANY (v_retiradas);

        IF v_en_uso IS NOT NULL THEN
            RAISE EXCEPTION
                'No se puede retirar % de las entradas de %: hay modelos que la usan '
                'y quedarian huerfanos.',
                array_to_string(v_en_uso, ', '), OLD.code
                USING ERRCODE = 'P0001', DETAIL = 'AI_ARCHITECTURE_INPUT_IN_USE';
        END IF;
    END IF;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION ai.protect_architecture_contract() IS
    'Impide que editar el catalogo invalide modelos existentes. framework_code inmutable siempre; capacidades solo ampliables; hyperparam_schema libre porque cada run congela su config.';

CREATE TRIGGER trg_arch_protect_contract
    BEFORE UPDATE ON ai.architectures
    FOR EACH ROW
    EXECUTE FUNCTION ai.protect_architecture_contract();


-- ── Verificación: los cuatro agujeros del sondeo, cerrados ─────────────────
DO $$
DECLARE
    v_owner uuid;
    v_proj  uuid;
    v_model uuid;
    v_asset uuid;
    v_ok    int := 0;
    v_det   text;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'models'
           AND column_name = 'framework_code'
    ) THEN
        RAISE EXCEPTION 'ai.models.framework_code sigue existiendo';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ai' AND c.relname = 'models_resolved' AND c.relkind = 'v'
    ) THEN
        RAISE EXCEPTION 'falta la vista ai.models_resolved';
    END IF;

    -- security_invoker: sin él la vista sería un agujero de RLS.
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'ai' AND c.relname = 'models_resolved'
           AND 'security_invoker=true' = ANY (c.reloptions)
    ) THEN
        RAISE EXCEPTION
            'ai.models_resolved NECESITA security_invoker=true: sin el, la RLS de '
            'ai.models se evaluaria con el propietario de la vista y quedaria expuesta';
    END IF;

    SELECT id INTO v_owner FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;
    IF v_owner IS NULL THEN
        RAISE NOTICE 'AVISO: sin usuario owner, se omiten las pruebas vivas';
        RETURN;
    END IF;

    INSERT INTO ai.projects (name, slug, created_by)
    VALUES ('Verif 0042', 'verif-0042', v_owner) RETURNING id INTO v_proj;
    INSERT INTO ai.assets (project_id, kind, bucket, object_path, original_filename,
                           content_type, bytes, sha256, created_by)
    VALUES (v_proj,'weights','ai-weights','v42/w.pt','w.pt','application/octet-stream',
            1024, repeat('9',64), v_owner) RETURNING id INTO v_asset;
    INSERT INTO ai.models (project_id, name, slug, architecture_code,
                           task, input_type, requires_training, created_by)
    VALUES (v_proj,'Verif','verif-42','yolo11n','detect','image',true,v_owner)
    RETURNING id INTO v_model;

    -- Sin versiones: input_type SÍ se puede cambiar
    UPDATE ai.models SET input_type = 'frames' WHERE id = v_model;
    UPDATE ai.models SET input_type = 'image'  WHERE id = v_model;
    v_ok := v_ok + 1;

    INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                   weights_asset_id, source_reference, created_by)
    VALUES (v_proj, v_model, 1, 'imported', v_asset, 'verificacion', v_owner);

    -- AGUJERO A cerrado
    BEGIN
        UPDATE ai.models SET input_type = 'frames' WHERE id = v_model;
        RAISE EXCEPTION 'AGUJERO A SIGUE ABIERTO: input_type es mutable con versiones';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF v_det <> 'AI_MODEL_CONTRACT_IMMUTABLE' THEN
            RAISE EXCEPTION 'DETAIL inesperado para input_type: %', v_det;
        END IF;
        v_ok := v_ok + 1;
    END;

    -- AGUJERO D cerrado: framework_code de la arquitectura
    BEGIN
        UPDATE ai.architectures SET framework_code = 'pytorch' WHERE code = 'yolo11n';
        RAISE EXCEPTION 'AGUJERO D SIGUE ABIERTO: framework_code de la arquitectura es mutable';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF v_det <> 'AI_ARCHITECTURE_FRAMEWORK_IMMUTABLE' THEN
            RAISE EXCEPTION 'DETAIL inesperado para framework: %', v_det;
        END IF;
        v_ok := v_ok + 1;
    END;

    -- AGUJERO E cerrado: requires_training con modelos
    BEGIN
        UPDATE ai.architectures SET requires_training = false WHERE code = 'yolo11n';
        RAISE EXCEPTION 'AGUJERO E SIGUE ABIERTO: requires_training mutable con modelos';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF v_det <> 'AI_ARCHITECTURE_IN_USE' THEN
            RAISE EXCEPTION 'DETAIL inesperado para requires_training: %', v_det;
        END IF;
        v_ok := v_ok + 1;
    END;

    -- AGUJERO F cerrado: retirar la tarea en uso
    BEGIN
        UPDATE ai.architectures
           SET supported_tasks = ARRAY['segment']::ai.task[]
         WHERE code = 'yolo11n';
        RAISE EXCEPTION 'AGUJERO F SIGUE ABIERTO: se retiro una tarea en uso';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF v_det <> 'AI_ARCHITECTURE_TASK_IN_USE' THEN
            RAISE EXCEPTION 'DETAIL inesperado para tarea en uso: %', v_det;
        END IF;
        v_ok := v_ok + 1;
    END;

    -- AMPLIAR sigue permitido: el catálogo debe poder crecer sin ceremonia
    UPDATE ai.architectures
       SET supported_tasks = ARRAY['detect','segment','classify','pose','count']::ai.task[]
     WHERE code = 'yolo11n';
    v_ok := v_ok + 1;

    -- Y hyperparam_schema evoluciona libremente
    UPDATE ai.architectures
       SET hyperparam_schema = hyperparam_schema || '{"warmup_epochs":{"type":"integer"}}'::jsonb
     WHERE code = 'yolo11n';
    v_ok := v_ok + 1;

    -- La vista resuelve el framework
    IF (SELECT framework_code FROM ai.models_resolved WHERE id = v_model) <> 'ultralytics' THEN
        RAISE EXCEPTION 'la vista no resolvio el framework correctamente';
    END IF;
    v_ok := v_ok + 1;

    -- Limpieza, incluida la restauración del catálogo que se tocó
    DELETE FROM ai.model_versions WHERE project_id = v_proj;
    DELETE FROM ai.models         WHERE project_id = v_proj;
    DELETE FROM ai.assets         WHERE project_id = v_proj;
    DELETE FROM ai.projects       WHERE id = v_proj;
    UPDATE ai.architectures
       SET supported_tasks = ARRAY['detect','segment','classify','pose']::ai.task[],
           hyperparam_schema = hyperparam_schema - 'warmup_epochs'
     WHERE code = 'yolo11n';

    IF v_ok <> 8 THEN RAISE EXCEPTION 'solo % de 8 comprobaciones pasaron', v_ok; END IF;

    RAISE NOTICE
        'OK 0042: framework_code eliminado, vista con security_invoker, y los 4 agujeros del sondeo CERRADOS con DETAIL estable (ampliar y hyperparam_schema siguen libres)';
END
$$;
