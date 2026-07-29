-- Rollback de 0014_create_authorization_tables.sql
-- Orden inverso: user_warehouse_access referencia role_assignments.
-- SIN CASCADE.
DROP TABLE IF EXISTS core.user_warehouse_access;
DROP TABLE IF EXISTS core.role_assignments;