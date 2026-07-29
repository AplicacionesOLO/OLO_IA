-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0009_create_companies.sql
-- Revierte    : core.companies
--
-- Nota: SIN CASCADE. core.warehouses (0012) apuntará aquí con FK compuesta;
--       a partir de entonces este DROP fallará a propósito.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS core.companies;
