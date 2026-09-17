-- ═══════════════════════════════════════════════════════════════════════════
-- 0116_alertas_proactivas.sql
-- Crea      : core.tenant_quota_alerts
-- Altera    : core.fleet_devices (offline_notified_at)
-- Depende de: 0104 (core.notifications), 0110 (fleet_devices), 0113 (tenant_quotas)
-- Riesgo     : bajo -- una tabla nueva sin lectores todavia y una columna
--              nullable en una tabla que ya se actualiza por fila (latir()).
--
-- Base de la #6 del plan de mejoras SaaS: avisar (via core.notifications,
-- 0104 -- sin canal nuevo) cuando la cuota de un tenant esta cerca del limite
-- o un dispositivo de flota deja de latir sin haber sido retirado a mano.
--
-- ── POR QUE UNA TABLA NUEVA Y NO DOS COLUMNAS EN core.tenant_quotas ──────────
--
-- core.tenant_quotas (0113) se dejo A PROPOSITO sin ninguna politica de
-- escritura para authenticated/olo_app -- la UNICA forma de escribir ahi es
-- core.fijar_cuota_tenant(), que exige is_platform_owner() (ver la cabecera
-- de 0113: "Fijar una cuota es una escritura en el tenant de OTRO"). El
-- barrido que revisa si ya se aviso corre con la sesion de un administrador
-- del TENANT, no de la plataforma -- dejarlo escribir en tenant_quotas
-- reabriria justo la puerta que 0113 cerro. Una tabla separada, con RLS
-- normal (el tenant lee y escribe lo suyo, igual que cualquier otra tabla
-- de negocio), no toca esa decision para nada.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE core.tenant_quota_alerts (
    tenant_id              UUID        PRIMARY KEY REFERENCES core.tenants(id),

    -- Primer dia del mes calendario para el que ya se aviso "cerca del
    -- limite" de detecciones. Un mes nuevo vuelve a permitir el aviso sin
    -- necesidad de limpiar nada a mano.
    detections_alert_month DATE,

    -- Si ya se aviso "cerca del limite" de dispositivos SIN que la flota
    -- haya vuelto a bajar del umbral -- histeresis simple: el barrido lo
    -- limpia en cuanto vuelve a encontrar la flota por debajo del umbral,
    -- asi una segunda subida puede volver a avisar.
    devices_alert_notified BOOLEAN     NOT NULL DEFAULT false,

    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.tenant_quota_alerts IS
    'Estado de idempotencia de los avisos de cuota (#6 del plan de mejoras '
    'SaaS) -- separada de core.tenant_quotas porque esa tabla no tiene '
    'escritura para el propio tenant (ver 0113). Sin fila = todavia no se '
    'aviso de nada.';

ALTER TABLE core.tenant_quota_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenant_quota_alerts FORCE  ROW LEVEL SECURITY;

-- Plantilla T6 (solo tenant_id), igual que core.tenant_quotas y
-- core.role_assignments.
CREATE POLICY tenant_isolation ON core.tenant_quota_alerts
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- A diferencia de core.tenant_quotas: aqui SI hay escritura normal para el
-- propio tenant -- esto es "ya le avisamos a este tenant de lo suyo", no un
-- limite que solo la plataforma pueda cambiar.
CREATE POLICY quota_alerts_rw ON core.tenant_quota_alerts
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE core.tenant_quota_alerts TO authenticated, olo_app;


-- ── Latido caido: columna en la propia tabla de flota ────────────────────────
-- core.fleet_devices SI tiene escritura normal para el tenant (ver 0110 y
-- FleetRepository.retirar/reactivar) -- no hace falta una tabla aparte aqui.
ALTER TABLE core.fleet_devices
    ADD COLUMN IF NOT EXISTS offline_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN core.fleet_devices.offline_notified_at IS
    'Cuando se aviso por ultima vez de que este dispositivo lleva demasiado '
    'sin latir (#6 del plan de mejoras SaaS). Se limpia en cada latido '
    '(FleetRepository.latir) -- una caida nueva siempre puede volver a avisar.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'core' AND table_name = 'fleet_devices'
          AND column_name = 'offline_notified_at'
    ) THEN
        RAISE EXCEPTION 'offline_notified_at no quedo creada en core.fleet_devices';
    END IF;
    RAISE NOTICE 'OK - tenant_quota_alerts creada, fleet_devices.offline_notified_at agregada.';
END $$;
