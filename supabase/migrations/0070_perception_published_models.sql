-- ══════════════════════════════════════════════════════════════════════════════
-- 0070 · El catálogo de modelos PUBLICADOS, visible para el tenant
--
-- ⚠ ESTA VISTA ATRAVIESA RLS A PROPÓSITO. Leer entera antes de tocarla.
--
-- ── EL PROBLEMA ─────────────────────────────────────────────────────────────
--
-- `perception` es de régimen TENANT y `ai` es de régimen PLATFORM OWNER. Un
-- operador que va a lanzar una inferencia tiene que poder ELEGIR el modelo, y se
-- midió lo que ve hoy conectado como `olo_app` con contexto de tenant:
--
--     ai.models          visible para el tenant: 0   (de 3 que hay)
--     ai.model_versions  visible para el tenant: 0
--     ai.projects        visible para el tenant: 0
--     core.is_platform_owner() → false
--
-- Cero, no error. Una consulta directa desde el repositorio de percepción habría
-- devuelto lista vacía PARA SIEMPRE, y la pantalla habría dicho «no hay ningún
-- modelo publicado» con tres modelos publicados en la base. Es el peor tipo de
-- fallo: plausible, silencioso y del lado del que mira.
--
-- ── POR QUÉ ATRAVESARLO ES CORRECTO AQUÍ, Y SOLO AQUÍ ───────────────────────
--
-- Sin `security_invoker`, una vista se ejecuta con los privilegios de su PROPIETARIO
-- —`postgres`— y por tanto no aplica las policies de las tablas de debajo. En este
-- proyecto eso ya fue un fallo grave una vez, en las vistas de `spatial`: allí las
-- filas eran DE UN TENANT, y saltarse RLS enseñaba el almacén de un cliente a otro.
--
-- Aquí es lo contrario, y la diferencia es la naturaleza del dato:
--
--   · `ai.models` y `ai.model_versions` NO tienen `tenant_id`. No son de nadie: son
--     el catálogo de la plataforma. No hay ningún tenant al que enseñárselos de más.
--   · Lo que se expone es lo PUBLICADO. `status = 'published'` no es un filtro de
--     conveniencia, es la frontera: un experimento a medias no aparece, y un modelo
--     despublicado deja de aparecer aunque siga existiendo. Publicar es el acto
--     explícito por el que la plataforma dice «esto se puede usar».
--   · Es de SOLO LECTURA y solo `SELECT`. No hay forma de escribir en `ai` desde
--     aquí.
--
-- Si algún día `ai` pasara a tener datos por tenant —un modelo entrenado con las
-- fotos de UN cliente—, esta vista deja de ser correcta y hay que añadirle el
-- filtro por tenant. Queda escrito porque será fácil de olvidar.
--
-- ── LAS CLASES VIAJAN CON EL MODELO ─────────────────────────────────────────
--
-- Un modelo sin sus clases es un desplegable que no dice qué va a detectar. Van
-- agregadas en `jsonb` y no en una segunda vista porque son 3 o 6 filas por modelo:
-- una consulta aparte serían dos viajes al pooler —520 ms medidos— para pintar un
-- desplegable.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE VIEW perception.v_published_models AS
SELECT mv.id                AS model_version_id,
       mv.model_id,
       mv.version,
       mv.origin,
       mv.published_at,
       m.name,
       m.slug,
       m.task,
       m.input_type,
       m.architecture_code,
       m.purpose,
       a.display_name       AS architecture_name,
       a.framework_code,
       a.supported_tasks,
       a.supported_input_types,
       COALESCE(
           (SELECT jsonb_agg(
                       jsonb_build_object(
                           'id',    c.id,
                           'name',  c.name,
                           'index', mc.training_index,
                           'color', c.color
                       ) ORDER BY mc.training_index
                   )
              FROM ai.model_classes mc
              JOIN ai.classes c ON c.id = mc.class_id
             WHERE mc.model_id = m.id
               AND c.deleted_at IS NULL),
           '[]'::jsonb
       )                    AS classes
  FROM ai.model_versions mv
  JOIN ai.models m        ON m.id = mv.model_id
  LEFT JOIN ai.architectures a ON a.code = m.architecture_code
 WHERE mv.status = 'published'
   AND mv.deleted_at IS NULL
   AND m.deleted_at IS NULL;

-- NO se pone `security_invoker = true`, y es la única vista del proyecto de la que
-- eso se dice en voz alta. Ver la cabecera: el dato es de la plataforma, no de un
-- tenant, y el filtro `published` es la frontera.
COMMENT ON VIEW perception.v_published_models IS
    'Catalogo de versiones de modelo PUBLICADAS, legible por el tenant. Atraviesa RLS de `ai` a proposito: ese esquema no tiene tenant_id, no es de nadie. Ver la cabecera de 0070.';

GRANT SELECT ON perception.v_published_models TO olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
-- Se comprueba que la vista NO es security_invoker: si alguien se lo añadiera
-- «por coherencia con las demás», volvería a devolver cero filas al tenant y el
-- desplegable de modelos se quedaría vacío sin ningún error.
DO $$
DECLARE
    v_opciones text[];
BEGIN
    SELECT c.reloptions INTO v_opciones
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'perception' AND c.relname = 'v_published_models';

    IF v_opciones IS NOT NULL
       AND EXISTS (SELECT 1 FROM unnest(v_opciones) o WHERE o = 'security_invoker=true')
    THEN
        RAISE EXCEPTION
            'v_published_models tiene security_invoker=true: devolveria 0 filas al tenant';
    END IF;

    RAISE NOTICE '0070 OK · catalogo de modelos publicados creado';
END $$;
