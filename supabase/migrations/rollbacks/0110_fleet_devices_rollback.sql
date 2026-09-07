-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0110 · Se quita el registro de flota
--
-- ORDEN: primero `role_permissions` (la FK a `core.permissions.code` es
-- `NO ACTION`, no `CASCADE` -- ver 0013 -- asi que borrar el permiso antes
-- fallaria con una violacion de FK), despues los permisos, y por ultimo la
-- tabla y la funcion.
-- ═══════════════════════════════════════════════════════════════════════════════

DELETE FROM core.role_permissions
 WHERE permission_code IN ('drones:read', 'drones:write', 'drones:ingest');

DELETE FROM core.permissions WHERE code IN ('drones:read', 'drones:write', 'drones:ingest');

DROP FUNCTION IF EXISTS core.fleet_device_status(text, timestamptz, uuid);
DROP TABLE IF EXISTS core.fleet_devices;

DO $$
BEGIN
    RAISE NOTICE 'OK - 0110 deshecha.';
END $$;
