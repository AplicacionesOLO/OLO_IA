-- ═══════════════════════════════════════════════════════════════════════════════
-- 0089 · El catálogo de modelos publicados dice a qué PROYECTO pertenecen
--
-- Hace falta para mandar fotogramas de una inspección a anotar: las imágenes de
-- entrenamiento cuelgan de un proyecto de IA (`ai.images.project_id`), y la pantalla de
-- Visión solo conoce el modelo con el que se analizó. Sin esta columna hay que adivinar
-- el proyecto, y adivinar significa que en cuanto haya dos proyectos los fotogramas
-- acaban en el dataset equivocado.
--
-- ── POR QUE ESTO IMPORTA AHORA ────────────────────────────────────────────────
--
-- El dataset son ~20 imágenes y el conjunto de validación tiene UNA sola caja de
-- `qr_ubicacion`. Con un único ejemplo el AP es binario, así que el «AP 0,00» no mide
-- capacidad: se comprobó reentrenando a 736 en vez de 384 y siguió en 0,00 exacto
-- mientras `pallet` bajaba de 0,75 a 0,63 —ruido sobre dos muestras—.
--
-- O sea que el cuello no es el entrenamiento, es el material. Y el material está en los
-- vídeos de inspección que ya se suben.
--
-- `CREATE OR REPLACE VIEW` solo permite AÑADIR columnas al final, así que `project_id`
-- va al final aunque en la tabla esté al principio.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW perception.v_published_models AS
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
          WHERE mc.model_id = m.id AND c.deleted_at IS NULL), '[]'::jsonb) AS classes,
    mv.project_id
   FROM ai.model_versions mv
     JOIN ai.models m ON m.id = mv.model_id
     LEFT JOIN ai.architectures ar ON ar.code::text = m.architecture_code::text
     LEFT JOIN ai.assets a ON a.id = mv.weights_asset_id
  WHERE mv.status::text = 'published'::text AND mv.deleted_at IS NULL
    AND m.deleted_at IS NULL;

GRANT SELECT ON perception.v_published_models TO olo_app;

DO $$
DECLARE
    v_pid uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'perception' AND table_name = 'v_published_models'
           AND column_name = 'project_id'
    ) THEN
        RAISE EXCEPTION 'la vista no expone project_id';
    END IF;

    -- Y que traiga un valor de verdad: una columna que siempre viniera nula dejaria la
    -- pantalla sin saber a que dataset mandar los fotogramas, con la vista «correcta».
    SELECT project_id INTO v_pid FROM perception.v_published_models LIMIT 1;
    IF v_pid IS NULL THEN
        RAISE EXCEPTION 'project_id viene nulo en el modelo publicado';
    END IF;

    -- Los pesos tienen que seguir ahi: es lo que permite al worker usar el modelo
    -- entrenado en vez de caer al preentrenado de COCO.
    IF NOT EXISTS (
        SELECT 1 FROM perception.v_published_models
         WHERE weights_asset_id IS NOT NULL AND weights_object_path IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'la vista perdio los pesos al recrearse';
    END IF;

    RAISE NOTICE 'OK · el catalogo dice el proyecto (%) y conserva los pesos', v_pid;
END $$;
