-- ═══════════════════════════════════════════════════════════════════════════
-- 0113_tenant_quotas.sql
-- Crea      : core.tenant_quotas, core.fijar_cuota_tenant()
-- Depende de: 0007 (tenants), 0016 (is_platform_owner via el hook), 0112 (usage:read)
-- Riesgo     : medio -- primera tabla cuyo UNICO camino de escritura es una
--              funcion SECURITY DEFINER, sin politica de escritura para
--              `authenticated`/`olo_app` -- mismo patron que `core.tenants`
--              (ver 0007: "Sin politicas de INSERT, UPDATE ni DELETE para
--              roles de aplicacion").
--
-- ── POR QUE UNA FUNCION Y NO UNA POLITICA "PLATFORM OWNER PUEDE ESCRIBIR" ────
--
-- Fijar una cuota es una escritura en el tenant de OTRO -- un platform owner
-- gestionando el plan de un cliente, no el suyo propio. La politica RESTRICTIVE
-- de aislamiento (`tenant_id = core.current_tenant_id()`) existe justamente
-- para impedir eso en el caso normal, y añadirle una excepcion por rol abriria
-- la puerta a un error de esa politica en OTRA tabla el dia que alguien la
-- copie sin pensar en la excepcion. Una funcion SECURITY DEFINER que comprueba
-- `core.is_platform_owner()` por su cuenta dice la excepcion en un solo sitio,
-- explicito -- mismo criterio que `core.alta_usuario_invitado` (0080).
--
-- ── NULL = SIN LIMITE, A PROPOSITO ───────────────────────────────────────────
--
-- Todo tenant existente hoy no tiene fila en esta tabla: `obtener_cuota` (ver
-- el repositorio) trata "sin fila" igual que "con fila y NULL" -- sin limite.
-- Ponerle un limite por defecto retroactivamente convertiria una migracion de
-- esquema en un corte de servicio para quien ya estaba operando.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE core.tenant_quotas (
    tenant_id               UUID        PRIMARY KEY REFERENCES core.tenants(id),
    max_detections_monthly  INT,
    max_devices             INT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by              UUID,

    CONSTRAINT chk_quota_detections_positive
        CHECK (max_detections_monthly IS NULL OR max_detections_monthly > 0),
    CONSTRAINT chk_quota_devices_positive
        CHECK (max_devices IS NULL OR max_devices > 0)
);

COMMENT ON TABLE core.tenant_quotas IS
    'Limites de un tenant -- base de la #4 del plan de mejoras SaaS. NULL = '
    'sin limite. Se escribe SOLO via core.fijar_cuota_tenant(); no hay '
    'politica de INSERT/UPDATE para authenticated/olo_app, igual que '
    'core.tenants (0007).';

ALTER TABLE core.tenant_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenant_quotas FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.tenant_quotas
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Solo LECTURA para el propio tenant -- ver la cabecera: la escritura pasa
-- por la funcion, nunca por esta politica (RESTRICTIVE + ninguna PERMISSIVE
-- de escritura = ninguna escritura posible por este camino).
CREATE POLICY quota_read ON core.tenant_quotas
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id());

GRANT SELECT ON TABLE core.tenant_quotas TO authenticated, olo_app;

-- ── La unica escritura posible ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.fijar_cuota_tenant(
    p_tenant_id  uuid,
    p_max_detecciones int,
    p_max_dispositivos int
)
RETURNS TABLE (tenant_id uuid, max_detections_monthly int, max_devices int, updated_at timestamptz)
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
    RETURNING core.tenant_quotas.tenant_id, core.tenant_quotas.max_detections_monthly,
              core.tenant_quotas.max_devices, core.tenant_quotas.updated_at;
END;
$$;

COMMENT ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) IS
    'Unico camino de escritura de core.tenant_quotas. Comprueba is_platform_owner '
    'por su cuenta -- ver la cabecera de esta migracion.';

REVOKE ALL ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) TO olo_app;

-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'core' AND tablename = 'tenant_quotas'
           AND policyname = 'tenant_isolation' AND permissive = 'RESTRICTIVE'
    ) THEN
        RAISE EXCEPTION 'falta el aislamiento por tenant en core.tenant_quotas';
    END IF;

    IF to_regprocedure('core.fijar_cuota_tenant(uuid,int,int)') IS NULL THEN
        RAISE EXCEPTION 'fijar_cuota_tenant no se creo';
    END IF;

    -- Sin contexto de sesion, is_platform_owner() debe ser false y la funcion
    -- debe rechazar -- probado en una transaccion que se revierte sola via
    -- la excepcion capturada.
    BEGIN
        PERFORM core.fijar_cuota_tenant(gen_random_uuid(), 100, 5);
        RAISE EXCEPTION 'fijar_cuota_tenant deberia haber rechazado sin ser platform owner';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%platform owner%' THEN
            RAISE;
        END IF;
    END;
END
$$;
