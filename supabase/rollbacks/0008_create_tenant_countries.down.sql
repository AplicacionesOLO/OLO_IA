-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0008_create_tenant_countries.sql
-- Revierte    : core.tenant_countries
--
-- Nota: SIN CASCADE. Cuando 0009 cree core.companies con la FK compuesta hacia
--       (tenant_id, id) de esta tabla, este DROP fallará a propósito. Revertir
--       0008 con companies aplicada destruiría datos de tenant.
--       DROP TABLE se lleva sus índices, políticas y triggers.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS core.tenant_countries;
