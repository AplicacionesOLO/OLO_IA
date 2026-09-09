-- Rollback de 0112_usage_metering.sql

DELETE FROM core.role_permissions WHERE permission_code = 'usage:read';
DELETE FROM core.permissions WHERE code = 'usage:read';
