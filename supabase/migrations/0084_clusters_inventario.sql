-- ═══════════════════════════════════════════════════════════════════════════════
-- 0084 · CLUSTERS DE INVENTARIO — las zonas que agrupa una persona
--
-- Agrupar por NOMENCLATURA sale gratis: el prefijo del código de rack ya está en el
-- dato. Lo que pasa es que no describe el almacén.
--
-- Medido en OLO-CR:
--
--     RCL     209 racks   27.090 huecos   ← el 92 % del almacen
--     MZ       12 racks    1.505 huecos
--     CANT      8 racks      591 huecos
--     …y otros 39 prefijos, la mayoria con UN hueco
--
-- O sea que la agrupación automática da un grupo gigante y 41 migajas. Sirve para
-- acotar una búsqueda, no para decir «el pasillo 3 va al 94 %».
--
-- Un cluster manual es la respuesta a eso: alguien que conoce el almacén dice «esto es
-- la zona de picking» y mete dentro los racks que la forman.
--
-- ── UN MIEMBRO ES UN PREFIJO O UN RACK, NO LAS DOS COSAS ──────────────────────
--
-- Los dos hacen falta y por motivos distintos:
--
--   prefijo  «todo lo que empiece por CANT». Sobrevive a que se añadan racks nuevos:
--            un rack CANT9 que se dé de alta mañana entra solo.
--   rack     un rack concreto. Es la única forma de trocear RCL, donde el prefijo no
--            distingue nada.
--
-- El CHECK obliga a que sea exactamente uno de los dos: una fila con los dos rellenos
-- no tendría un significado claro —¿el rack, o todos los de su prefijo?— y una con los
-- dos vacíos no significa nada.
--
-- ── LO QUE UN CLUSTER NO ES ───────────────────────────────────────────────────
--
-- No es estructura del edificio. `spatial.nodes` describe la jerarquía real —sitio,
-- pasillo, rack, hueco— y la escribe el importador del catálogo. Esto es una etiqueta
-- que alguien pone encima para trabajar, y por eso vive en `inventory` y no en
-- `spatial`: se puede borrar sin que el almacén cambie.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · Los permisos ──────────────────────────────────────────────────────────
--
-- Se reutiliza `inventory:read` para verlos —quien ve el inventario ve sus zonas— y se
-- crea uno solo para definirlos: agrupar el almacén es una decisión de quien lo
-- organiza, no de quien lo recorre.
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES ('inventory:zones', 'inventory', 'zones',
        'Definir zonas propias del almacen agrupando racks o prefijos de nomenclatura. '
        'No cambia la estructura del edificio: es una etiqueta para trabajar', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'inventory:zones'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager')
ON CONFLICT DO NOTHING;


-- ── 2 · El cluster ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.clusters (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES core.tenants (id),
    warehouse_id uuid NOT NULL REFERENCES core.warehouses (id),
    name         varchar(80) NOT NULL,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid REFERENCES core.users (id),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    version      integer NOT NULL DEFAULT 1,

    -- El nombre no puede quedar en blanco. `length(btrim(...)) > 0` y no `<> ''`:
    -- «   » no es cadena vacía y pasaría.
    CONSTRAINT chk_cluster_nombre CHECK (length(btrim(name)) > 0),
    CONSTRAINT chk_cluster_version CHECK (version >= 1)
);

-- Dos zonas con el mismo nombre en el mismo almacén serían indistinguibles en cualquier
-- lista. `lower()` porque «Picking» y «picking» son la misma para quien las lee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_nombre
    ON inventory.clusters (warehouse_id, lower(btrim(name)));


-- ── 3 · Qué contiene ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory.cluster_members (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES core.tenants (id),
    cluster_id uuid NOT NULL REFERENCES inventory.clusters (id) ON DELETE CASCADE,

    -- Uno de los dos, nunca los dos. Ver la cabecera.
    prefix  varchar(24),
    rack_id uuid REFERENCES spatial.nodes (id),

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_miembro_uno_u_otro CHECK (
        (prefix IS NOT NULL AND rack_id IS NULL)
        OR (prefix IS NULL AND rack_id IS NOT NULL)
    ),
    CONSTRAINT chk_miembro_prefijo CHECK (prefix IS NULL OR length(btrim(prefix)) > 0)
);

-- El mismo rack o el mismo prefijo, una sola vez por cluster. Añadirlo dos veces no da
-- error hoy pero duplica los recuentos, que es peor: la zona diría tener el doble de
-- huecos de los que tiene.
--
-- Dos índices parciales y no uno con `coalesce`: así cada uno indexa lo suyo y se lee
-- qué está protegiendo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_miembro_prefijo
    ON inventory.cluster_members (cluster_id, upper(btrim(prefix))) WHERE prefix IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_miembro_rack
    ON inventory.cluster_members (cluster_id, rack_id) WHERE rack_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_miembros_cluster ON inventory.cluster_members (cluster_id);


-- ── 4 · RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE inventory.clusters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.cluster_members ENABLE ROW LEVEL SECURITY;

-- Tenant Y almacén, igual que las incidencias: un operario con acceso solo a OLO-CR no
-- debe ver ni editar las zonas de otro almacén del mismo operador.
CREATE POLICY tenant_isolation ON inventory.clusters
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY solo_su_almacen ON inventory.clusters
    AS RESTRICTIVE FOR ALL
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));
CREATE POLICY del_equipo ON inventory.clusters
    FOR ALL USING (true) WITH CHECK (true);

-- Los miembros heredan el candado del cluster al que pertenecen: sin este EXISTS, un
-- miembro podría apuntar a un cluster de otro almacén.
CREATE POLICY tenant_isolation ON inventory.cluster_members
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY hereda_del_cluster ON inventory.cluster_members
    AS RESTRICTIVE FOR ALL
    USING (EXISTS (SELECT 1 FROM inventory.clusters c
                    WHERE c.id = cluster_id AND core.can_access_warehouse(c.warehouse_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM inventory.clusters c
                         WHERE c.id = cluster_id AND core.can_access_warehouse(c.warehouse_id)));
CREATE POLICY del_equipo ON inventory.cluster_members
    FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory.clusters        TO olo_app;
GRANT SELECT, INSERT, DELETE         ON inventory.cluster_members TO olo_app;


-- ── 5 · La ocupación de cada zona ─────────────────────────────────────────────
--
-- Resuelve la pertenencia de los dos tipos de miembro en una sola vista, para que el
-- cliente no tenga que saber que existen dos formas de meter un rack en una zona.
--
-- `DISTINCT` sobre el rack: un rack puede entrar por su prefijo Y estar añadido a mano
-- —alguien mete «CANT» y luego CANT3 por separado—, y sin esto sus huecos se contarían
-- dos veces. La zona diría tener más capacidad de la que tiene.
CREATE OR REPLACE VIEW inventory.v_cluster_occupancy
WITH (security_invoker = true) AS
WITH racks_del_cluster AS (
    SELECT DISTINCT c.id AS cluster_id, r.rack_id
      FROM inventory.clusters c
      JOIN inventory.cluster_members m ON m.cluster_id = c.id
      JOIN inventory.v_rack_occupancy r ON r.warehouse_id = c.warehouse_id
     WHERE (m.rack_id IS NOT NULL AND r.rack_id = m.rack_id)
        OR (m.prefix IS NOT NULL AND upper(r.rack_code) LIKE upper(btrim(m.prefix)) || '%')
)
SELECT c.id,
       c.warehouse_id,
       c.name,
       c.notes,
       count(rc.rack_id)                        AS racks,
       coalesce(sum(r.locations), 0)::int       AS huecos,
       coalesce(sum(r.occupied), 0)::int        AS ocupados,
       coalesce(sum(r.free), 0)::int            AS libres,
       coalesce(sum(r.blocked), 0)::int         AS bloqueados,
       CASE WHEN coalesce(sum(r.locations), 0) > 0
            THEN round(100.0 * sum(r.occupied) / sum(r.locations), 1)
            ELSE NULL END                       AS ocupacion_pct
  FROM inventory.clusters c
  LEFT JOIN racks_del_cluster rc ON rc.cluster_id = c.id
  LEFT JOIN inventory.v_rack_occupancy r ON r.rack_id = rc.rack_id
 GROUP BY c.id, c.warehouse_id, c.name, c.notes;

GRANT SELECT ON inventory.v_cluster_occupancy TO olo_app;


-- ── Verificación: que FUNCIONE ────────────────────────────────────────────────
DO $verif$
DECLARE
    v_tenant uuid;
    v_wh     uuid;
    v_user   uuid;
    v_c      uuid;
    v_huecos int;
    v_fallos int := 0;
BEGIN
    SELECT m.tenant_id, u.id INTO v_tenant, v_user
      FROM core.users u
      JOIN core.tenant_memberships m ON m.user_id = u.id AND m.revoked_at IS NULL
     WHERE u.deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_wh FROM core.warehouses WHERE tenant_id = v_tenant
       AND EXISTS (SELECT 1 FROM inventory.v_rack_occupancy r WHERE r.warehouse_id = core.warehouses.id)
     LIMIT 1;

    IF v_wh IS NULL THEN
        RAISE NOTICE 'AVISO · ningun almacen con racks: no se puede probar la ocupacion';
        RETURN;
    END IF;

    INSERT INTO inventory.clusters (tenant_id, warehouse_id, name, created_by)
    VALUES (v_tenant, v_wh, 'VERIF-0084', v_user) RETURNING id INTO v_c;

    -- Por prefijo.
    INSERT INTO inventory.cluster_members (tenant_id, cluster_id, prefix)
    VALUES (v_tenant, v_c, 'CANT');
    SELECT huecos INTO v_huecos FROM inventory.v_cluster_occupancy WHERE id = v_c;
    IF coalesce(v_huecos, 0) = 0 THEN
        v_fallos := v_fallos + 1;
        RAISE NOTICE 'MAL · un cluster por prefijo no suma huecos';
    ELSE
        RAISE NOTICE 'OK  · un cluster por prefijo suma % huecos', v_huecos;
    END IF;

    -- El mismo prefijo dos veces se rechaza.
    BEGIN
        INSERT INTO inventory.cluster_members (tenant_id, cluster_id, prefix)
        VALUES (v_tenant, v_c, 'cant');
        v_fallos := v_fallos + 1;
        RAISE NOTICE 'MAL · dejo repetir el mismo prefijo (distinta caja)';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK  · el mismo prefijo dos veces se rechaza, sin importar mayusculas';
    END;

    -- Un miembro con las dos cosas, o con ninguna, no vale.
    BEGIN
        INSERT INTO inventory.cluster_members (tenant_id, cluster_id) VALUES (v_tenant, v_c);
        v_fallos := v_fallos + 1;
        RAISE NOTICE 'MAL · acepto un miembro vacio';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK  · un miembro sin prefijo ni rack se rechaza';
    END;

    -- Dos zonas con el mismo nombre en el mismo almacen.
    BEGIN
        INSERT INTO inventory.clusters (tenant_id, warehouse_id, name, created_by)
        VALUES (v_tenant, v_wh, '  verif-0084 ', v_user);
        v_fallos := v_fallos + 1;
        RAISE NOTICE 'MAL · dejo dos zonas con el mismo nombre';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK  · dos zonas con el mismo nombre se rechazan';
    END;

    DELETE FROM inventory.clusters WHERE id = v_c;

    IF v_fallos > 0 THEN
        RAISE EXCEPTION '% comprobaciones fallaron', v_fallos;
    END IF;
    RAISE NOTICE 'OK · clusters creados y sus guardas verificadas';
END $verif$;
