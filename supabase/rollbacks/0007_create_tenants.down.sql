-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0007_create_tenants.sql
-- Revierte    : core.tenants
--
-- Nota 1: DROP TABLE se lleva en cascada sus índices, políticas RLS y
--         triggers. No hace falta borrarlos por separado.
-- Nota 2: SIN CASCADE. Cuando una migración posterior cree una FK hacia
--         core.tenants —core.tenant_countries en 0008 será la primera— este
--         DROP **fallará a propósito**. Revertir 0007 con tablas hijas
--         aplicadas destruiría datos de tenant, que es el peor resultado
--         posible de un rollback.
-- Nota 3: no se tocan las funciones de 0004/0005: las usan las políticas de
--         esta tabla, pero son objetos de otras migraciones.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS core.tenants;
