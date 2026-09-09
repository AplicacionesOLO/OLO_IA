-- ═══════════════════════════════════════════════════════════════════════════
-- 0115_crop_retention.sql
-- Crea      : core.tenant_quotas.crop_retention_days, el permiso usage:write,
--             core.fijar_cuota_tenant() con un cuarto parametro
-- Depende de: 0113/0114 (tenant_quotas), 0112 (usage:read)
-- Riesgo     : medio -- CREATE OR REPLACE que cambia la firma de una funcion
--              en uso (hay que soltarla primero, mismo aviso que 0114).
--
-- ── EL PROBLEMA QUE RESUELVE ─────────────────────────────────────────────────
--
-- Los recortes que sube un dispositivo de borde (`Detection.crop_path`) se
-- acumulan en Storage sin limite: ni se borran solos, ni hay forma de
-- decirles a los viejos que ya cumplieron su proposito (revisar el analisis,
-- mandar a anotar) que se vayan. `crop_retention_days` es el limite -- NULL
-- (por omision, igual que los otros dos campos de esta tabla) significa
-- "conservar para siempre", asi que ningun tenant existente pierde nada por
-- esta migracion.
--
-- El BORRADO en si NO vive aqui: es `UsageService.limpiar_recortes_vencidos`,
-- llamado por `POST /v1/usage/cleanup/crops` -- ver ese endpoint y
-- `backend/tools/limpiar_recortes.py`. Esta migracion solo guarda CUANTOS
-- dias, exactamente como `max_detections_monthly` guarda un numero y
-- `PerceptionService.ingest_detections` es quien lo hace cumplir.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE core.tenant_quotas
    ADD COLUMN IF NOT EXISTS crop_retention_days INT
        CONSTRAINT chk_quota_retention_positive CHECK (crop_retention_days IS NULL OR crop_retention_days > 0);

COMMENT ON COLUMN core.tenant_quotas.crop_retention_days IS
    'Dias que se conserva un recorte (Detection.crop_path) en Storage antes de '
    'ser candidato a borrado. NULL = para siempre. Ver 0115.';

-- ── El permiso de limpiar ────────────────────────────────────────────────
-- Distinto de usage:read (0112): leer cuanto consumes no es lo mismo que
-- autorizar borrar bytes de Storage. Solo tenant_admin -- una limpieza mal
-- disparada borra evidencia real, no es una lectura que se pueda deshacer
-- pidiendola otra vez.
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES
    ('usage:write', 'usage', 'write',
     'Disparar la limpieza de recortes vencidos segun la cuota de retencion', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'usage:write' FROM core.roles r WHERE r.name = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- ── La funcion, con el cuarto parametro ──────────────────────────────────
-- No basta con CREATE OR REPLACE: cambia la firma (un parametro mas), asi
-- que Postgres exige soltarla primero -- mismo aviso ya documentado en 0114.
DROP FUNCTION IF EXISTS core.fijar_cuota_tenant(uuid, int, int);

CREATE FUNCTION core.fijar_cuota_tenant(
    p_tenant_id  uuid,
    p_max_detecciones int,
    p_max_dispositivos int,
    p_retencion_dias int DEFAULT NULL
)
RETURNS TABLE (
    out_tenant_id uuid,
    out_max_detections_monthly int,
    out_max_devices int,
    out_crop_retention_days int,
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
        (tenant_id, max_detections_monthly, max_devices, crop_retention_days, updated_by)
    VALUES
        (p_tenant_id, p_max_detecciones, p_max_dispositivos, p_retencion_dias, v_actor)
    ON CONFLICT (tenant_id) DO UPDATE SET
        max_detections_monthly = EXCLUDED.max_detections_monthly,
        max_devices            = EXCLUDED.max_devices,
        crop_retention_days    = EXCLUDED.crop_retention_days,
        updated_at             = now(),
        updated_by             = EXCLUDED.updated_by
    RETURNING tenant_id, max_detections_monthly, max_devices, crop_retention_days, updated_at;
END;
$$;

COMMENT ON FUNCTION core.fijar_cuota_tenant(uuid, int, int, int) IS
    'Unico camino de escritura de core.tenant_quotas -- ver 0113/0114. Cuarto '
    'parametro anadido en 0115: dias de retencion de recortes, NULL = siempre.';

REVOKE ALL ON FUNCTION core.fijar_cuota_tenant(uuid, int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.fijar_cuota_tenant(uuid, int, int, int) TO olo_app;

-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'tenant_quotas'
           AND column_name = 'crop_retention_days'
    ) THEN
        RAISE EXCEPTION 'falta core.tenant_quotas.crop_retention_days';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM core.permissions WHERE code = 'usage:write') THEN
        RAISE EXCEPTION 'usage:write no se creo';
    END IF;

    SELECT count(*) INTO v_n FROM core.role_permissions WHERE permission_code = 'usage:write';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'usage:write deberia estar en 1 rol (tenant_admin), esta en %', v_n;
    END IF;

    IF to_regprocedure('core.fijar_cuota_tenant(uuid,int,int,int)') IS NULL THEN
        RAISE EXCEPTION 'fijar_cuota_tenant con 4 parametros no se creo';
    END IF;
END
$$;
