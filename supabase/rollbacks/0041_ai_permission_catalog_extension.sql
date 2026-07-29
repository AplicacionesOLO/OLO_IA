-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0041_ai_permission_catalog_extension.sql
--
-- Borra los 4 permisos añadidos y deja los 23 de 0023. Seguro por construcción:
-- el trigger de 0022 garantiza que ninguno puede estar referenciado desde
-- core.role_permissions, así que no hay FK que violar.
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM core.permissions
 WHERE code IN ('ai_models:write', 'ai_models:import',
                'ai_architectures:read', 'ai_architectures:write');

DO $$
DECLARE
    v_platform int;
    v_tenant   int;
BEGIN
    SELECT count(1) FILTER (WHERE scope = 'platform'),
           count(1) FILTER (WHERE scope = 'tenant')
      INTO v_platform, v_tenant
      FROM core.permissions;

    IF v_platform <> 23 THEN
        RAISE EXCEPTION 'debian quedar los 23 permisos de 0023, hay %', v_platform;
    END IF;
    IF v_tenant <> 30 THEN
        RAISE EXCEPTION 'los 30 de tenant debian quedar intactos, hay %', v_tenant;
    END IF;

    RAISE NOTICE 'OK rollback 0041: 4 permisos eliminados, quedan 23 de plataforma y 30 de tenant';
END
$$;
