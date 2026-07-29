-- ═══════════════════════════════════════════════════════════════════════════
-- 0022_permission_scope_guard.sql
-- Altera   : core.permissions (columna `scope`, aditiva)
-- Crea     : core.reject_platform_permission_on_role() + trigger sobre
--            core.role_permissions
-- Depende de: 0013
-- Riesgo   : medio — altera una tabla ya aplicada y añade un trigger a la ruta
--            de asignación de permisos
--
-- ⚠ ESTA MIGRACIÓN CIERRA UNA VÍA DE ESCALADA DE PRIVILEGIOS.
--
--   `core.roles` admite roles personalizados por tenant (`roles.tenant_id` es
--   nullable; los de sistema lo tienen NULL). `core.role_permissions` no tiene
--   ninguna guarda de alcance: cualquier código de permiso puede mapearse a
--   cualquier rol.
--
--   Sin esto, un `tenant_admin` podría crear un rol propio, asignarle
--   `ai_models:publish` y otorgárselo a un usuario de su tenant. Ese usuario
--   tendría el permiso en su `/v1/auth/me`, y bastaría UN endpoint del módulo
--   que comprobara el permiso en lugar de `is_platform_owner()` para que
--   publicara modelos de la plataforma.
--
--   La defensa correcta es doble, y las dos capas van en el Bloque 0:
--     1. AQUÍ, en el motor: un permiso de plataforma no puede entrar en un rol
--        de tenant. La escalada es imposible aunque el código se equivoque.
--     2. En la aplicación: todo endpoint del módulo pasa por
--        require_platform_owner() ANTES de mirar cualquier permiso.
--
--   Confiar solo en la capa 2 es confiar en que ningún endpoint futuro se
--   escriba mal.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE core.permissions
    ADD COLUMN scope varchar(10) NOT NULL DEFAULT 'tenant';

ALTER TABLE core.permissions
    ADD CONSTRAINT chk_perm_scope CHECK (scope IN ('tenant', 'platform'));

COMMENT ON COLUMN core.permissions.scope IS
    'tenant: asignable a roles de tenant. platform: solo por platform.owners, y el trigger de role_permissions lo impide.';

-- Las 30 filas existentes quedan 'tenant' por el DEFAULT, que es lo correcto:
-- todas son permisos de tenant.


-- ── La guarda ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.reject_platform_permission_on_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_scope text;
BEGIN
    SELECT p.scope INTO v_scope
      FROM core.permissions p
     WHERE p.code = NEW.permission_code;

    IF v_scope = 'platform' THEN
        RAISE EXCEPTION
            'El permiso % es de alcance PLATAFORMA y no puede asignarse a un rol '
            'de tenant. Se concede registrando al usuario en platform.owners.',
            NEW.permission_code
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION core.reject_platform_permission_on_role() IS
    'Cierra la escalada rol-de-tenant -> permiso-de-plataforma. Defensa en el motor, no en la aplicacion.';

CREATE TRIGGER trg_role_permissions_scope_guard
    BEFORE INSERT OR UPDATE ON core.role_permissions
    FOR EACH ROW
    EXECUTE FUNCTION core.reject_platform_permission_on_role();


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_tenant   int;
    v_platform int;
    v_rechazado boolean := false;
    v_rol_id   uuid;
BEGIN
    SELECT count(1) FILTER (WHERE scope = 'tenant'),
           count(1) FILTER (WHERE scope = 'platform')
      INTO v_tenant, v_platform
      FROM core.permissions;

    IF v_platform <> 0 THEN
        RAISE EXCEPTION 'todavía no debería haber permisos de plataforma, hay %', v_platform;
    END IF;

    -- Prueba viva de que el trigger muerde: se marca un permiso existente como
    -- de plataforma, se intenta asignarlo a un rol y se deshace todo. Verificar
    -- que el trigger existe no demuestra que funcione.
    UPDATE core.permissions SET scope = 'platform' WHERE code = 'reports:read';
    SELECT id INTO v_rol_id FROM core.roles WHERE name = 'viewer' AND is_system;

    BEGIN
        INSERT INTO core.role_permissions (role_id, permission_code)
        VALUES (v_rol_id, 'reports:read')
        ON CONFLICT DO NOTHING;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_rechazado := true;
    END;

    UPDATE core.permissions SET scope = 'tenant' WHERE code = 'reports:read';

    IF NOT v_rechazado THEN
        RAISE EXCEPTION 'el trigger NO rechazó un permiso de plataforma en un rol de tenant';
    END IF;

    RAISE NOTICE
        'OK 0022: % permisos de tenant, 0 de plataforma, guarda verificada en vivo',
        v_tenant;
END
$$;
