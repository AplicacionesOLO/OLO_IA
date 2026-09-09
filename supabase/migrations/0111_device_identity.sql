-- ═══════════════════════════════════════════════════════════════════════════
-- 0111_device_identity.sql
-- Crea      : core.roles ('device'), sus permisos, core.fleet_devices.auth_user_id
-- Depende de: 0013 (roles/permisos), 0069 (perception:ingest), 0110 (fleet_devices,
--             drones:ingest)
-- Riesgo    : medio -- crea un rol de sistema nuevo, pero NO toca el Hook
--             (public.custom_access_token_hook) ni ninguna politica RLS existente.
--
-- ── EL PROBLEMA QUE RESUELVE ─────────────────────────────────────────────────
--
-- Hoy el S21 (y cualquier dispositivo de borde) inicia sesion con el email y la
-- password de una PERSONA (ver `gradle.properties` del prototipo). Eso significa
-- que revocar el acceso de un telefono perdido exige cambiarle la contraseña a
-- un HUMANO, y que ese telefono puede hacer todo lo que esa persona puede hacer
-- -- mucho mas de lo que un dispositivo necesita para mandar detecciones.
--
-- Este rol es la mitad de base de datos de la solucion: una identidad que solo
-- puede `perception:ingest` y `drones:ingest`, nada de lectura ni escritura de
-- ningun otro dato del tenant. La otra mitad -- COMO se le da esa identidad a un
-- dispositivo sin usar `service_role` -- vive en `FleetService.provision()`
-- (backend), que crea un usuario anonimo de Supabase Auth por dispositivo y lo
-- vincula aqui.
--
-- ── POR QUE NO HACE FALTA TOCAR EL HOOK ──────────────────────────────────────
--
-- `public.custom_access_token_hook` (0016) resuelve `tenant_id` uniendo
-- `core.users.auth_id` contra `core.tenant_memberships` -- exactamente igual
-- para un usuario anonimo que para uno con email confirmado. Un dispositivo
-- provisionado es, para el Hook, un usuario mas con una membresia activa: cero
-- lineas nuevas en la funcion de mayor riesgo declarado del proyecto.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El rol ────────────────────────────────────────────────────────────────
INSERT INTO core.roles (id, tenant_id, name, description, is_system) VALUES
    ('00000000-0000-0000-0000-0000000000a6', NULL, 'device',
     'Identidad de un dispositivo de borde (telefono, dron): solo puede '
     'depositar sus propias detecciones y su latido, nunca leer nada del '
     'tenant. Se asigna UNA vez por dispositivo, nunca a una persona.', true)
ON CONFLICT (id) DO NOTHING;

-- Global y no por almacen: `core.tiene_permiso(codigo, NULL)` -- que es como se
-- llama desde `require(...)` en los endpoints de ingesta, sin `X-Warehouse-Id`
-- -- acepta CUALQUIER alcance cuando no se pasa almacen (ver la funcion, 0080),
-- asi que un scope por almacen no anadiria restriccion real hoy y si anadiria
-- una casilla mas que mantener sincronizada con el almacen del dispositivo.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, codigo
  FROM core.roles r
  CROSS JOIN (VALUES ('perception:ingest'), ('drones:ingest')) AS p(codigo)
 WHERE r.name = 'device'
ON CONFLICT DO NOTHING;

-- ── El vinculo con la flota ───────────────────────────────────────────────
-- NULL en los dispositivos ya registrados (los que siguen entrando con el
-- email/password de una persona, via `FleetHeartbeat`) -- no son "menos
-- dispositivo" por no tener credencial propia todavia, y forzar el campo
-- habria roto el latido de todo lo que ya esta en campo.
ALTER TABLE core.fleet_devices
    ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES core.users(id);

CREATE INDEX IF NOT EXISTS idx_fleet_devices_auth_user
    ON core.fleet_devices (auth_user_id) WHERE auth_user_id IS NOT NULL;

COMMENT ON COLUMN core.fleet_devices.auth_user_id IS
    'La identidad propia del dispositivo (core.users.id), si se provisiono con '
    'FleetService.provision(). NULL = sigue usando la credencial compartida de '
    'una persona -- ver el comentario de clase de esta migracion.';

-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
DECLARE
    v_id   uuid;
    v_perm int;
BEGIN
    SELECT id INTO v_id FROM core.roles WHERE name = 'device' AND tenant_id IS NULL;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'el rol device no se creo';
    END IF;

    SELECT count(*) INTO v_perm FROM core.role_permissions WHERE role_id = v_id;
    IF v_perm <> 2 THEN
        RAISE EXCEPTION 'device deberia tener exactamente 2 permisos, tiene %', v_perm;
    END IF;

    IF EXISTS (
        SELECT 1 FROM core.role_permissions
         WHERE role_id = v_id AND permission_code NOT IN ('perception:ingest', 'drones:ingest')
    ) THEN
        RAISE EXCEPTION 'device tiene un permiso fuera de perception:ingest/drones:ingest -- fuga de privilegio';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'fleet_devices'
           AND column_name = 'auth_user_id'
    ) THEN
        RAISE EXCEPTION 'falta core.fleet_devices.auth_user_id';
    END IF;
END
$$;
