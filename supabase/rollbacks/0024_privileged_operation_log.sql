-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0024_privileged_operation_log.sql
--
-- ⚠ Destruye un registro de auditoría. En un entorno real esto no debería
--   hacerse sin exportarlo antes; aquí es aceptable porque el Bloque 0 es la
--   primera aplicación y no hay historia que perder. Se avisa del volumen
--   destruido para que quede constancia en la salida.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_filas int;
BEGIN
    SELECT count(1) INTO v_filas FROM platform.privileged_operation_log;
    IF v_filas > 0 THEN
        RAISE NOTICE
            'AVISO: se van a destruir % registros de auditoría privilegiada', v_filas;
    END IF;
END
$$;

DROP POLICY IF EXISTS polog_insert        ON platform.privileged_operation_log;
DROP POLICY IF EXISTS polog_read          ON platform.privileged_operation_log;
DROP POLICY IF EXISTS polog_platform_only ON platform.privileged_operation_log;

DROP TABLE IF EXISTS platform.privileged_operation_log;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'platform' AND c.relname = 'privileged_operation_log') THEN
        RAISE EXCEPTION 'la tabla sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0024: tabla y políticas eliminadas';
END
$$;
