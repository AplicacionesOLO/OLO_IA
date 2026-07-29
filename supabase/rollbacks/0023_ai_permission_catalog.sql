-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0023_ai_permission_catalog.sql
--
-- Borra los 23 permisos de alcance plataforma. Seguro por construcción: el
-- trigger de 0022 garantiza que ninguno puede estar referenciado desde
-- core.role_permissions, así que no hay FK que violar.
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM core.permissions WHERE scope = 'platform';

DO $$
DECLARE
    v_platform int;
    v_tenant   int;
BEGIN
    SELECT count(1) FILTER (WHERE scope = 'platform'),
           count(1) FILTER (WHERE scope = 'tenant')
      INTO v_platform, v_tenant
      FROM core.permissions;

    IF v_platform <> 0 THEN
        RAISE EXCEPTION 'quedan % permisos de plataforma', v_platform;
    END IF;
    IF v_tenant <> 30 THEN
        RAISE EXCEPTION 'los 30 permisos de tenant debían quedar intactos, hay %', v_tenant;
    END IF;

    RAISE NOTICE 'OK rollback 0023: 23 permisos eliminados, los 30 de tenant intactos';
END
$$;
