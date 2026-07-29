-- ═══════════════════════════════════════════════════════════════════════════
-- 0019_platform_schema_privileges.sql
-- Crea     : ninguna tabla. Concede privilegios sobre el schema `platform`.
-- Depende de: 0001 (schema platform), 0002 (rol olo_app)
-- Riesgo   : bajo
--
-- El schema `platform` se creó en 0001 y sigue vacío. `olo_app` NO tiene USAGE
-- sobre él (medido: has_schema_privilege = false). Sin esto, toda consulta del
-- módulo de IA fallaría con 42501 y el síntoma aparecería en el primer endpoint,
-- lejos de su causa — es exactamente el fallo que 0018 tuvo que corregir con el
-- schema `auth`.
--
-- ⚠ `FOR ROLE postgres` es imprescindible, no decorativo.
--   `ALTER DEFAULT PRIVILEGES` solo afecta a objetos futuros creados por el rol
--   indicado. Las migraciones corren como `postgres`; sin la cláusula, el ALTER
--   se aplicaría al rol de la sesión y las tablas de 0025+ nacerían sin
--   permisos para `olo_app`.
--
-- NO se concede CREATE: `olo_app` no debe crear objetos nunca. Todo el DDL pasa
-- por una migración versionada.
-- ═══════════════════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA platform TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA platform
    GRANT USAGE, SELECT ON SEQUENCES TO olo_app;

-- Las funciones del schema no se conceden por defecto a olo_app: las que deba
-- invocar se declararán SECURITY DEFINER y se concederán una a una.

COMMENT ON SCHEMA platform IS
    'Objetos de alcance PLATAFORMA, por encima de los tenants. Aislamiento por core.is_platform_owner(), no por tenant_id.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_usage   boolean;
    v_create  boolean;
    v_default int;
BEGIN
    SELECT has_schema_privilege('olo_app', 'platform', 'USAGE'),
           has_schema_privilege('olo_app', 'platform', 'CREATE')
      INTO v_usage, v_create;

    IF NOT v_usage THEN
        RAISE EXCEPTION 'olo_app debe tener USAGE sobre platform';
    END IF;

    IF v_create THEN
        RAISE EXCEPTION 'olo_app NO debe tener CREATE sobre platform';
    END IF;

    -- Confirma que el default privilege quedó asociado a `postgres` y al schema
    -- correcto. Si se hubiera omitido FOR ROLE, defaclrole apuntaría a otro rol
    -- y esta comprobación lo detectaría.
    SELECT count(1) INTO v_default
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'platform'
       AND d.defaclrole = 'postgres'::regrole;

    IF v_default = 0 THEN
        RAISE EXCEPTION 'no hay default privileges de postgres en platform';
    END IF;

    RAISE NOTICE 'OK 0019: olo_app usage=si create=no, default_acl=% entradas', v_default;
END
$$;
