-- ═══════════════════════════════════════════════════════════════════════════
-- 0012_create_warehouse_hierarchy.sql
-- Crea      : core.warehouses, core.areas, core.locations
-- Depende de: 0009 (companies), 0005 (triggers)
-- Riesgo    : ALTO — la cadena de FK compuestas es el mecanismo que hace
--             imposible la jerarquía cruzada, verificado empíricamente (V5).
--
-- ⚠ TABLAS SIN POLÍTICAS RLS. Es deliberado y resuelve la única dependencia
--   circular del roadmap: las políticas T3 necesitan core.can_access_warehouse(),
--   que a su vez lee core.user_warehouse_access (0014). Aquí se habilita
--   ENABLE + FORCE sin políticas —fail-secure: ningún rol de aplicación
--   alcanza las tablas— y 0015 añade las políticas cuando ya existen las
--   funciones. `postgres` las alcanza por BYPASSRLS, que es lo que permite
--   sembrarlas y probarlas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── warehouses ─────────────────────────────────────────────────────────────
CREATE TABLE core.warehouses (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL REFERENCES core.tenants(id),
    company_id    UUID         NOT NULL,
    name          VARCHAR(200) NOT NULL,
    code          VARCHAR(20)  NOT NULL,
    address       JSONB,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    timezone      VARCHAR(50)  NOT NULL DEFAULT 'UTC',
    locale        VARCHAR(10)  NOT NULL DEFAULT 'es',
    currency_code CHAR(3)      REFERENCES public.currencies(code),
    settings      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    status        VARCHAR(20)  NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by    UUID,
    version       INT          NOT NULL DEFAULT 1,
    deleted_at    TIMESTAMPTZ,

    CONSTRAINT uq_wh_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_wh_company FOREIGN KEY (tenant_id, company_id)
        REFERENCES core.companies (tenant_id, id),

    CONSTRAINT chk_wh_status  CHECK (status IN ('active','inactive','maintenance')),
    CONSTRAINT chk_wh_version CHECK (version >= 1),
    CONSTRAINT chk_wh_code    CHECK (code ~ '^[A-Z0-9][A-Z0-9-]*$'),
    CONSTRAINT chk_wh_name    CHECK (length(btrim(name)) >= 2),
    CONSTRAINT chk_wh_lat     CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    CONSTRAINT chk_wh_lon     CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    -- Coordenadas: o las dos o ninguna. Una sola no ubica nada.
    CONSTRAINT chk_wh_coords  CHECK ((latitude IS NULL) = (longitude IS NULL)),
    CONSTRAINT chk_wh_settings_object CHECK (jsonb_typeof(settings) = 'object'),
    CONSTRAINT chk_wh_address_object  CHECK (address IS NULL OR jsonb_typeof(address) = 'object')
);

CREATE UNIQUE INDEX uq_wh_code ON core.warehouses (tenant_id, company_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_wh_tenant  ON core.warehouses (tenant_id);
CREATE INDEX idx_wh_company ON core.warehouses (tenant_id, company_id);
CREATE INDEX idx_wh_active  ON core.warehouses (tenant_id, company_id)
    WHERE status = 'active' AND deleted_at IS NULL;

COMMENT ON TABLE core.warehouses IS
    'Unidad operativa fisica. Frontera de autorizacion de segundo nivel.';

-- ── areas ──────────────────────────────────────────────────────────────────
CREATE TABLE core.areas (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL REFERENCES core.tenants(id),
    warehouse_id  UUID         NOT NULL,
    name          VARCHAR(100) NOT NULL,
    code          VARCHAR(20)  NOT NULL,
    type          VARCHAR(30)  NOT NULL,
    max_locations INT,
    status        VARCHAR(20)  NOT NULL DEFAULT 'active',
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by    UUID,
    version       INT          NOT NULL DEFAULT 1,
    deleted_at    TIMESTAMPTZ,

    -- Destino de la FK TRIPLE de locations
    CONSTRAINT uq_area_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id),
    CONSTRAINT fk_area_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),

    CONSTRAINT chk_area_type CHECK (type IN
        ('receiving','storage','picking','shipping','staging','quarantine','returns')),
    CONSTRAINT chk_area_status  CHECK (status IN ('active','inactive')),
    CONSTRAINT chk_area_version CHECK (version >= 1),
    CONSTRAINT chk_area_code    CHECK (code ~ '^[A-Z0-9][A-Z0-9-]*$'),
    CONSTRAINT chk_area_maxloc  CHECK (max_locations IS NULL OR max_locations > 0),
    CONSTRAINT chk_area_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX uq_area_code ON core.areas (tenant_id, warehouse_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_area_tenant ON core.areas (tenant_id);
CREATE INDEX idx_area_wh     ON core.areas (tenant_id, warehouse_id);

-- ── locations ──────────────────────────────────────────────────────────────
CREATE TABLE core.locations (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL REFERENCES core.tenants(id),
    warehouse_id  UUID         NOT NULL,
    area_id       UUID         NOT NULL,
    code          VARCHAR(30)  NOT NULL,
    type          VARCHAR(20)  NOT NULL,
    level         INT,
    max_weight_kg DOUBLE PRECISION,
    max_volume_m3 DOUBLE PRECISION,
    max_units     INT,
    status        VARCHAR(20)  NOT NULL DEFAULT 'available',
    metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by    UUID,
    version       INT          NOT NULL DEFAULT 1,
    deleted_at    TIMESTAMPTZ,

    CONSTRAINT uq_loc_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id),

    -- ⚠ LA FK QUE CIERRA LA JERARQUÍA: el área debe pertenecer al MISMO tenant
    --   Y al MISMO almacén. Con FK independientes sería insertable una
    --   ubicación cuyo area_id está en otro almacén: RLS protegería según
    --   warehouse_id mientras la aplicación navega por area_id, y eso es una
    --   fuga horizontal silenciosa.
    CONSTRAINT fk_loc_area FOREIGN KEY (tenant_id, warehouse_id, area_id)
        REFERENCES core.areas (tenant_id, warehouse_id, id),

    CONSTRAINT chk_loc_type CHECK (type IN ('rack','shelf','bin','floor','dock','pallet','bulk')),
    CONSTRAINT chk_loc_status CHECK (status IN
        ('available','occupied','blocked','reserved','maintenance')),
    CONSTRAINT chk_loc_version CHECK (version >= 1),
    CONSTRAINT chk_loc_code    CHECK (code ~ '^[A-Z0-9][A-Z0-9.-]*$'),
    CONSTRAINT chk_loc_level   CHECK (level IS NULL OR level >= 0),
    CONSTRAINT chk_loc_weight  CHECK (max_weight_kg IS NULL OR max_weight_kg > 0),
    CONSTRAINT chk_loc_volume  CHECK (max_volume_m3 IS NULL OR max_volume_m3 > 0),
    CONSTRAINT chk_loc_units   CHECK (max_units IS NULL OR max_units > 0),
    CONSTRAINT chk_loc_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX uq_loc_code ON core.locations (tenant_id, area_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_loc_tenant ON core.locations (tenant_id);
CREATE INDEX idx_loc_wh     ON core.locations (tenant_id, warehouse_id);
CREATE INDEX idx_loc_area   ON core.locations (tenant_id, area_id);
CREATE INDEX idx_loc_available ON core.locations (tenant_id, warehouse_id)
    WHERE status = 'available' AND deleted_at IS NULL;

COMMENT ON CONSTRAINT fk_loc_area ON core.locations IS
    'FK TRIPLE: impide que una ubicacion cuelgue de un area de otro almacen o de otro tenant.';

-- ── Triggers ───────────────────────────────────────────────────────────────
CREATE TRIGGER set_updated_at_wh   BEFORE UPDATE ON core.warehouses
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER prevent_tenant_change_wh BEFORE UPDATE ON core.warehouses
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();

CREATE TRIGGER set_updated_at_area BEFORE UPDATE ON core.areas
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER prevent_tenant_change_area BEFORE UPDATE ON core.areas
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();

CREATE TRIGGER set_updated_at_loc  BEFORE UPDATE ON core.locations
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER prevent_tenant_change_loc BEFORE UPDATE ON core.locations
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();

-- ── RLS habilitado, políticas en 0015 ──────────────────────────────────────
ALTER TABLE core.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.warehouses FORCE  ROW LEVEL SECURITY;
ALTER TABLE core.areas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.areas      FORCE  ROW LEVEL SECURITY;
ALTER TABLE core.locations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.locations  FORCE  ROW LEVEL SECURITY;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_fk int; v_force int;
BEGIN
    -- Las tres FK compuestas, con 2, 2 y 3 columnas de origen
    SELECT count(1) INTO v_fk FROM pg_constraint
     WHERE conname IN ('fk_wh_company','fk_area_warehouse','fk_loc_area');
    IF v_fk <> 3 THEN RAISE EXCEPTION 'faltan FK compuestas: % de 3', v_fk; END IF;

    IF (SELECT array_length(conkey,1) FROM pg_constraint WHERE conname='fk_loc_area') <> 3 THEN
        RAISE EXCEPTION 'fk_loc_area no es una FK de 3 columnas';
    END IF;

    SELECT count(1) INTO v_force FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname IN ('warehouses','areas','locations')
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_force <> 3 THEN RAISE EXCEPTION 'RLS+FORCE en % de 3 tablas', v_force; END IF;
END
$$;
