-- ══════════════════════════════════════════════════════════════════════════════
-- 0110 · Registro de flota: los dispositivos de borde dejan de ser invisibles
--
-- Crea : core.fleet_devices, core.fleet_device_status()
-- Toca : nada. El heartbeat lo manda el propio dispositivo (S21 hoy, Manifold 3
--        sobre el M4T mañana, ver ADR-015 Fase 3).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ ES EL MISMO PATRÓN QUE `core.workers` (0075), Y POR QUÉ NO ES LA MISMA TABLA
--
-- Un worker de inferencia CONSUME trabajo encolado; un dispositivo de flota
-- (un S21 con la app de Fase 1, un dron con Manifold 3) PRODUCE sus propias
-- detecciones y las deposita -- son roles opuestos, no variaciones del mismo
-- concepto (a diferencia de "inference" y "training" en 0075, que sí son la
-- misma cosa con distinto trabajo). Lo que SÍ se copia sin cambios es la idea
-- central de 0075: la disponibilidad se deduce de un latido con ventana, no
-- de que el dispositivo avise al apagarse -- a un dron no se le puede pedir
-- que mande un "me apago" antes de quedarse sin batería en el aire.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ HAY UN ESTADO QUE EL LATIDO NO PUEDE ANULAR
--
-- "Conectado", "en vivo" y "apagado" son hechos que el propio latido ya
-- demuestra. "Fuera de uso" es una DECISIÓN humana -- un teléfono roto, un
-- dron en mantenimiento -- y nada impide que ese teléfono roto siga
-- mandando latidos (alguien lo prendió sin querer, quedó con la app abierta
-- en un cajón). Si el estado fuera puro latido, "fuera de uso" desaparecería
-- solo con que el dispositivo vuelva a conectarse, y esa no es la decisión
-- que un administrador tomó. Por eso `retired_at` manda sobre el latido: es
-- la única forma de que un estado dure más que la próxima señal de radio.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ `device_key` Y NO EL `id` DE LA FILA COMO IDENTIDAD
--
-- El dispositivo tiene que reconocerse a SÍ MISMO en cada reinicio de la app,
-- sin depender de haber guardado un UUID que el servidor le asignó la vez
-- anterior (una reinstalación del APK, o borrar datos de la app, lo pierde).
-- `device_key` lo genera y lo persiste el dispositivo mismo (ver
-- `edge/s21-fase1/.../FleetHeartbeat.kt`) -- normalmente un UUID guardado en
-- `SharedPreferences` la primera vez que arranca. El `ON CONFLICT` sobre
-- `(tenant_id, device_key)` es lo que hace que 50 reinicios de la misma app
-- sigan siendo UN dispositivo en la lista, no 50.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE core.fleet_devices (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid        NOT NULL REFERENCES core.tenants (id),
    warehouse_id  uuid        NOT NULL,

    -- Identidad ESTABLE que el dispositivo se asigna a sí mismo -- ver la nota
    -- de cabecera. No es el `id` de esta fila.
    device_key    varchar(120) NOT NULL,

    -- Clase de hardware. Determina qué columnas de estado tienen sentido
    -- mostrar en el módulo de Flota (un dron tiene batería; un teléfono no).
    kind          varchar(20) NOT NULL,

    -- Nombre para humanos. Lo manda el dispositivo (p.ej. "S21 Fase 1"), y se
    -- puede renombrar despues desde el modulo de Flota sin perder el latido.
    name          varchar(120) NOT NULL,

    -- Diagnostico -- "con que app/dispositivo se produjo esta deteccion" es la
    -- primera pregunta cuando algo sale mal, igual que `agent_version`/`device`
    -- en core.workers.
    app_version   varchar(40),
    device_model  varchar(80),

    registered_at timestamptz NOT NULL DEFAULT now(),
    -- El latido. Todo lo demas de esta tabla existe para dar contexto a esta columna.
    last_seen_at  timestamptz NOT NULL DEFAULT now(),

    -- En que job esta ahora, si esta en alguno. Informativo, igual que
    -- `core.workers.current_job`: la autoridad sobre el estado de un job es
    -- el job mismo (`perception.inference_jobs.status`), esta columna solo
    -- evita una segunda consulta para pintar la lista de la flota.
    current_job_id uuid,

    -- NULL = el estado lo decide el latido (ver core.fleet_device_status()).
    -- 'out_of_service' = una decision humana que el latido NO puede anular
    -- por si solo -- ver la nota de cabecera.
    status_override varchar(20),
    retired_at      timestamptz,
    retired_by      uuid REFERENCES core.users (id) ON DELETE SET NULL,
    retired_reason  varchar(200),

    CONSTRAINT fk_fleet_device_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_fleet_device_kind
        CHECK (kind IN ('phone', 'drone', 'onboard_compute')),
    CONSTRAINT chk_fleet_device_status_override
        CHECK (status_override IS NULL OR status_override IN ('out_of_service')),
    -- Coherencia: si hay razon/quien retiro, tiene que haber override, y
    -- viceversa -- el mismo criterio que `chk_job_status`/`error_message` de
    -- 0069 (un motivo de fallo sin fallo es un resto de otra cosa).
    CONSTRAINT chk_fleet_device_retiro_coherente
        CHECK (
            (status_override IS NULL AND retired_at IS NULL AND retired_by IS NULL)
            OR (status_override = 'out_of_service' AND retired_at IS NOT NULL)
        ),
    CONSTRAINT uq_fleet_device_key UNIQUE (tenant_id, device_key)
);

COMMENT ON TABLE core.fleet_devices IS
    'Dispositivos de borde (telefonos, drones) que producen sus propias detecciones -- ver ADR-015. La disponibilidad se deduce del latido (last_seen_at), salvo que status_override lo anule a mano.';
COMMENT ON COLUMN core.fleet_devices.device_key IS
    'Identidad que el propio dispositivo persiste (p.ej. un UUID en SharedPreferences) para reconocerse entre reinicios de la app -- no el id de esta fila.';
COMMENT ON COLUMN core.fleet_devices.current_job_id IS
    'Informativo. La autoridad sobre si un job sigue corriendo es perception.inference_jobs.status, no esta columna.';

CREATE INDEX idx_fleet_devices_tenant_wh ON core.fleet_devices (tenant_id, warehouse_id, last_seen_at DESC);


-- ── El estado, en un solo sitio ──────────────────────────────────────────────
--
-- Misma razon que core.worker_esta_vivo() en 0075: la ventana de latido y el
-- orden de prioridad (retirado > en vivo > conectado > apagado) son una
-- decision, y escritos en cada pantalla que liste dispositivos son varias
-- decisiones que se separan en cuanto alguien ajuste una.
--
-- Ventana de 45 s, mas corta que los 90 s de un worker: un worker es un
-- proceso de servidor con un latido programado exacto; un dispositivo de
-- borde depende de una red movil que puede colgarse un momento y de una app
-- que un usuario puede cerrar de un vistazo -- "conectado" tiene que
-- responder rapido a que alguien apago la pantalla, no tolerar dos latidos
-- perdidos como un servidor.
CREATE OR REPLACE FUNCTION core.fleet_device_status(
    p_status_override text,
    p_last_seen_at timestamptz,
    p_current_job_id uuid
)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_status_override = 'out_of_service' THEN 'out_of_service'
        WHEN p_last_seen_at <= now() - interval '45 seconds' THEN 'offline'
        WHEN p_current_job_id IS NOT NULL THEN 'live'
        ELSE 'connected'
    END;
$$;

COMMENT ON FUNCTION core.fleet_device_status(text, timestamptz, uuid) IS
    'connected | live | offline | out_of_service, en ese orden de prioridad. Ver 0110.';


-- ── RLS ───────────────────────────────────────────────────────────────────
-- Mismo criterio que core.workers (0075): un dispositivo se registra con las
-- credenciales de la cuenta que la app tiene configurada, asi que tiene
-- tenant y se acota como todo lo demas.
ALTER TABLE core.fleet_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.fleet_devices
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_members ON core.fleet_devices
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON core.fleet_devices TO olo_app;
GRANT EXECUTE ON FUNCTION core.fleet_device_status(text, timestamptz, uuid) TO olo_app;

-- Sin DELETE, a diferencia de core.workers: un worker que se retira es una
-- maquina que se devuelve (deja de existir para el sistema). Un dispositivo
-- de flota retirado sigue siendo un hecho que reportar ("este telefono se
-- dio de baja el 12 de marzo") -- se marca `out_of_service`, no se borra.


-- ── Los permisos ────────────────────────────────────────────────────────────
--
-- `drones:read/write` YA estaban referenciados en el frontend
-- (`frontend/src/shell/navigation.ts`, la entrada "Flota" marcada
-- `moduleStatus: 'future'`) desde antes de que existiera nada en el backend
-- que los concediera -- la pantalla apuntaba a un permiso que no existia
-- todavia. Se crean aqui con el MISMO reparto de 0069 para
-- `perception:read/write/ingest`, no uno inventado aparte: leer la flota es
-- la misma clase de acto que leer trabajos de percepcion, y el latido de un
-- dispositivo es la misma clase de acto que depositar sus detecciones.
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES
    ('drones:read',   'drones', 'read',
     'Ver la flota de dispositivos de borde y su estado', false),
    ('drones:write',  'drones', 'write',
     'Renombrar, reasignar de almacen, retirar o reactivar un dispositivo de la flota', false),
    ('drones:ingest', 'drones', 'ingest',
     'Mandar el latido de un dispositivo de borde (credencial de MAQUINA)', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'drones:read'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator',
                  'auditor', 'viewer')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'drones:write'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator')
ON CONFLICT DO NOTHING;

-- Igual que `perception:ingest`: sin el operario. Es la credencial de un
-- DISPOSITIVO, y darsela tambien al operario significaria que el telefono de
-- cualquiera puede declararse a si mismo parte de la flota.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'drones:ingest'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager')
ON CONFLICT DO NOTHING;


-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
DECLARE
    v_estado text;
BEGIN
    SELECT core.fleet_device_status(NULL, now() - interval '10 seconds', NULL)
      INTO v_estado;
    IF v_estado <> 'connected' THEN
        RAISE EXCEPTION 'latido reciente sin job deberia ser connected, salio %', v_estado;
    END IF;

    SELECT core.fleet_device_status(NULL, now() - interval '10 seconds', gen_random_uuid())
      INTO v_estado;
    IF v_estado <> 'live' THEN
        RAISE EXCEPTION 'latido reciente CON job deberia ser live, salio %', v_estado;
    END IF;

    SELECT core.fleet_device_status(NULL, now() - interval '5 minutes', NULL)
      INTO v_estado;
    IF v_estado <> 'offline' THEN
        RAISE EXCEPTION 'latido viejo deberia ser offline, salio %', v_estado;
    END IF;

    SELECT core.fleet_device_status('out_of_service', now(), gen_random_uuid())
      INTO v_estado;
    IF v_estado <> 'out_of_service' THEN
        RAISE EXCEPTION 'el override deberia ganarle incluso a un job en curso, salio %', v_estado;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
         WHERE schemaname = 'core' AND tablename = 'fleet_devices'
           AND policyname = 'tenant_isolation' AND permissive = 'RESTRICTIVE'
    ) THEN
        RAISE EXCEPTION 'falta el aislamiento por tenant en core.fleet_devices';
    END IF;

    IF (SELECT count(*) FROM core.permissions
         WHERE code IN ('drones:read', 'drones:write', 'drones:ingest')) <> 3 THEN
        RAISE EXCEPTION 'faltan permisos drones:* -- el frontend ya los referencia en navigation.ts';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM core.role_permissions rp
        JOIN core.roles r ON r.id = rp.role_id
        WHERE r.name = 'warehouse_manager' AND rp.permission_code = 'drones:ingest'
    ) THEN
        RAISE EXCEPTION 'warehouse_manager deberia poder latir como dispositivo (drones:ingest)';
    END IF;

    RAISE NOTICE '0110 OK - fleet_devices, fleet_device_status() y permisos drones:* listos';
END $$;
