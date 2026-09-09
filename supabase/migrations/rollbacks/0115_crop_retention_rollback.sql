-- Rollback de 0115_crop_retention.sql

DROP FUNCTION IF EXISTS core.fijar_cuota_tenant(uuid, int, int, int);

-- Vuelve a dejar la funcion de 3 parametros como estaba tras 0114.
CREATE FUNCTION core.fijar_cuota_tenant(
    p_tenant_id  uuid,
    p_max_detecciones int,
    p_max_dispositivos int
)
RETURNS TABLE (
    out_tenant_id uuid,
    out_max_detections_monthly int,
    out_max_devices int,
    out_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := core.current_user_id();
BEGIN
    IF NOT core.is_platform_owner() THEN
        RAISE EXCEPTION 'Solo un platform owner puede fijar cuotas' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM core.tenants t WHERE t.id = p_tenant_id) THEN
        RAISE EXCEPTION 'Tenant % no encontrado', p_tenant_id USING ERRCODE = '23503';
    END IF;

    RETURN QUERY
    INSERT INTO core.tenant_quotas
        (tenant_id, max_detections_monthly, max_devices, updated_by)
    VALUES
        (p_tenant_id, p_max_detecciones, p_max_dispositivos, v_actor)
    ON CONFLICT (tenant_id) DO UPDATE SET
        max_detections_monthly = EXCLUDED.max_detections_monthly,
        max_devices            = EXCLUDED.max_devices,
        updated_at             = now(),
        updated_by             = EXCLUDED.updated_by
    RETURNING tenant_id, max_detections_monthly, max_devices, updated_at;
END;
$$;

REVOKE ALL ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) TO olo_app;

DELETE FROM core.role_permissions WHERE permission_code = 'usage:write';
DELETE FROM core.permissions WHERE code = 'usage:write';

ALTER TABLE core.tenant_quotas DROP COLUMN IF EXISTS crop_retention_days;
