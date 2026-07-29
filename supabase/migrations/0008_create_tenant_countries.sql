-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0008_create_tenant_countries.sql
-- Crea      : core.tenant_countries + RLS T2 + triggers
-- Por qué   : presencia operativa de un tenant en un país, con su
--             configuración regional. Separa el hecho global (ISO, 0003) del
--             dato del tenant. Es el padre de core.companies.
-- Depende de: 0003 (public.countries, public.currencies), 0007 (core.tenants)
-- Rollback  : supabase/rollbacks/0008_create_tenant_countries.down.sql
-- Riesgo    : bajo
--
-- Nota 1: `UNIQUE (tenant_id, id)` es redundante en unicidad —`id` ya es PK—
--         pero es IMPRESCINDIBLE: es el destino de la FK compuesta que usará
--         core.companies en 0009. PostgreSQL exige un índice único como
--         destino de toda clave foránea.
-- Nota 2: created_by / updated_by son columnas de auditoría UUID **sin FK** a
--         core.users, y esto es una decisión consistente para todo el modelo:
--         el actor puede ser un platform admin (sin fila en core.users) o un
--         usuario purgado por derecho al olvido. La trazabilidad real vive en
--         audit.events. Evita además dependencias circulares de orden.
-- Nota 3: el timezone NO se valida con CHECK. La única fuente fiable es
--         pg_timezone_names, que es una vista no inmutable y por tanto no
--         admisible en un CHECK. Se valida en la capa de aplicación.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE core.tenant_countries (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL REFERENCES core.tenants(id),
    country_id            UUID        NOT NULL REFERENCES public.countries(id),
    status                VARCHAR(20) NOT NULL DEFAULT 'active',
    default_currency_code CHAR(3)     NOT NULL REFERENCES public.currencies(code),
    default_locale        VARCHAR(10) NOT NULL DEFAULT 'es',
    default_timezone      VARCHAR(50) NOT NULL DEFAULT 'UTC',
    fiscal_config         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    number_format         VARCHAR(20) NOT NULL DEFAULT 'es-CR',
    date_format           VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by            UUID,
    version               INT         NOT NULL DEFAULT 1,
    deleted_at            TIMESTAMPTZ,

    CONSTRAINT uq_tc_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT chk_tc_status  CHECK (status IN ('active','inactive')),
    CONSTRAINT chk_tc_version CHECK (version >= 1),
    CONSTRAINT chk_tc_fiscal_object CHECK (jsonb_typeof(fiscal_config) = 'object'),
    CONSTRAINT chk_tc_locale  CHECK (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

-- Clave comercial: un país operativo por tenant. Índice PARCIAL para que el
-- soft delete permita volver a activar el mismo país más adelante.
CREATE UNIQUE INDEX uq_tc_tenant_country
    ON core.tenant_countries (tenant_id, country_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_tc_tenant  ON core.tenant_countries (tenant_id);
CREATE INDEX idx_tc_country ON core.tenant_countries (tenant_id, country_id);

COMMENT ON TABLE core.tenant_countries IS
    'Presencia operativa de un tenant en un pais, con su configuracion regional. Padre de core.companies.';
COMMENT ON CONSTRAINT uq_tc_tenant_id ON core.tenant_countries IS
    'Destino de la FK compuesta de core.companies. Redundante en unicidad, imprescindible como destino.';


-- ── Triggers ───────────────────────────────────────────────────────────────
CREATE TRIGGER set_updated_at_tc
    BEFORE UPDATE ON core.tenant_countries
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER prevent_tenant_change_tc
    BEFORE UPDATE ON core.tenant_countries
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();


-- ── RLS · plantilla T2 ─────────────────────────────────────────────────────
ALTER TABLE core.tenant_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenant_countries FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.tenant_countries
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_members ON core.tenant_countries
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());


-- ── Verificación estructural ───────────────────────────────────────────────
DO $$
DECLARE v_rls boolean; v_force boolean; v_pol int; v_trg int; v_restr int;
BEGIN
    SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='tenant_countries';
    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname='core' AND tablename='tenant_countries';
    SELECT count(1) INTO v_trg FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='tenant_countries' AND NOT t.tgisinternal;
    SELECT count(1) INTO v_restr FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='tenant_countries' AND p.polpermissive IS FALSE;

    IF NOT v_rls   THEN RAISE EXCEPTION 'tenant_countries sin RLS'; END IF;
    IF NOT v_force THEN RAISE EXCEPTION 'tenant_countries sin FORCE RLS'; END IF;
    IF v_pol   <> 2 THEN RAISE EXCEPTION 'tenant_countries: % politicas, se esperaban 2', v_pol; END IF;
    IF v_trg   <> 2 THEN RAISE EXCEPTION 'tenant_countries: % triggers, se esperaban 2', v_trg; END IF;
    IF v_restr <> 1 THEN RAISE EXCEPTION 'tenant_countries: % politicas RESTRICTIVE, se esperaba 1', v_restr; END IF;
END
$$;
