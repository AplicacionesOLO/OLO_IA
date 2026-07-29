-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0009_create_companies.sql
-- Crea      : core.companies + RLS T2 + triggers + PRIMERA FK COMPUESTA
-- Por qué   : entidad legal dentro de un tenant. Padre de core.warehouses.
-- Depende de: 0008 (core.tenant_countries)
-- Rollback  : supabase/rollbacks/0009_create_companies.down.sql
-- Riesgo    : medio
--
-- ⚠ ESTA MIGRACIÓN INTRODUCE EL MECANISMO CENTRAL DE INTEGRIDAD JERÁRQUICA.
--
-- La FK compuesta (tenant_id, tenant_country_id) → tenant_countries (tenant_id, id)
-- hace IMPOSIBLE a nivel de motor que una company cuelgue del país operativo de
-- otro tenant. Con dos FK independientes —una a tenants y otra a
-- tenant_countries— cada una sería válida por separado y nada las relacionaría:
-- se podría insertar una company del tenant A apuntando al tenant_country del
-- tenant B. RLS lo ocultaría, pero el dato ya estaría corrupto.
--
-- El mecanismo se verificó empíricamente antes de adoptarlo (V5).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE core.companies (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID         NOT NULL REFERENCES core.tenants(id),
    tenant_country_id UUID         NOT NULL,
    name              VARCHAR(200) NOT NULL,
    legal_name        VARCHAR(300),
    tax_id            VARCHAR(50),
    logo_file_id      UUID,
    address           JSONB,
    settings          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    status            VARCHAR(20)  NOT NULL DEFAULT 'active',
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by        UUID,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by        UUID,
    version           INT          NOT NULL DEFAULT 1,
    deleted_at        TIMESTAMPTZ,

    -- Destino de la FK compuesta de core.warehouses (0012)
    CONSTRAINT uq_comp_tenant_id UNIQUE (tenant_id, id),

    -- LA FK COMPUESTA: el país operativo debe ser del MISMO tenant
    CONSTRAINT fk_comp_tenant_country
        FOREIGN KEY (tenant_id, tenant_country_id)
        REFERENCES core.tenant_countries (tenant_id, id),

    CONSTRAINT chk_comp_status  CHECK (status IN ('active','inactive')),
    CONSTRAINT chk_comp_version CHECK (version >= 1),
    CONSTRAINT chk_comp_name    CHECK (length(btrim(name)) >= 2),
    CONSTRAINT chk_comp_settings_object CHECK (jsonb_typeof(settings) = 'object'),
    CONSTRAINT chk_comp_address_object  CHECK (address IS NULL OR jsonb_typeof(address) = 'object')
);

-- Clave comercial: el identificador fiscal es único por tenant y país.
-- Parcial dos veces: solo filas vivas y solo cuando hay tax_id.
CREATE UNIQUE INDEX uq_comp_tax
    ON core.companies (tenant_id, tenant_country_id, tax_id)
    WHERE tax_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_comp_tenant  ON core.companies (tenant_id);
CREATE INDEX idx_comp_country ON core.companies (tenant_id, tenant_country_id);

COMMENT ON TABLE core.companies IS
    'Entidad legal dentro de un tenant. Padre de core.warehouses.';
COMMENT ON CONSTRAINT fk_comp_tenant_country ON core.companies IS
    'FK COMPUESTA: impide que una company cuelgue del pais operativo de otro tenant.';


-- ── Triggers ───────────────────────────────────────────────────────────────
CREATE TRIGGER set_updated_at_comp
    BEFORE UPDATE ON core.companies
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER prevent_tenant_change_comp
    BEFORE UPDATE ON core.companies
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();


-- ── RLS · plantilla T2 ─────────────────────────────────────────────────────
ALTER TABLE core.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.companies FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.companies
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_members ON core.companies
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());


-- ── Verificación estructural ───────────────────────────────────────────────
DO $$
DECLARE v_force boolean; v_pol int; v_trg int; v_fk int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='companies';
    SELECT count(1) INTO v_pol FROM pg_policies WHERE schemaname='core' AND tablename='companies';
    SELECT count(1) INTO v_trg FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='companies' AND NOT t.tgisinternal;
    -- La FK compuesta debe tener DOS columnas de origen
    SELECT count(1) INTO v_fk FROM pg_constraint
     WHERE conname='fk_comp_tenant_country' AND array_length(conkey,1)=2;

    IF NOT v_force THEN RAISE EXCEPTION 'companies sin FORCE RLS'; END IF;
    IF v_pol <> 2  THEN RAISE EXCEPTION 'companies: % politicas, se esperaban 2', v_pol; END IF;
    IF v_trg <> 2  THEN RAISE EXCEPTION 'companies: % triggers, se esperaban 2', v_trg; END IF;
    IF v_fk  <> 1  THEN RAISE EXCEPTION 'companies: la FK compuesta no tiene 2 columnas de origen'; END IF;
END
$$;
