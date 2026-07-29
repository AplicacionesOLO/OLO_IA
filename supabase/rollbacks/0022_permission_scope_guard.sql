-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0022_permission_scope_guard.sql
--
-- ⚠ Aborta si existen permisos con scope='platform' (los siembra 0023). Quitar
--   la columna dejaría esos permisos indistinguibles de los de tenant y, sin el
--   trigger, asignables a un rol — reabriendo la escalada que 0022 cierra.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_platform int;
BEGIN
    SELECT count(1) INTO v_platform FROM core.permissions WHERE scope = 'platform';
    IF v_platform > 0 THEN
        RAISE EXCEPTION
            'Hay % permisos de alcance plataforma. Revierte 0023 primero.', v_platform;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_role_permissions_scope_guard ON core.role_permissions;
DROP FUNCTION IF EXISTS core.reject_platform_permission_on_role();

ALTER TABLE core.permissions DROP CONSTRAINT IF EXISTS chk_perm_scope;
ALTER TABLE core.permissions DROP COLUMN IF EXISTS scope;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'core' AND table_name = 'permissions'
                  AND column_name = 'scope') THEN
        RAISE EXCEPTION 'la columna scope sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'core' AND c.relname = 'role_permissions'
                  AND t.tgname = 'trg_role_permissions_scope_guard') THEN
        RAISE EXCEPTION 'el trigger sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0022: columna scope, constraint, trigger y función eliminados';
END
$$;
