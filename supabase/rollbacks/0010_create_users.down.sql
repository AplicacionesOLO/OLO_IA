-- Rollback de 0010_create_users.sql
-- Revierte: core.users
-- Nota: SIN CASCADE. core.tenant_memberships (0011) apuntara aqui; a partir de
--       entonces este DROP fallara a proposito. No se toca auth.users, que es
--       de Supabase y no fue creada por esta migracion.
DROP TABLE IF EXISTS core.users;
