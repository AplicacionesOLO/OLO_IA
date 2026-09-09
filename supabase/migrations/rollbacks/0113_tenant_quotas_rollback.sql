-- Rollback de 0113_tenant_quotas.sql

DROP FUNCTION IF EXISTS core.fijar_cuota_tenant(uuid, int, int);
DROP TABLE IF EXISTS core.tenant_quotas;
