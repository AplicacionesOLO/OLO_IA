-- ═══════════════════════════════════════════════════════════════════════════
-- 0031_create_ai_schema.sql
-- Crea     : schema `ai`, privilegios, default privileges y 3 dominios
-- Tablas   : ninguna
-- Depende de: 0002 (rol olo_app)
-- Riesgo   : bajo
--
-- `ai` es el dominio de AUTORÍA y ciclo de vida de modelos, en régimen PLATFORM
-- OWNER. Se separa de `platform` para que `platform` quede reducido a gobierno
-- —owners, auditoría privilegiada, configuración— y para poder dar al worker de
-- entrenamiento un perfil de permisos propio por schema en lugar de tabla a tabla.
--
-- ⚠ `FOR ROLE postgres` es imprescindible, igual que en 0019. `ALTER DEFAULT
--   PRIVILEGES` solo afecta a objetos futuros creados por el rol indicado; las
--   migraciones corren como `postgres`, así que sin la cláusula las tablas de
--   0035+ nacerían sin permisos para `olo_app` y todo fallaría con 42501 en el
--   primer endpoint.
--
-- POR QUÉ DOMINIOS Y NO CHECK REPETIDOS
--
--   El mismo vocabulario lo usan dos sitios: la columna escalar
--   (`ai.models.task`) y el array de capacidades
--   (`ai.architectures.supported_tasks`). Con CHECK sueltos habría dos listas que
--   se desincronizan en el primer añadido, y una arquitectura podría declarar
--   soportar una tarea que ningún modelo puede pedir.
--
--   Se verificó empíricamente contra este mismo motor que los CHECK de un DOMAIN
--   SÍ se aplican a los elementos de un array, así que `supported_tasks ai.task[]`
--   queda validado sin duplicar nada. Es la propiedad que hace viable este
--   diseño; sin ella habría que repetir las listas.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA ai;

COMMENT ON SCHEMA ai IS
    'Dominio de AUTORIA de IA: proyectos, modelos, datasets, anotaciones, entrenamientos. Regimen PLATFORM OWNER: aislamiento por core.is_platform_owner(), nunca por tenant_id.';

GRANT USAGE ON SCHEMA ai TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai
    GRANT USAGE, SELECT ON SEQUENCES TO olo_app;


-- ── Vocabulario: una sola fuente ───────────────────────────────────────────
CREATE DOMAIN ai.task AS varchar(20)
    CHECK (VALUE IN (
        'detect',    -- cajas: qué hay y dónde
        'segment',   -- máscaras: la silueta exacta
        'classify',  -- una etiqueta para la imagen entera
        'ocr',       -- texto en una región
        'track',     -- identidad del objeto entre frames
        'pose',      -- puntos clave articulados
        'count',     -- cuántos hay
        'regress',   -- un valor continuo
        'embed'      -- vector de representación
    ));

CREATE DOMAIN ai.input_type AS varchar(20)
    CHECK (VALUE IN (
        'image', 'video', 'frames', 'point_cloud', 'depth', 'thermal', 'fusion'
    ));

CREATE DOMAIN ai.annotation_kind AS varchar(16)
    CHECK (VALUE IN (
        'bbox',         -- caja normalizada
        'polygon',      -- contorno
        'keypoints',    -- puntos
        'image_label',  -- clasificación: la imagen entera, sin geometría
        'text_region',  -- región + texto transcrito
        'count'         -- región no, cantidad sí
    ));

COMMENT ON DOMAIN ai.task IS
    'Tareas de IA. Fuente unica: la usan ai.models.task y ai.architectures.supported_tasks (array).';
COMMENT ON DOMAIN ai.annotation_kind IS
    'Tipos de anotacion. En architectures indica lo que la arquitectura CONSUME para entrenar, no lo que produce.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_usage    boolean;
    v_create   boolean;
    v_default  int;
    v_dominios int;
    v_rechazado boolean := false;
BEGIN
    SELECT has_schema_privilege('olo_app', 'ai', 'USAGE'),
           has_schema_privilege('olo_app', 'ai', 'CREATE')
      INTO v_usage, v_create;
    IF NOT v_usage THEN RAISE EXCEPTION 'olo_app necesita USAGE sobre ai'; END IF;
    IF v_create  THEN RAISE EXCEPTION 'olo_app NO debe tener CREATE sobre ai'; END IF;

    SELECT count(1) INTO v_default
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'ai' AND d.defaclrole = 'postgres'::regrole;
    IF v_default = 0 THEN
        RAISE EXCEPTION 'no hay default privileges de postgres en ai';
    END IF;

    SELECT count(1) INTO v_dominios
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'ai' AND t.typtype = 'd';
    IF v_dominios <> 3 THEN
        RAISE EXCEPTION 'se esperaban 3 dominios, hay %', v_dominios;
    END IF;

    -- Prueba viva de la propiedad de la que depende todo el diseño: que el CHECK
    -- del dominio se aplique a los ELEMENTOS de un array. Verificar que el
    -- dominio existe no demuestra que valide.
    BEGIN
        PERFORM ARRAY['detect', 'no_existe']::ai.task[];
    EXCEPTION WHEN check_violation THEN
        v_rechazado := true;
    END;
    IF NOT v_rechazado THEN
        RAISE EXCEPTION
            'El CHECK del dominio ai.task NO se aplica a elementos de array. '
            'El diseño de ai.architectures depende de que sí: habría que añadir '
            'CHECK explícitos con <@ en las tres columnas de tipo array.';
    END IF;

    RAISE NOTICE
        'OK 0031: schema ai (usage=si create=no), % entradas de default_acl, 3 dominios, validacion de arrays confirmada',
        v_default;
END
$$;
