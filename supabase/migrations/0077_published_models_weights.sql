-- ══════════════════════════════════════════════════════════════════════════════
-- 0077 · Los pesos, en el catálogo publicado
--
-- Toca : perception.v_published_models (añade 2 columnas, no quita ninguna)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ FALTABA, Y CÓMO SE VIO
--
-- `tools/inferir.py` necesita responder una pregunta antes de analizar nada: ¿dónde
-- están los pesos del modelo que este trabajo declaró? La única lista de modelos que
-- un tenant puede leer es `v_published_models`, y no traía esa respuesta.
--
-- Sin estas dos columnas el worker caía SIEMPRE al `yolov8n` genérico de ultralytics.
-- Habría funcionado —detecta cosas— y ahí está el problema: las detecciones se
-- guardarían con el `model_label` del modelo entrenado, y nadie podría saber que las
-- produjo otro. Un resultado plausible atribuido al modelo equivocado es peor que un
-- fallo.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE ESTO NO ABRE
--
-- `weights_asset_id` es un UUID, y tenerlo no da acceso a los bytes. El bucket
-- `ai-assets` exige `core.is_platform_owner()` en sus cuatro políticas (0045), así que
-- un tenant que lea esta vista ve el identificador y no puede descargar nada con él.
--
-- La consecuencia práctica, que hay que decir en voz alta: **el worker de inferencia
-- necesita credenciales de PLATFORM OWNER** para bajarse los pesos, mientras que el
-- medio —el vídeo del pasillo— es del tenant y le basta `perception:ingest`. No es una
-- incoherencia: un modelo entrenado es material de la plataforma, compartido entre
-- operadores, y un vuelo del almacén es del operador. Los dos regímenes son correctos
-- y el worker vive a caballo de los dos.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SE RECREA LA VISTA ENTERA, Y SIN `security_invoker`
--
-- `CREATE OR REPLACE VIEW` no admite añadir columnas en medio, así que va DROP +
-- CREATE. Y se conserva la decisión de 0070: esta vista NO lleva `security_invoker`
-- a propósito —`ai` no tiene `tenant_id`, no es de nadie, y `status = 'published'` es
-- la frontera—. La verificación de abajo falla si alguien se lo añade, igual que la de
-- 0070, porque es la clase de «arreglo» que parece correcto y rompe el catálogo.
-- ══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS perception.v_published_models;

CREATE VIEW perception.v_published_models AS
SELECT mv.id                AS model_version_id,
       mv.model_id,
       mv.version,
       mv.origin,
       mv.published_at,
       --  LO NUEVO. `weights_asset_id` es lo que el worker resuelve contra
       --  `/v1/ai/assets/{id}/url`, que exige platform owner. `weights_object_path`
       --  viaja al lado para que la pantalla pueda decir «esta version SI tiene
       --  pesos descargables» sin una segunda consulta.
       mv.weights_asset_id,
       a.object_path        AS weights_object_path,
       m.name,
       m.slug,
       m.task,
       m.input_type,
       m.architecture_code,
       m.purpose,
       ar.display_name      AS architecture_name,
       ar.framework_code,
       ar.supported_tasks,
       ar.supported_input_types,
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
  LEFT JOIN ai.architectures ar ON ar.code = m.architecture_code
  --  LEFT y no INNER: `weights_asset_id` es NOT NULL en 0038, pero el asset puede
  --  haberse borrado. Con INNER, esa version DESAPARECERIA del catalogo y el
  --  operador no entenderia por que su modelo publicado ya no se puede elegir.
  --  Asi aparece con `weights_object_path` a NULL, que es un estado que se ve.
  LEFT JOIN ai.assets a   ON a.id = mv.weights_asset_id
 WHERE mv.status = 'published'
   AND mv.deleted_at IS NULL
   AND m.deleted_at IS NULL;

COMMENT ON VIEW perception.v_published_models IS
    'Catalogo de versiones de modelo PUBLICADAS, legible por el tenant. Atraviesa RLS de `ai` a proposito: ese esquema no tiene tenant_id, no es de nadie. Ver la cabecera de 0070. Desde 0077 trae los pesos: el UUID se ve, los bytes siguen exigiendo platform owner.';

GRANT SELECT ON perception.v_published_models TO olo_app;


-- ── Verificación ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_invoker text;
    v_cols    int;
BEGIN
    -- Lo mismo que comprueba 0070, y por el mismo motivo: si alguien añade
    -- `security_invoker` «para arreglar la seguridad», el catalogo vuelve a estar
    -- vacio para todos los tenants y la pantalla dice que no hay modelos habiendolos.
    SELECT array_to_string(c.reloptions, ',') INTO v_invoker
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'perception' AND c.relname = 'v_published_models';
    IF coalesce(v_invoker, '') LIKE '%security_invoker%' THEN
        RAISE EXCEPTION
            'v_published_models NO debe tener security_invoker: ver la cabecera de 0070';
    END IF;

    SELECT count(*) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'perception' AND table_name = 'v_published_models'
       AND column_name IN ('weights_asset_id', 'weights_object_path');
    IF v_cols <> 2 THEN
        RAISE EXCEPTION 'faltan las columnas de pesos: hay % de 2', v_cols;
    END IF;

    RAISE NOTICE '0077 OK · el catalogo publicado dice donde estan los pesos';
END $$;
