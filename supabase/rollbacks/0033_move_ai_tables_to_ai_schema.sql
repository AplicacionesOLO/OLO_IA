-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0033_move_ai_tables_to_ai_schema.sql
--
-- Devuelve las 7 tablas y las 2 funciones a `platform` con su nombre original.
-- Es lo que vuelve a hacer válidos los rollbacks de 0025-0030, que nombran
-- `platform.ai_*` y no se modificaron.
--
-- ⚠ Aborta si existen tablas del Bloque 0.5 (models, model_versions,
--   model_classes, frameworks, architectures): tienen FK hacia las tablas que se
--   van, y quedarían apuntando a otro schema.
--
-- Preserva los datos igual que la ida: SET SCHEMA es un cambio de catálogo.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_nuevas int;
BEGIN
    SELECT count(1) INTO v_nuevas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relkind = 'r'
       AND c.relname IN ('frameworks','architectures','models',
                         'model_versions','model_classes');
    IF v_nuevas > 0 THEN
        RAISE EXCEPTION
            'Hay % tablas del Bloque 0.5 que dependen de estas. Revierte 0035-0039 primero.',
            v_nuevas;
    END IF;
END
$$;

ALTER TABLE ai.projects         RENAME TO ai_projects;
ALTER TABLE ai.classes          RENAME TO ai_classes;
ALTER TABLE ai.assets           RENAME TO ai_assets;
ALTER TABLE ai.images           RENAME TO ai_images;
ALTER TABLE ai.dataset_versions RENAME TO ai_dataset_versions;
ALTER TABLE ai.dataset_items    RENAME TO ai_dataset_items;
ALTER TABLE ai.annotations      RENAME TO ai_annotations;

ALTER TABLE ai.ai_projects         SET SCHEMA platform;
ALTER TABLE ai.ai_classes          SET SCHEMA platform;
ALTER TABLE ai.ai_assets           SET SCHEMA platform;
ALTER TABLE ai.ai_images           SET SCHEMA platform;
ALTER TABLE ai.ai_dataset_versions SET SCHEMA platform;
ALTER TABLE ai.ai_dataset_items    SET SCHEMA platform;
ALTER TABLE ai.ai_annotations      SET SCHEMA platform;

ALTER FUNCTION ai.prevent_class_index_change()   SET SCHEMA platform;
ALTER FUNCTION ai.reject_frozen_dataset_change() SET SCHEMA platform;

DO $$
DECLARE
    v_platform int;
    v_ai       int;
    v_pol      int;
BEGIN
    SELECT count(1) INTO v_platform
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r' AND c.relname LIKE 'ai_%';
    IF v_platform <> 7 THEN
        RAISE EXCEPTION 'se esperaban 7 tablas ai_* en platform, hay %', v_platform;
    END IF;

    SELECT count(1) INTO v_ai
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relkind = 'r';
    IF v_ai <> 0 THEN
        RAISE EXCEPTION 'el schema ai debía quedar vacío, tiene % tablas', v_ai;
    END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'platform' AND tablename LIKE 'ai_%';
    IF v_pol <> 26 THEN
        RAISE EXCEPTION 'las 26 políticas debían volver con las tablas, hay %', v_pol;
    END IF;

    RAISE NOTICE 'OK rollback 0033: 7 tablas y 2 funciones de vuelta en platform, 26 politicas intactas';
END
$$;
