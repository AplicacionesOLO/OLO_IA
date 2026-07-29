-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0006_verify_context_propagation.sql
-- Revierte    : nada. 0006 es una migración de verificación que no deja
--               objetos permanentes: crea su sonda, la prueba y la destruye.
--
-- Este archivo existe por dos razones:
--   1. La regla de que toda migración tenga su rollback correspondiente.
--   2. Red de seguridad: si 0006 se hubiera interrumpido a mitad —lo que no
--      debería ocurrir, porque se aplica en una sola transacción— podría
--      quedar la tabla de sonda o el USAGE temporal concedido a
--      `authenticated`. Estas dos sentencias restituyen ese estado.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS core.__context_poc;

-- Devuelve el USAGE temporal a su estado previo. Por decisión aprobada,
-- `authenticated` NO debe tener USAGE sobre core todavía.
DO $$
BEGIN
    IF to_regnamespace('core') IS NOT NULL THEN
        REVOKE USAGE ON SCHEMA core FROM authenticated;
    END IF;
END
$$;
