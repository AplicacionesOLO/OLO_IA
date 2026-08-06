-- Rollback de 0077: la vista vuelve a no decir donde estan los pesos, y el worker de
-- inferencia vuelve a caer al detector generico. Recrea la definicion de 0070 tal cual.
DROP VIEW IF EXISTS perception.v_published_models;

CREATE VIEW perception.v_published_models AS
SELECT mv.id AS model_version_id, mv.model_id, mv.version, mv.origin, mv.published_at,
       m.name, m.slug, m.task, m.input_type, m.architecture_code, m.purpose,
       a.display_name AS architecture_name, a.framework_code,
       a.supported_tasks, a.supported_input_types,
       COALESCE(
           (SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
                                                'index', mc.training_index, 'color', c.color)
                             ORDER BY mc.training_index)
              FROM ai.model_classes mc JOIN ai.classes c ON c.id = mc.class_id
             WHERE mc.model_id = m.id AND c.deleted_at IS NULL),
           '[]'::jsonb) AS classes
  FROM ai.model_versions mv
  JOIN ai.models m ON m.id = mv.model_id
  LEFT JOIN ai.architectures a ON a.code = m.architecture_code
 WHERE mv.status = 'published' AND mv.deleted_at IS NULL AND m.deleted_at IS NULL;

GRANT SELECT ON perception.v_published_models TO olo_app;
