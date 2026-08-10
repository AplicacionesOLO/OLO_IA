-- ═══════════════════════════════════════════════════════════════════════════════
-- Rollback de 0089 · quita `project_id` del catálogo de modelos publicados
--
-- Deshacer esto ROMPE mandar fotogramas de una inspección a anotar: la pantalla de Visión
-- se queda sin saber a qué proyecto de IA pertenece el modelo con el que se analizó, y sin
-- eso el destino del dataset habría que adivinarlo.
--
-- `CREATE OR REPLACE VIEW` no puede QUITAR columnas —solo añadirlas al final—, así que
-- aquí hace falta DROP + CREATE. Y `DROP VIEW` se lleva los permisos con él: por eso el
-- `GRANT` vuelve a estar abajo. Olvidarlo dejaría la vista existiendo y `olo_app` sin
-- poder leerla, que se manifiesta como un 500 al abrir Visión y no como «falta un grant».
-- ═══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS perception.v_published_models;

CREATE VIEW perception.v_published_models AS
 SELECT mv.id AS model_version_id,
    mv.model_id,
    mv.version,
    mv.origin,
    mv.published_at,
    mv.weights_asset_id,
    a.object_path AS weights_object_path,
    m.name,
    m.slug,
    m.task,
    m.input_type,
    m.architecture_code,
    m.purpose,
    ar.display_name AS architecture_name,
    ar.framework_code,
    ar.supported_tasks,
    ar.supported_input_types,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'index', mc.training_index, 'color', c.color) ORDER BY mc.training_index) AS jsonb_agg
           FROM ai.model_classes mc
             JOIN ai.classes c ON c.id = mc.class_id
          WHERE mc.model_id = m.id AND c.deleted_at IS NULL), '[]'::jsonb) AS classes
   FROM ai.model_versions mv
     JOIN ai.models m ON m.id = mv.model_id
     LEFT JOIN ai.architectures ar ON ar.code::text = m.architecture_code::text
     LEFT JOIN ai.assets a ON a.id = mv.weights_asset_id
  WHERE mv.status::text = 'published'::text AND mv.deleted_at IS NULL
    AND m.deleted_at IS NULL;

GRANT SELECT ON perception.v_published_models TO olo_app;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'perception' AND table_name = 'v_published_models'
           AND column_name = 'project_id'
    ) THEN
        RAISE EXCEPTION 'la vista sigue exponiendo project_id';
    END IF;

    -- Los pesos son lo que permite al worker usar el modelo entrenado en vez de caer al
    -- preentrenado de COCO. Si el DROP+CREATE los perdiera, el rollback dejaría el sistema
    -- «funcionando» pero detectando otra cosa.
    IF NOT EXISTS (
        SELECT 1 FROM perception.v_published_models
         WHERE weights_asset_id IS NOT NULL AND weights_object_path IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'la vista perdio los pesos al recrearse';
    END IF;

    RAISE NOTICE 'OK · vuelta atras: sin project_id y con los pesos intactos';
END $$;
