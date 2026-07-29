-- Rollback de 0011_create_tenant_memberships.sql
-- Revierte: core.tenant_memberships
-- Nota: SIN CASCADE. core.role_assignments y core.user_warehouse_access (0014)
--       apuntaran aqui con FK compuesta; entonces este DROP fallara a proposito.
--       Revertir esta tabla con la cadena de autorizacion aplicada dejaria roles
--       y accesos huerfanos.
DROP TABLE IF EXISTS core.tenant_memberships;
