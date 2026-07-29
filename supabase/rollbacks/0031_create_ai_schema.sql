-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0031_create_ai_schema.sql
--
-- ⚠ Aborta si el schema tiene tablas: significaría que 0033 o 0035+ están
--   aplicadas y hay que revertirlas primero. Sin esta guarda, el DROP arrastraría
--   datos.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_tablas int;
BEGIN
    SELECT count(1) INTO v_tablas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relkind = 'r';
    IF v_tablas > 0 THEN
        RAISE EXCEPTION
            'El schema ai tiene % tablas. Revierte 0033-0040 primero.', v_tablas;
    END IF;
END
$$;

DROP DOMAIN IF EXISTS ai.annotation_kind;
DROP DOMAIN IF EXISTS ai.input_type;
DROP DOMAIN IF EXISTS ai.task;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ai
    REVOKE USAGE, SELECT ON SEQUENCES FROM olo_app;

REVOKE USAGE ON SCHEMA ai FROM olo_app;

DROP SCHEMA ai;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
        RAISE EXCEPTION 'el schema ai sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0031: schema ai, dominios y privilegios eliminados';
END
$$;
