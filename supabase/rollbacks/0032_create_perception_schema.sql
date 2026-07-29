-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0032_create_perception_schema.sql
--
-- ⚠ Aborta si el schema tiene tablas. Ahí vivirían observaciones, que son
--   evidencia del cliente: un DROP CASCADE las destruiría sin posibilidad de
--   regenerarlas — el dron no puede volver a volar el martes pasado.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_tablas int;
BEGIN
    SELECT count(1) INTO v_tablas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'perception' AND c.relkind = 'r';
    IF v_tablas > 0 THEN
        RAISE EXCEPTION
            'perception tiene % tablas con posible evidencia. Revierte el Bloque 7 primero.',
            v_tablas;
    END IF;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA perception
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA perception
    REVOKE USAGE, SELECT ON SEQUENCES FROM olo_app;

REVOKE USAGE ON SCHEMA perception FROM olo_app;

DROP SCHEMA perception;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'perception') THEN
        RAISE EXCEPTION 'el schema perception sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0032: schema perception y privilegios eliminados';
END
$$;
