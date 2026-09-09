-- Rollback de 0111_device_identity.sql

ALTER TABLE core.fleet_devices DROP COLUMN IF EXISTS auth_user_id;

-- Explicito aunque role_permissions.role_id tenga ON DELETE CASCADE hacia
-- core.roles: mejor no depender de memoria sobre que FK cascada y cual no.
DELETE FROM core.role_permissions
 WHERE role_id = '00000000-0000-0000-0000-0000000000a6';

DELETE FROM core.roles WHERE id = '00000000-0000-0000-0000-0000000000a6';
