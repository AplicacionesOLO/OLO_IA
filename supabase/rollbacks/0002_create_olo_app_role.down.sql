-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0002_create_olo_app_role.sql
-- Revierte    : el rol olo_app y todos sus privilegios
-- Orden       : privilegios por defecto → privilegios de schema → rol
--
-- Nota 1: NO se usa REASSIGN OWNED BY ni DROP OWNED BY. En Supabase el rol
--         `postgres` no es superusuario ni miembro de `olo_app`, así que ambos
--         fallan con:
--             ERROR 42501: permission denied to reassign objects
--         No son necesarios: `olo_app` no tiene CREATE en ningún schema, así
--         que por diseño no puede poseer objetos. El punto 3 lo verifica en
--         lugar de darlo por supuesto.
-- Nota 2: los ALTER DEFAULT PRIVILEGES se revierten explícitamente. Sin eso,
--         DROP ROLE falla porque el rol sigue referenciado en pg_default_acl.
-- Nota 3: NO se tocan los schemas de 0001 ni los roles de Supabase.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_owned int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'olo_app') THEN
        RAISE NOTICE 'olo_app no existe: nada que revertir';
        RETURN;
    END IF;

    -- 1. Privilegios por defecto sobre objetos futuros
    IF to_regnamespace('core') IS NOT NULL THEN
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA core
            REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM olo_app;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA core
            REVOKE USAGE, SELECT ON SEQUENCES FROM olo_app;
    END IF;

    IF to_regnamespace('audit') IS NOT NULL THEN
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit
            REVOKE SELECT, INSERT ON TABLES FROM olo_app;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit
            REVOKE USAGE, SELECT ON SEQUENCES FROM olo_app;
    END IF;

    -- 2. Privilegios sobre los schemas
    IF to_regnamespace('core')  IS NOT NULL THEN REVOKE ALL ON SCHEMA core  FROM olo_app; END IF;
    IF to_regnamespace('audit') IS NOT NULL THEN REVOKE ALL ON SCHEMA audit FROM olo_app; END IF;

    -- 3. Verificación en lugar de REASSIGN: si el rol posee algo, abortar en
    --    vez de destruirlo. Un rollback nunca debe perder objetos.
    SELECT (SELECT count(*) FROM pg_class     c JOIN pg_roles r ON r.oid = c.relowner  WHERE r.rolname = 'olo_app')
         + (SELECT count(*) FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner  WHERE r.rolname = 'olo_app')
         + (SELECT count(*) FROM pg_proc      p JOIN pg_roles r ON r.oid = p.proowner   WHERE r.rolname = 'olo_app')
      INTO v_owned;

    IF v_owned > 0 THEN
        RAISE EXCEPTION
            'olo_app posee % objeto(s). Rollback abortado para no perder datos: reasignar manualmente.', v_owned;
    END IF;
END
$$;

DROP ROLE IF EXISTS olo_app;
