-- ═══════════════════════════════════════════════════════════════════════════
-- 0049_spatial_sites_and_reference_frames.sql
-- Crea     : spatial.sites · spatial.reference_frames
-- Depende de: 0012 (core.warehouses), 0047 (schema spatial + postgis)
-- Riesgo   : bajo · tablas nuevas, sin datos
--
-- JERARQUÍA:  core.warehouses → spatial.sites → spatial.nodes (0050) → spatial.locations
--
-- `sites` NO se puebla con `Preámbulo`. Decisión A1: el dato mide que
-- `Referencia → Preámbulo` es funcional (0 violaciones en 29.310 filas) pero que
-- `Preámbulo` es ORTOGONAL a `IdSucursal` — 23 pares observados, `Preámbulo=60`
-- convive con 12 `IdSucursal` distintos. Eso descarta que `Preámbulo` sea el sitio
-- físico, así que aquí no se afirma nada: el importador crea UN sitio por almacén
-- con `external_site_code = NULL` e `is_validated = false`, y `Preámbulo` viaja
-- como `external_site_code` del NODO en 0050.
--
-- Promoción futura, si el negocio confirma que los 5 preámbulos son 5 sitios:
-- INSERT de 4 sitios + UPDATE de `site_id` en los nodos + UPDATE de
-- `is_validated`. Ni una `ALTER TABLE`.
--
-- `reference_frames` NACE VACÍA y eso es un estado válido (SPA-09). Un marco
-- declarado sin levantamiento sería una afirmación falsa contra la que alguien
-- cargaría coordenadas. El primer marco lo creará el importador CAD tomando
-- `unit` y `axis_convention` DEL PROPIO ARCHIVO, que es donde esa información
-- existe de verdad.
--
-- ⚠ TRES COLUMNAS OBLIGATORIAS DESDE EL DÍA UNO (TWN-05), porque su ausencia
--   corrompe datos en silencio y de forma irrecuperable:
--     · `unit`             — 12,4 m frente a 12,4 mm es indistinguible después
--     · `axis_convention`  — Z-up frente a Y-up rota el almacén 90°, y el
--                            resultado es consistente y falso
--     · `parent_frame_id`  — sin composición de marcos no hay LiDAR, SLAM ni
--                            robots; añadirla luego exigiría decidir
--                            retroactivamente de quién cuelga cada marco
--
-- Los vocabularios van como CHECK y NO como ENUM: se verificó contra este motor
-- que `ALTER TYPE ... ADD VALUE` no permite USAR el valor en la misma transacción
-- (SQLSTATE 55P04), y cada migración de este proyecto es una sola transacción.
-- Aquí el CHECK es admisible porque son vocabularios FÍSICOS —una unidad de medida
-- o un convenio de ejes no cambian por una decisión operativa—, al contrario que
-- `node_function`, que en 0050 va a catálogo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── spatial.sites ──────────────────────────────────────────────────────────
CREATE TABLE spatial.sites (
    id                uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         uuid         NOT NULL REFERENCES core.tenants(id),
    warehouse_id      uuid         NOT NULL,

    name              varchar(120) NOT NULL,
    code              varchar(30)  NOT NULL,

    -- El valor tal como llega del sistema externo, sin interpretar (principio 3).
    -- NULL mientras el negocio no confirme qué agrupa.
    external_site_code varchar(30) NULL,

    -- Declara si alguien confirmó que este sitio corresponde a un lugar físico.
    is_validated      boolean      NOT NULL DEFAULT false,

    raw_source        jsonb        NOT NULL DEFAULT '{}'::jsonb,
    status            varchar(20)  NOT NULL DEFAULT 'active',

    created_at        timestamptz  NOT NULL DEFAULT now(),
    created_by        uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    updated_by        uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    version           integer      NOT NULL DEFAULT 1,
    deleted_at        timestamptz  NULL,

    -- FK COMPUESTA: un sitio no puede colgar de un almacén de otro tenant.
    -- Es el mismo mecanismo que fk_area_warehouse y fk_loc_area.
    CONSTRAINT fk_site_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),

    -- DOS UNIQUE, para dos FK compuestas de distinta anchura:
    --   · (tenant_id, id)                -> destino de fk_frame_site, 2 columnas
    --   · (tenant_id, warehouse_id, id)  -> destino de la FK de spatial.nodes (0050)
    -- PostgreSQL exige un UNIQUE que coincida EXACTAMENTE con las columnas
    -- referenciadas: uno de tres no satisface una FK de dos. Es el mismo par que
    -- ya tiene core.warehouses con uq_wh_tenant_id.
    CONSTRAINT uq_site_tenant_id    UNIQUE (tenant_id, id),
    CONSTRAINT uq_site_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id),

    CONSTRAINT chk_site_code    CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]*$'),
    CONSTRAINT chk_site_status  CHECK (status IN ('active', 'inactive')),
    CONSTRAINT chk_site_version CHECK (version >= 1),
    CONSTRAINT chk_site_raw     CHECK (jsonb_typeof(raw_source) = 'object'),
    -- Un sitio sin validar no debería afirmar a qué código externo corresponde.
    CONSTRAINT chk_site_validado CHECK (
        (is_validated = false AND external_site_code IS NULL)
     OR (is_validated = true)
    )
);

COMMENT ON TABLE spatial.sites IS
    'Sitio fisico dentro de un almacen. Un almacen admite varios (D3). NO se puebla con Preambulo: el dato mide que Preambulo es ortogonal a IdSucursal, asi que no se afirma que sea un lugar.';
COMMENT ON COLUMN spatial.sites.external_site_code IS
    'Codigo del sistema externo, sin interpretar. NULL hasta que el negocio confirme que agrupa un lugar fisico.';
COMMENT ON COLUMN spatial.sites.is_validated IS
    'false = sitio unico por almacen creado por el importador, sin afirmar naturaleza fisica.';

CREATE UNIQUE INDEX uq_site_code ON spatial.sites (tenant_id, warehouse_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_site_tenant ON spatial.sites (tenant_id);
CREATE INDEX idx_site_wh     ON spatial.sites (tenant_id, warehouse_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_site_external ON spatial.sites (external_site_code)
    WHERE external_site_code IS NOT NULL AND deleted_at IS NULL;


-- ── spatial.reference_frames ───────────────────────────────────────────────
CREATE TABLE spatial.reference_frames (
    id                uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         uuid         NOT NULL REFERENCES core.tenants(id),
    site_id           uuid         NOT NULL,

    code              varchar(40)  NOT NULL,
    name              varchar(120) NOT NULL,

    -- `local` es el marco del edificio; `cad` viene de un plano; `device` es
    -- relativo a un dispositivo; `slam_map` lo produce un robot; `geographic` es
    -- el unico georreferenciado y el unico que usa srid.
    kind              varchar(20)  NOT NULL,

    -- TWN-05: sin unidad, un 12.4 es indistinguible entre metros y milimetros.
    unit              varchar(10)  NOT NULL,
    -- TWN-05: confundir Z-up con Y-up rota el almacen 90 grados en silencio.
    axis_convention   varchar(10)  NOT NULL,

    -- Composición de marcos. Sin esto no hay LiDAR, SLAM ni robots.
    parent_frame_id   uuid         NULL REFERENCES spatial.reference_frames(id)
                                        ON DELETE RESTRICT,
    -- Transformación al marco padre: traslación, rotación y escala. Estructura
    -- libre a proposito: una rotacion se expresa como cuaternion o como matriz
    -- segun la fuente, y fijar una sola ahora obligaria a convertir en el
    -- importador antes de saber que entrega cada formato.
    transform         jsonb        NOT NULL DEFAULT '{}'::jsonb,

    -- Solo para kind='geographic'.
    srid              integer      NULL,

    -- Procedencia: de que archivo o levantamiento salio este marco.
    provenance        jsonb        NOT NULL DEFAULT '{}'::jsonb,
    surveyed_at       timestamptz  NULL,

    created_at        timestamptz  NOT NULL DEFAULT now(),
    created_by        uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    updated_by        uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    version           integer      NOT NULL DEFAULT 1,
    deleted_at        timestamptz  NULL,

    CONSTRAINT fk_frame_site FOREIGN KEY (tenant_id, site_id)
        REFERENCES spatial.sites (tenant_id, id),
    CONSTRAINT uq_frame_tenant_id UNIQUE (tenant_id, id),

    CONSTRAINT chk_frame_kind CHECK (kind IN
        ('local', 'cad', 'device', 'slam_map', 'geographic')),
    CONSTRAINT chk_frame_unit CHECK (unit IN ('m', 'mm', 'cm')),
    CONSTRAINT chk_frame_axis CHECK (axis_convention IN ('z_up', 'y_up')),
    CONSTRAINT chk_frame_version CHECK (version >= 1),
    CONSTRAINT chk_frame_transform  CHECK (jsonb_typeof(transform) = 'object'),
    CONSTRAINT chk_frame_provenance CHECK (jsonb_typeof(provenance) = 'object'),
    -- El srid solo tiene sentido en un marco georreferenciado, y ahi es obligatorio.
    CONSTRAINT chk_frame_srid CHECK (
        (kind = 'geographic' AND srid IS NOT NULL)
     OR (kind <> 'geographic' AND srid IS NULL)
    ),
    -- Un marco derivado necesita transformacion; el raiz no puede tenerla.
    CONSTRAINT chk_frame_transform_coherente CHECK (
        (parent_frame_id IS NULL     AND transform = '{}'::jsonb)
     OR (parent_frame_id IS NOT NULL AND transform <> '{}'::jsonb)
    ),
    CONSTRAINT chk_frame_no_autopadre CHECK (parent_frame_id IS DISTINCT FROM id)
);

COMMENT ON TABLE spatial.reference_frames IS
    'Marcos de coordenadas del gemelo digital. NACE VACIA y vacia es un estado VALIDO (SPA-09): un marco sin levantamiento seria una afirmacion falsa. El primer marco lo crea el importador CAD tomando unit y axis_convention del propio archivo.';
COMMENT ON COLUMN spatial.reference_frames.unit IS
    'TWN-05 obligatoria: sin unidad, un 12.4 cargado hoy es indistinguible manana entre 12,4 m y 12,4 mm.';
COMMENT ON COLUMN spatial.reference_frames.axis_convention IS
    'TWN-05 obligatoria: DWG e IFC son z_up, varios formatos 3D son y_up. Confundirlos rota el almacen 90 grados de forma consistente y falsa.';
COMMENT ON COLUMN spatial.reference_frames.parent_frame_id IS
    'Composicion de marcos. Sin ella cada integracion transformaria por su cuenta y dos lo harian distinto (TWN-04).';

CREATE UNIQUE INDEX uq_frame_code ON spatial.reference_frames (tenant_id, site_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_frame_tenant ON spatial.reference_frames (tenant_id);
CREATE INDEX idx_frame_site   ON spatial.reference_frames (tenant_id, site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_frame_parent ON spatial.reference_frames (parent_frame_id)
    WHERE parent_frame_id IS NOT NULL;


-- ── Triggers: se reutilizan los de core, no se duplican ────────────────────
CREATE TRIGGER set_updated_at_site BEFORE UPDATE ON spatial.sites
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER prevent_tenant_change_site BEFORE UPDATE ON spatial.sites
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();

CREATE TRIGGER set_updated_at_frame BEFORE UPDATE ON spatial.reference_frames
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER prevent_tenant_change_frame BEFORE UPDATE ON spatial.reference_frames
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();


-- ── RLS · mismo patrón que spatial.areas y spatial.locations ───────────────
ALTER TABLE spatial.sites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.sites            FORCE  ROW LEVEL SECURITY;
ALTER TABLE spatial.reference_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.reference_frames FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON spatial.sites
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON spatial.sites
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

CREATE POLICY tenant_isolation ON spatial.reference_frames
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- El alcance de almacén se hereda del sitio: un marco no lleva warehouse_id
-- propio para no desnormalizar un tercer nivel que habría que mantener coherente.
CREATE POLICY site_scope ON spatial.reference_frames
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (EXISTS (
        SELECT 1 FROM spatial.sites s
         WHERE s.id = reference_frames.site_id
           AND core.can_access_warehouse(s.warehouse_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM spatial.sites s
         WHERE s.id = reference_frames.site_id
           AND core.can_access_warehouse(s.warehouse_id)
    ));


-- ── Grants: explícitos, no solo por default privileges ─────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.sites            TO olo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.reference_frames TO olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_n         int;
    v_force     int;
    v_pol       int;
    v_restr     int;
    v_idx       int;
    v_trg       int;
    v_rechazado boolean;
    v_frame_id  uuid;
BEGIN
    -- Las dos tablas existen, vacías, con FORCE RLS.
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname IN ('sites', 'reference_frames');
    IF v_n <> 2 THEN RAISE EXCEPTION 'se esperaban 2 tablas nuevas, hay %', v_n; END IF;

    SELECT count(1) INTO v_force FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname IN ('sites', 'reference_frames')
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_force <> 2 THEN RAISE EXCEPTION 'FORCE RLS falta en % tabla(s)', 2 - v_force; END IF;

    SELECT count(1), count(1) FILTER (WHERE permissive = 'RESTRICTIVE')
      INTO v_pol, v_restr FROM pg_policies
     WHERE schemaname = 'spatial' AND tablename IN ('sites', 'reference_frames');
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 politicas, hay %', v_pol; END IF;
    IF v_restr <> 2 THEN RAISE EXCEPTION 'se esperaban 2 RESTRICTIVE, hay %', v_restr; END IF;

    SELECT count(1) INTO v_idx FROM pg_index i JOIN pg_class ct ON ct.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'spatial' AND ct.relname IN ('sites', 'reference_frames');
    -- 4 sites (pk + uq_tenant_wh_id + 3 idx… ) + reference_frames. Se cuenta el total.
    IF v_idx < 12 THEN RAISE EXCEPTION 'se esperaban al menos 12 indices, hay %', v_idx; END IF;

    SELECT count(1) INTO v_trg FROM pg_trigger t JOIN pg_class ct ON ct.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'spatial' AND ct.relname IN ('sites', 'reference_frames')
       AND NOT t.tgisinternal;
    IF v_trg <> 4 THEN RAISE EXCEPTION 'se esperaban 4 triggers, hay %', v_trg; END IF;

    IF NOT has_table_privilege('olo_app', 'spatial.sites', 'SELECT')
       OR NOT has_table_privilege('olo_app', 'spatial.reference_frames', 'INSERT') THEN
        RAISE EXCEPTION 'faltan grants para olo_app';
    END IF;

    -- reference_frames NACE VACÍA: es el estado válido de SPA-09.
    SELECT count(1) INTO v_n FROM spatial.reference_frames;
    IF v_n <> 0 THEN RAISE EXCEPTION 'reference_frames deberia nacer vacia, tiene %', v_n; END IF;

    -- ── Pruebas vivas de los CHECK que protegen datos ──────────────────────
    -- Verificar que un CHECK existe no demuestra que rechace.

    -- 1 · un marco sin unidad no debe poder existir (TWN-05)
    v_rechazado := false;
    BEGIN
        INSERT INTO spatial.reference_frames
            (tenant_id, site_id, code, name, kind, unit, axis_convention)
        VALUES (uuid_generate_v4(), uuid_generate_v4(), 'X', 'x', 'local', 'leguas', 'z_up');
    EXCEPTION WHEN check_violation THEN v_rechazado := true;
              WHEN foreign_key_violation THEN v_rechazado := true;
    END;
    IF NOT v_rechazado THEN RAISE EXCEPTION 'se acepto una unidad invalida'; END IF;

    -- 2 · un convenio de ejes inventado tampoco
    v_rechazado := false;
    BEGIN
        INSERT INTO spatial.reference_frames
            (tenant_id, site_id, code, name, kind, unit, axis_convention)
        VALUES (uuid_generate_v4(), uuid_generate_v4(), 'X', 'x', 'local', 'm', 'x_up');
    EXCEPTION WHEN check_violation THEN v_rechazado := true;
              WHEN foreign_key_violation THEN v_rechazado := true;
    END;
    IF NOT v_rechazado THEN RAISE EXCEPTION 'se acepto un axis_convention invalido'; END IF;

    -- 3 · un sitio sin validar no puede afirmar external_site_code
    v_rechazado := false;
    BEGIN
        INSERT INTO spatial.sites (tenant_id, warehouse_id, name, code,
                                   external_site_code, is_validated)
        VALUES (uuid_generate_v4(), uuid_generate_v4(), 'x', 'X', '60', false);
    EXCEPTION WHEN check_violation THEN v_rechazado := true;
              WHEN foreign_key_violation THEN v_rechazado := true;
    END;
    IF NOT v_rechazado THEN
        RAISE EXCEPTION 'se acepto un external_site_code en un sitio sin validar';
    END IF;

    -- 4 · un marco geografico exige srid, y uno local no lo admite
    v_rechazado := false;
    BEGIN
        INSERT INTO spatial.reference_frames
            (tenant_id, site_id, code, name, kind, unit, axis_convention, srid)
        VALUES (uuid_generate_v4(), uuid_generate_v4(), 'X', 'x', 'local', 'm', 'z_up', 4326);
    EXCEPTION WHEN check_violation THEN v_rechazado := true;
              WHEN foreign_key_violation THEN v_rechazado := true;
    END;
    IF NOT v_rechazado THEN RAISE EXCEPTION 'un marco local no debe admitir srid'; END IF;

    RAISE NOTICE
        'OK 0049: spatial.sites y spatial.reference_frames · % indices · 4 triggers · '
        '4 politicas (2 restrictive) · FORCE RLS · grants a olo_app · '
        'reference_frames vacia (valido) · 4 CHECK probados en vivo',
        v_idx;
END
$$;
