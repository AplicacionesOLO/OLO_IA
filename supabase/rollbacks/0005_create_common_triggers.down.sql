-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0005_create_common_triggers.sql
-- Revierte    : las dos funciones de trigger
--
-- Nota 1: sin CASCADE. Si una tabla de una migración posterior tiene un trigger
--         enganchado a estas funciones, el DROP **falla a propósito**. Con
--         CASCADE se eliminarían esos triggers y las tablas quedarían sin la
--         protección de inmutabilidad de tenant_id, que es peor que no poder
--         revertir.
-- Nota 2: la tabla de sonda core.__probe_0005 no se elimina aquí porque la
--         propia migración la destruye. El DROP IF EXISTS queda como red por
--         si la migración se hubiera interrumpido a mitad.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE    IF EXISTS core.__probe_0005;
DROP FUNCTION IF EXISTS core.prevent_tenant_change();
DROP FUNCTION IF EXISTS core.set_updated_at();
