-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0104
--
-- Borra core.notifications entera. Se pierde el historial de avisos; nada mas
-- depende de esta tabla.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS core.notifications;

DO $$
BEGIN
    RAISE NOTICE 'OK - 0104 deshecha. core.notifications ya no existe.';
END $$;
