-- ═══════════════════════════════════════════════════════════════════════════════
-- 0083 · INCIDENCIAS — de «esto no cuadra» a «alguien lo está resolviendo»
--
-- El sistema ya SABE lo que no cuadra: 2.186 huecos donde el WMS se contradice
-- consigo mismo, más lo que encuentre la reconciliación de cada inspección. Lo que no
-- tenía es memoria de qué se hizo con eso.
--
-- Hoy quien abre Inventario ve la misma lista de 2.186 que vio ayer. No hay forma de
-- saber cuáles ya se comprobaron en el pasillo, cuáles resultaron ser un error del WMS
-- y cuáles nadie ha tocado en tres semanas. Cada mañana se empieza de cero.
--
-- Una incidencia es eso: un descuadre al que alguien le puso nombre, dueño y estado.
--
-- ── DE DONDE NACE UNA INCIDENCIA ──────────────────────────────────────────────
--
--   wms_mismatch     el WMS se contradice consigo mismo. Disponible HOY, y no
--                    depende de la visión por computador: sale del import del WMS.
--   reconciliation   lo que vio el drone no coincide con lo que declara el WMS.
--                    El origen que cierra el círculo, y que hoy no produce nada útil
--                    porque el modelo no lee los códigos de hueco (AP 0,00).
--   manual           alguien lo vio en el pasillo y lo anotó.
--
-- Los tres caben en la misma tabla porque el TRABAJO es el mismo —ir al hueco,
-- comprobar, decidir— y separarlos daría tres bandejas que nadie mira enteras.
--
-- ── POR QUE SE GUARDA DE QUE FOTO SALIO ───────────────────────────────────────
--
-- `source_snapshot_id`. Una incidencia abierta desde un import del 29 de julio puede
-- estar resuelta desde el 30 sin que nadie hiciera nada: el WMS se corrigió solo. Sin
-- saber de qué foto salió, no hay forma de distinguir «sigue mal» de «esto es viejo».
--
-- ── LO QUE ESTA TABLA NO ES ───────────────────────────────────────────────────
--
-- No es una corrección del inventario. Cerrar una incidencia NO cambia el stock: el
-- WMS es el sistema de origen (ADR-009 §3.4) y esto es su espejo. Lo que se registra
-- aquí es qué hizo una persona, no qué hay en el hueco.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS incidents;
GRANT USAGE ON SCHEMA incidents TO olo_app;


-- ── 1 · Los permisos ──────────────────────────────────────────────────────────
--
-- Dos, no tres. Se pensó en separar `resolve` de `write`, pero cerrar una incidencia
-- no es más peligroso que abrirla: las dos cosas las hace quien va al pasillo, y
-- partirlas habría dado un rol que puede abrir trabajo y no cerrarlo.
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES
    ('incidents:read', 'incidents', 'read',
     'Ver las incidencias del almacen y su historial', false),
    ('incidents:write', 'incidents', 'write',
     'Abrir incidencias, asignarlas, cambiar su estado y cerrarlas. NO modifica el '
     'inventario: el WMS sigue siendo el sistema de origen', false)
ON CONFLICT (code) DO NOTHING;

-- Leer: los cinco roles. Saber qué está pendiente no es una capacidad sensible, y
-- negarlo a `auditor` o `viewer` los dejaría sin ver justo el trabajo que auditan.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'incidents:read'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator',
                  'auditor', 'viewer')
ON CONFLICT DO NOTHING;

-- Escribir: quien pisa el almacén. `viewer` no escribe nada en ningún sitio, y
-- `auditor` tampoco —misma razón que en 0069 y 0073: quien audita no debe poder
-- fabricar lo que audita—.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'incidents:write'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator')
ON CONFLICT DO NOTHING;


-- ── 2 · La incidencia ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents.incidents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES core.tenants (id),
    warehouse_id uuid NOT NULL,

    -- La ubicación, y su código copiado al lado.
    --
    -- El código se DUPLICA a propósito: una incidencia sobre stock huérfano apunta a un
    -- hueco que el catálogo no tiene —773 líneas así en el almacén real—, así que
    -- `location_id` es NULL y sin el texto no habría forma de decir de qué hueco habla.
    location_id   uuid REFERENCES spatial.locations (id),
    location_code varchar(80),

    kind    varchar(24) NOT NULL,
    subkind varchar(48),

    status varchar(16) NOT NULL DEFAULT 'open',

    title   varchar(200) NOT NULL,
    details text,

    -- De qué foto del WMS salió. Ver la cabecera: sin esto no se distingue «sigue mal»
    -- de «esto lo abrimos con datos de hace tres semanas».
    source_snapshot_id uuid REFERENCES inventory.wms_snapshots (id),
    -- Qué inspección lo encontró, cuando el origen es la reconciliación.
    source_job_id      uuid REFERENCES perception.inference_jobs (id),

    assigned_to uuid REFERENCES core.users (id),
    opened_by   uuid NOT NULL REFERENCES core.users (id),

    resolved_at  timestamptz,
    resolved_by  uuid REFERENCES core.users (id),
    resolution   text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version    integer NOT NULL DEFAULT 1,

    CONSTRAINT chk_inc_kind CHECK (kind IN ('wms_mismatch', 'reconciliation', 'manual')),
    CONSTRAINT chk_inc_status CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
    CONSTRAINT chk_inc_version CHECK (version >= 1),

    -- Cerrar exige DECIR QUE PASO. Una incidencia resuelta sin explicación no sirve
    -- para nada dentro de un mes: el trabajo se hizo o no, y nadie puede saberlo.
    --
    -- `resolution IS NOT NULL AND btrim(...) <> ''` explícito, no solo `IS NOT NULL`:
    -- un CHECK solo rechaza cuando evalúa a FALSE, y con `resolution` NULL una
    -- comparación de texto da NULL —o sea, pasa—. Ya mordió en `chk_media_identidad`.
    CONSTRAINT chk_inc_cerrada CHECK (
        status NOT IN ('resolved', 'dismissed')
        OR (resolved_at IS NOT NULL
            AND resolved_by IS NOT NULL
            AND resolution IS NOT NULL
            AND length(btrim(resolution)) > 0)
    ),

    -- Una incidencia sobre un hueco necesita saber DE QUE hueco habla, por id o por
    -- código. Sin ninguno de los dos es una nota suelta, no una incidencia.
    CONSTRAINT chk_inc_ubicacion CHECK (
        kind = 'manual' OR location_id IS NOT NULL OR location_code IS NOT NULL
    )
);

-- Una sola incidencia ABIERTA por hueco y motivo.
--
-- Sin esto, pulsar dos veces el botón —o dos personas mirando la misma lista— abren
-- dos incidencias del mismo problema, y la bandeja deja de ser una lista de trabajo
-- para convertirse en una lista de clics.
--
-- Es PARCIAL: cerrada una, se puede volver a abrir la misma si el problema reaparece,
-- que es exactamente lo que se quiere poder ver.
--
-- ⚠ Quien inserte con ON CONFLICT tiene que REPETIR este WHERE: sin él, PostgreSQL no
--   encuentra el índice y falla. Mordió en `uq_media_hash` (migración 0078).
CREATE UNIQUE INDEX IF NOT EXISTS uq_incidencia_abierta
    ON incidents.incidents (tenant_id, warehouse_id, coalesce(location_code, ''), kind,
                            coalesce(subkind, ''))
    WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_inc_bandeja
    ON incidents.incidents (tenant_id, warehouse_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inc_asignadas
    ON incidents.incidents (assigned_to) WHERE status IN ('open', 'in_progress');


-- ── 3 · El historial ──────────────────────────────────────────────────────────
--
-- Quién hizo qué y cuándo. Sin esto, «resuelta» es una palabra sin autor: se sabe el
-- estado final y no el camino, y la primera pregunta cuando algo reaparece es siempre
-- «¿quién dijo que esto estaba arreglado?».
CREATE TABLE IF NOT EXISTS incidents.events (
    id          bigserial PRIMARY KEY,
    tenant_id   uuid NOT NULL REFERENCES core.tenants (id),
    incident_id uuid NOT NULL REFERENCES incidents.incidents (id) ON DELETE CASCADE,
    from_status varchar(16),
    to_status   varchar(16) NOT NULL,
    note        text,
    actor_id    uuid NOT NULL REFERENCES core.users (id),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inc_events ON incidents.events (incident_id, occurred_at);


-- ── 4 · RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE incidents.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents.events    ENABLE ROW LEVEL SECURITY;

-- Dos candados en las incidencias: el tenant Y el almacén.
--
-- El del almacén no es redundante: un operario con acceso solo a OLO-CR no debe ver
-- —ni cerrar— las incidencias de otro almacén del mismo operador. Se usa la MISMA
-- función que el resto del sistema para que no puedan divergir.
CREATE POLICY tenant_isolation ON incidents.incidents
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY solo_su_almacen ON incidents.incidents
    AS RESTRICTIVE FOR ALL
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));
CREATE POLICY del_equipo ON incidents.incidents
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- El historial es AUDITABLE: lo ve todo el que ve la incidencia, y NO se puede editar
-- ni borrar. Un registro de quién cerró qué que se pueda reescribir no es un registro.
CREATE POLICY tenant_isolation ON incidents.events
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY visible ON incidents.events
    FOR SELECT
    USING (true);
CREATE POLICY se_anota ON incidents.events
    FOR INSERT
    WITH CHECK (actor_id = core.current_user_id());

-- Sin UPDATE ni DELETE en `events`, y sin GRANT tampoco: las dos capas, porque una
-- sola se salta con un cambio de política que nadie relacione con esto.
GRANT SELECT, INSERT, UPDATE ON incidents.incidents TO olo_app;
GRANT SELECT, INSERT         ON incidents.events    TO olo_app;
GRANT USAGE ON SEQUENCE incidents.events_id_seq TO olo_app;


-- ── 5 · La bandeja, ya resuelta ───────────────────────────────────────────────
--
-- Une lo que hace falta para pintar una fila sin que el cliente tenga que pedir tres
-- cosas más: quién la tiene, de qué foto salió y cuántos días lleva abierta.
--
-- `security_invoker` SÍ: son datos de tenant, y sin él la vista los enseñaría todos.
-- Es lo contrario de `perception.v_published_models`, que es catálogo de plataforma.
CREATE OR REPLACE VIEW incidents.v_bandeja
WITH (security_invoker = true) AS
SELECT i.id,
       i.warehouse_id,
       i.location_id,
       i.location_code,
       i.kind,
       i.subkind,
       i.status,
       i.title,
       i.details,
       i.resolution,
       i.created_at,
       i.resolved_at,
       -- Días abierta. Es el dato que ordena el trabajo: una incidencia de hace tres
       -- semanas dice algo distinto de una de esta mañana.
       floor(extract(epoch FROM (coalesce(i.resolved_at, now()) - i.created_at)) / 86400)::int
           AS dias_abierta,
       i.assigned_to,
       asignada.first_name || ' ' || asignada.last_name AS assigned_to_name,
       abrio.first_name || ' ' || abrio.last_name       AS opened_by_name,
       cerro.first_name || ' ' || cerro.last_name       AS resolved_by_name,
       i.source_snapshot_id,
       s.taken_at AS snapshot_taken_at
  FROM incidents.incidents i
  LEFT JOIN core.users asignada ON asignada.id = i.assigned_to
  LEFT JOIN core.users abrio    ON abrio.id    = i.opened_by
  LEFT JOIN core.users cerro    ON cerro.id    = i.resolved_by
  LEFT JOIN inventory.wms_snapshots s ON s.id  = i.source_snapshot_id;

GRANT SELECT ON incidents.v_bandeja TO olo_app;


-- ── Verificación: que FUNCIONE, no que exista ─────────────────────────────────
--
-- Es la lección de la 0080: comprobar que una tabla está creada no prueba nada de una
-- restricción que solo salta al escribir. Aquí se INSERTA de verdad y se comprueba que
-- las guardas rechazan lo que tienen que rechazar.
DO $verif$
DECLARE
    v_tenant uuid;
    v_wh     uuid;
    v_user   uuid;
    v_id     uuid;
    v_fallos int := 0;
BEGIN
    SELECT m.tenant_id, u.id INTO v_tenant, v_user
      FROM core.users u
      JOIN core.tenant_memberships m ON m.user_id = u.id AND m.revoked_at IS NULL
     WHERE u.deleted_at IS NULL
     LIMIT 1;
    SELECT id INTO v_wh FROM core.warehouses WHERE tenant_id = v_tenant LIMIT 1;

    IF v_tenant IS NULL OR v_wh IS NULL THEN
        RAISE NOTICE 'AVISO · sin tenant o sin almacen: no se puede probar la escritura';
        RETURN;
    END IF;

    INSERT INTO incidents.incidents
        (tenant_id, warehouse_id, location_code, kind, subkind, title, opened_by)
    VALUES (v_tenant, v_wh, 'VERIF-0083', 'wms_mismatch', 'dice_libre_con_stock',
            'Verificacion de la migracion 0083', v_user)
    RETURNING id INTO v_id;

    -- 1 · No se puede cerrar sin decir qué pasó.
    BEGIN
        UPDATE incidents.incidents SET status = 'resolved', resolved_at = now(),
               resolved_by = v_user
         WHERE id = v_id;
        v_fallos := v_fallos + 1;
        RAISE NOTICE 'MAL · dejo cerrar una incidencia sin resolucion';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK  · cerrar sin explicacion se rechaza';
    END;

    -- 2 · Una sola abierta por hueco y motivo.
    BEGIN
        INSERT INTO incidents.incidents
            (tenant_id, warehouse_id, location_code, kind, subkind, title, opened_by)
        VALUES (v_tenant, v_wh, 'VERIF-0083', 'wms_mismatch', 'dice_libre_con_stock',
                'Duplicada', v_user);
        v_fallos := v_fallos + 1;
        RAISE NOTICE 'MAL · dejo abrir dos incidencias del mismo problema';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK  · la segunda incidencia del mismo hueco y motivo se rechaza';
    END;

    -- 3 · Cerrada bien, y entonces se puede volver a abrir.
    UPDATE incidents.incidents
       SET status = 'resolved', resolved_at = now(), resolved_by = v_user,
           resolution = 'Comprobado en el pasillo: estaba vacio'
     WHERE id = v_id;
    RAISE NOTICE 'OK  · cerrar con explicacion funciona';

    INSERT INTO incidents.incidents
        (tenant_id, warehouse_id, location_code, kind, subkind, title, opened_by)
    VALUES (v_tenant, v_wh, 'VERIF-0083', 'wms_mismatch', 'dice_libre_con_stock',
            'Reabierta', v_user);
    RAISE NOTICE 'OK  · con la anterior cerrada, el mismo problema se puede reabrir';

    -- Limpieza: era una prueba.
    DELETE FROM incidents.events WHERE incident_id IN
        (SELECT id FROM incidents.incidents WHERE location_code = 'VERIF-0083');
    DELETE FROM incidents.incidents WHERE location_code = 'VERIF-0083';

    IF v_fallos > 0 THEN
        RAISE EXCEPTION '% comprobaciones fallaron', v_fallos;
    END IF;
    RAISE NOTICE 'OK · incidencias creadas y sus guardas verificadas';
END $verif$;
