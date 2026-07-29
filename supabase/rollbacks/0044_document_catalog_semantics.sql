-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0044_document_catalog_semantics.sql
--
-- Restaura los comentarios que dejaron 0036 y 0042. No hay datos ni estructura
-- que revertir: esta migración solo escribió documentación.
--
-- Revertirla no rompe nada, pero deja el esquema sin la advertencia de que el
-- catálogo es vigente y no histórico — que es precisamente el malentendido que
-- 0044 previene.
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN ai.architectures.hyperparam_schema IS
    'Descripcion de los parametros aceptados. El formulario de entrenamiento se genera de aqui. Vacio = pendiente de verificar.';

COMMENT ON COLUMN ai.architectures.default_hyperparams IS NULL;
COMMENT ON COLUMN ai.architectures.min_images_recommended IS NULL;

COMMENT ON TABLE ai.architectures IS
    'Catalogo de CAPACIDADES por arquitectura. Es lo que hace la plataforma agnostica: lo que varia esta en datos, no en condicionales.';

COMMENT ON VIEW ai.models_resolved IS
    'Modelo con su framework y adaptador RESUELTOS por JOIN. security_invoker=true: la RLS de ai.models se aplica al llamante, no al propietario de la vista.';

DO $$
DECLARE
    v_vista text;
BEGIN
    SELECT obj_description(('ai.models_resolved')::regclass::oid) INTO v_vista;
    IF v_vista LIKE '%READ MODEL%' THEN
        RAISE EXCEPTION 'el comentario de la vista no se restauro';
    END IF;
    RAISE NOTICE 'OK rollback 0044: comentarios restaurados a la forma de 0036 y 0042';
END
$$;
