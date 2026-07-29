-- Rollback de 0013_create_permissions_and_roles.sql
-- Orden inverso. role_permissions tiene ON DELETE CASCADE hacia roles, pero se
-- elimina primero de forma explicita para que el rollback sea legible.
-- SIN CASCADE en los DROP TABLE: core.role_assignments (0014) apuntara a roles;
-- entonces ese DROP fallara a proposito.
DROP TABLE    IF EXISTS core.role_permissions;
DROP TABLE    IF EXISTS core.roles;
DROP FUNCTION IF EXISTS core.prevent_role_cycle();
DROP TABLE    IF EXISTS core.permissions;