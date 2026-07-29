-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0019_platform_schema_privileges.sql
--
-- Revierte al estado medido antes de la migración: olo_app sin USAGE sobre
-- platform y sin default privileges.
--
-- ⚠ Solo es seguro si NO existen tablas de 0020+ en el schema. Si existen,
--   revocar el USAGE deja el módulo inoperante en lugar de revertirlo, así que
--   la migración aborta en ese caso.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_tablas int;
BEGIN
    SELECT count(1) INTO v_tablas
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r';

    IF v_tablas > 0 THEN
        RAISE EXCEPTION
            'El schema platform tiene % tablas. Revierte primero 0020-0030.', v_tablas;
    END IF;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
    REVOKE USAGE, SELECT ON SEQUENCES FROM olo_app;

REVOKE USAGE ON SCHEMA platform FROM olo_app;

DO $$
BEGIN
    IF has_schema_privilege('olo_app', 'platform', 'USAGE') THEN
        RAISE EXCEPTION 'el rollback no quitó el USAGE';
    END IF;
    RAISE NOTICE 'OK rollback 0019: olo_app sin USAGE sobre platform';
END
$$;
