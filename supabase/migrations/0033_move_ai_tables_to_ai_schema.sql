-- ═══════════════════════════════════════════════════════════════════════════
-- 0033_move_ai_tables_to_ai_schema.sql
-- Mueve    : 7 tablas y 2 funciones de `platform` a `ai`, sin el prefijo `ai_`
-- Depende de: 0031 (schema ai), 0025-0030 aplicadas
-- Riesgo   : MEDIO-ALTO
--
-- El riesgo no está en el ALTER —es un cambio de catálogo, no reescribe datos—
-- sino en que después de él TODO el SQL escrito que nombre `platform.ai_*` deja
-- de resolver. Los tests se actualizan en el mismo paso.
--
-- QUÉ VIAJA SOLO CON LA TABLA, sin necesidad de reescribirlo:
--   · los datos             (SET SCHEMA no reescribe la tabla)
--   · las 26 políticas RLS  (con sus nombres, y siguen invocando core.is_platform_owner())
--   · los 8 triggers        (referencian su función por OID, no por nombre)
--   · índices y constraints (con sus nombres)
--   · los privilegios de olo_app (la ACL está en la tabla, no en el schema)
--   · las FK compuestas entre las 7 tablas
--
-- QUÉ NO SE MUEVE, Y POR QUÉ:
--   · core.is_platform_owner()                → primitiva de seguridad, vive en core
--   · platform.prevent_last_owner_revocation()→ gobierno de plataforma
--
-- Al terminar, `platform` queda con 2 tablas —owners y privileged_operation_log—
-- y cumple su cometido: gobierno de plataforma y nada más.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Las 7 tablas ───────────────────────────────────────────────────────────
ALTER TABLE platform.ai_projects         SET SCHEMA ai;
ALTER TABLE platform.ai_classes          SET SCHEMA ai;
ALTER TABLE platform.ai_assets           SET SCHEMA ai;
ALTER TABLE platform.ai_images           SET SCHEMA ai;
ALTER TABLE platform.ai_dataset_versions SET SCHEMA ai;
ALTER TABLE platform.ai_dataset_items    SET SCHEMA ai;
ALTER TABLE platform.ai_annotations      SET SCHEMA ai;

-- El prefijo lo aporta ahora el schema: ai.projects, no ai.ai_projects.
ALTER TABLE ai.ai_projects         RENAME TO projects;
ALTER TABLE ai.ai_classes          RENAME TO classes;
ALTER TABLE ai.ai_assets           RENAME TO assets;
ALTER TABLE ai.ai_images           RENAME TO images;
ALTER TABLE ai.ai_dataset_versions RENAME TO dataset_versions;
ALTER TABLE ai.ai_dataset_items    RENAME TO dataset_items;
ALTER TABLE ai.ai_annotations      RENAME TO annotations;

-- ── Las 2 funciones de trigger del dominio de IA ───────────────────────────
ALTER FUNCTION platform.prevent_class_index_change()   SET SCHEMA ai;
ALTER FUNCTION platform.reject_frozen_dataset_change() SET SCHEMA ai;

COMMENT ON FUNCTION ai.prevent_class_index_change() IS
    'Inmutabilidad de class_index y project_id. En el motor y no solo en la API: una migracion o un script manual pueden cambiarlo igual.';
COMMENT ON FUNCTION ai.reject_frozen_dataset_change() IS
    'Aborta UPDATE y DELETE. Sin politica RLS el UPDATE quedaria en 0 filas EN SILENCIO, que no es lo mismo que rechazado.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_en_ai       int;
    v_en_platform int;
    v_politicas   int;
    v_triggers    int;
    v_fk_comp     int;
    v_indices     int;
    v_checks      int;
    v_funciones   int;
    v_grants      int;
    v_force       int;
    r             record;
BEGIN
    -- 1 · Las 7 están en ai, con los nombres nuevos
    SELECT count(1) INTO v_en_ai
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relkind = 'r'
       AND c.relname IN ('projects','classes','assets','images',
                         'dataset_versions','dataset_items','annotations');
    IF v_en_ai <> 7 THEN
        RAISE EXCEPTION 'se esperaban 7 tablas en ai, hay %', v_en_ai;
    END IF;

    -- 2 · platform queda SOLO con gobierno
    SELECT count(1) INTO v_en_platform
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r';
    IF v_en_platform <> 2 THEN
        RAISE EXCEPTION
            'platform debe quedar con 2 tablas de gobierno, tiene %', v_en_platform;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'platform' AND c.relkind = 'r' AND c.relname LIKE 'ai_%'
    ) THEN
        RAISE EXCEPTION 'queda alguna tabla ai_* en platform';
    END IF;

    -- 3 · Las políticas viajaron: 26 sobre las 7 tablas
    SELECT count(1) INTO v_politicas FROM pg_policies
     WHERE schemaname = 'ai'
       AND tablename IN ('projects','classes','assets','images',
                         'dataset_versions','dataset_items','annotations');
    IF v_politicas <> 26 THEN
        RAISE EXCEPTION 'se esperaban 26 políticas en ai, hay %', v_politicas;
    END IF;

    -- 4 · RLS sigue activada Y forzada en las 7
    SELECT count(1) INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relkind = 'r'
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_force <> 7 THEN
        RAISE EXCEPTION 'las 7 tablas necesitan RLS forzada, la tienen %', v_force;
    END IF;

    -- 5 · Los 8 triggers viajaron
    SELECT count(1) INTO v_triggers
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND NOT t.tgisinternal;
    IF v_triggers <> 8 THEN
        RAISE EXCEPTION 'se esperaban 8 triggers en ai, hay %', v_triggers;
    END IF;

    -- 6 · Las FK compuestas de 2 columnas siguen ahí: 2 en images, 2 en
    --     dataset_items, 2 en annotations
    SELECT count(1) INTO v_fk_comp
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'ai' AND c.contype = 'f' AND array_length(c.conkey, 1) = 2;
    IF v_fk_comp <> 6 THEN
        RAISE EXCEPTION 'se esperaban 6 FK compuestas en ai, hay %', v_fk_comp;
    END IF;

    -- 7 · Ninguna FK quedó apuntando a platform
    FOR r IN
        SELECT c.conname, t.relname
          FROM pg_constraint c
          JOIN pg_class t  ON t.oid = c.conrelid
          JOIN pg_class rt ON rt.oid = c.confrelid
          JOIN pg_namespace n  ON n.oid = t.relnamespace
          JOIN pg_namespace rn ON rn.oid = rt.relnamespace
         WHERE n.nspname = 'ai' AND c.contype = 'f' AND rn.nspname = 'platform'
    LOOP
        RAISE EXCEPTION 'la FK %.% sigue apuntando a platform', r.relname, r.conname;
    END LOOP;

    -- 8 · Índices y CHECK siguen presentes
    SELECT count(1) INTO v_indices FROM pg_indexes WHERE schemaname = 'ai';
    SELECT count(1) INTO v_checks
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'ai' AND c.contype = 'c';

    -- 9 · Las 2 funciones están en ai y ya no en platform
    SELECT count(1) INTO v_funciones
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'ai'
       AND p.proname IN ('prevent_class_index_change', 'reject_frozen_dataset_change');
    IF v_funciones <> 2 THEN
        RAISE EXCEPTION 'se esperaban 2 funciones en ai, hay %', v_funciones;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'platform'
           AND p.proname IN ('prevent_class_index_change','reject_frozen_dataset_change')
    ) THEN
        RAISE EXCEPTION 'las funciones de IA siguen en platform';
    END IF;
    -- La de gobierno debe seguir donde estaba
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'platform' AND p.proname = 'prevent_last_owner_revocation'
    ) THEN
        RAISE EXCEPTION 'prevent_last_owner_revocation no debe moverse de platform';
    END IF;

    -- 10 · La ACL viajó con las tablas: olo_app conserva sus privilegios
    SELECT count(1) INTO v_grants
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relkind = 'r'
       AND has_table_privilege('olo_app', c.oid, 'SELECT')
       AND has_table_privilege('olo_app', c.oid, 'INSERT')
       AND has_table_privilege('olo_app', c.oid, 'UPDATE')
       AND has_table_privilege('olo_app', c.oid, 'DELETE');
    IF v_grants <> 7 THEN
        RAISE EXCEPTION
            'olo_app debía conservar arwd en las 7 tablas, lo tiene en %', v_grants;
    END IF;

    RAISE NOTICE
        'OK 0033: 7 tablas en ai · platform con 2 de gobierno · 26 politicas · 8 triggers · 6 FK compuestas · % indices · % checks · 2 funciones · olo_app con arwd en 7',
        v_indices, v_checks;
END
$$;
