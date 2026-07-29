-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0004_create_context_functions.sql
-- Revierte    : las tres funciones de contexto
--
-- Nota: sin CASCADE. Si una política RLS de una migración posterior depende de
--       alguna de estas funciones, el DROP **falla a propósito**: eliminarlas
--       con CASCADE destruiría esas políticas y dejaría tablas sin aislamiento
--       multi-tenant, que es el peor resultado posible de un rollback.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS core.has_tenant_wide_access();
DROP FUNCTION IF EXISTS core.current_tenant_id();
DROP FUNCTION IF EXISTS core.current_auth_id();
