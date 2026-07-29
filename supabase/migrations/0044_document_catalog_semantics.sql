-- ═══════════════════════════════════════════════════════════════════════════
-- 0044_document_catalog_semantics.sql
-- Altera   : NADA. Solo comentarios.
-- Depende de: 0036, 0042
-- Riesgo   : ninguno
--
-- MIGRACIÓN DE SOLO DOCUMENTACIÓN, y va como migración por dos razones:
--
--   1. `COMMENT ON` es DDL, y la regla del proyecto es que toda modificación
--      exista primero como archivo versionado en supabase/migrations/. Un
--      comentario aplicado a mano sería un cambio no representado.
--   2. Un comentario en la columna es lo que lee quien inspecciona el esquema
--      —con \d+, con un cliente gráfico, con la introspección de un ORM—. Es el
--      sitio donde la advertencia llega a quien la necesita, no un documento que
--      hay que saber que existe.
--
-- Fija dos cosas que hasta ahora solo estaban en documentos:
--   · qué significa el catálogo frente a lo que un entrenamiento guardó
--   · que ai.models_resolved es un READ MODEL y no el contrato del dominio
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Catálogo vigente vs configuración histórica ────────────────────────
--
-- LA DISTINCIÓN, en una frase: el catálogo representa la configuración RECOMENDADA
-- VIGENTE; el entrenamiento representa la configuración UTILIZADA HISTÓRICAMENTE.
--
-- Por qué hay que dejarlo escrito: `hyperparam_schema` y `default_hyperparams`
-- pueden evolucionar libremente —lo permite el trigger de 0042— y eso solo es
-- seguro porque cada `ai.training_runs` congelará su `config_snapshot`. Sin esa
-- frase, alguien puede razonar al revés: «el catálogo dice imgsz 640, así que la
-- v3 se entrenó a 640». Falso, y el error es indetectable a simple vista.
--
-- Consecuencia operativa: para responder «¿con qué parámetros se entrenó esta
-- versión?» NUNCA se consulta ai.architectures. Se consulta el run.
COMMENT ON COLUMN ai.architectures.hyperparam_schema IS
    'Parametros que las EJECUCIONES NUEVAS pueden pedir. Configuracion RECOMENDADA VIGENTE, no historica: '
    'para saber con que se entreno una version se consulta ai.training_runs.config_snapshot, nunca esta columna. '
    'Puede evolucionar libremente porque cada run congela su propia copia. Vacio = pendiente de verificar.';

COMMENT ON COLUMN ai.architectures.default_hyperparams IS
    'Valores por defecto VIGENTES que la interfaz propone al lanzar un entrenamiento. '
    'No son los que uso ningun run pasado: eso vive en ai.training_runs.config_snapshot.';

COMMENT ON COLUMN ai.architectures.min_images_recommended IS
    'Consultivo, no una restriccion. Orienta al usuario; no impide congelar un dataset mas pequeno.';

COMMENT ON TABLE ai.architectures IS
    'Catalogo de CAPACIDADES por arquitectura, en su estado VIGENTE. Es lo que hace la plataforma agnostica: '
    'lo que varia entre modelos esta en datos y no en condicionales. NO es un registro historico: '
    'la verdad sobre un entrenamiento pasado esta en su run, no aqui.';


-- ── 2 · La vista es un read model, no el contrato del dominio ──────────────
--
-- `ai.models_resolved` existe para no repetir un JOIN de tres tablas en cada
-- consulta de lectura. Eso es todo lo que es.
--
-- Las ENTIDADES del dominio siguen siendo `ai.models`, `ai.architectures` y
-- `ai.frameworks`. Consecuencias prácticas de la distinción:
--
--   · toda ESCRITURA va contra ai.models. La vista no es actualizable y no debe
--     hacerse actualizable con reglas o triggers INSTEAD OF: eso convertiria la
--     proyeccion en una segunda puerta de entrada con sus propias invariantes.
--   · el repositorio de dominio lee y escribe ai.models; solo las consultas de
--     lectura enriquecida usan la vista.
--   · las columnas derivadas de la vista se exponen en la API como READ-ONLY, y su
--     conjunto puede cambiar sin que eso sea un cambio de contrato del dominio.
--
-- Sin esta separacion, la vista acabaria siendo la API publica y cambiarla —anadir
-- una columna derivada, cambiar un JOIN— rompería clientes. Que sea un read model
-- es justamente lo que da libertad para reorganizarla.
COMMENT ON VIEW ai.models_resolved IS
    'READ MODEL, no el contrato del dominio. Las entidades reales son ai.models, ai.architectures y ai.frameworks. '
    'Solo lectura: toda escritura va contra ai.models. Sus columnas derivadas (framework_code, framework_adapter, '
    'architecture_name, weights_extension, hyperparam_schema) pueden cambiar sin que sea un cambio del dominio. '
    'security_invoker=true: la RLS de ai.models se aplica al llamante, no al propietario de la vista.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_hp    text;
    v_vista text;
    v_n     int := 0;
BEGIN
    SELECT col_description(
               ('ai.architectures')::regclass::oid,
               (SELECT ordinal_position FROM information_schema.columns
                 WHERE table_schema='ai' AND table_name='architectures'
                   AND column_name='hyperparam_schema')::int
           ) INTO v_hp;

    IF v_hp IS NULL OR v_hp NOT LIKE '%VIGENTE%' THEN
        RAISE EXCEPTION 'el comentario de hyperparam_schema no quedo aplicado';
    END IF;
    IF v_hp NOT LIKE '%config_snapshot%' THEN
        RAISE EXCEPTION
            'el comentario debe apuntar a config_snapshot como fuente historica';
    END IF;
    v_n := v_n + 1;

    SELECT obj_description(('ai.models_resolved')::regclass::oid) INTO v_vista;
    IF v_vista IS NULL OR v_vista NOT LIKE '%READ MODEL%' THEN
        RAISE EXCEPTION 'el comentario de la vista no quedo aplicado';
    END IF;
    v_n := v_n + 1;

    -- La vista NO debe ser actualizable. PostgreSQL la haría auto-actualizable si
    -- fuese un SELECT simple de una sola tabla; al tener tres JOIN no lo es, y
    -- conviene comprobarlo en lugar de suponerlo: si alguien simplifica la vista
    -- en el futuro, se volvería escribible sin que nadie lo decidiera.
    IF EXISTS (
        SELECT 1 FROM information_schema.views
         WHERE table_schema='ai' AND table_name='models_resolved'
           AND is_insertable_into = 'YES'
    ) THEN
        RAISE EXCEPTION
            'ai.models_resolved es insertable: seria una segunda puerta de escritura '
            'a ai.models, con sus propias invariantes. Debe ser solo de lectura.';
    END IF;
    v_n := v_n + 1;

    RAISE NOTICE
        'OK 0044: % comprobaciones. Catalogo documentado como VIGENTE (no historico) y vista marcada como read model NO actualizable',
        v_n;
END
$$;
