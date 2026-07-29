-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0007_create_tenants.sql
-- Crea      : core.tenants + RLS (plantilla T2 sobre `id`) + trigger
-- Por qué   : raíz de todo el modelo. Es la unidad de aislamiento de datos:
--             cada tabla de negocio cuelga de aquí por tenant_id.
-- Depende de: 0004 (funciones de contexto), 0005 (triggers), 0002 (olo_app)
-- Rollback  : supabase/rollbacks/0007_create_tenants.down.sql
-- Riesgo    : medio
--
-- Nota 1: `core.tenants` NO lleva la columna tenant_id: el tenant ES la fila,
--         así que su política T2 se evalúa sobre `id`. Por lo mismo, NO se le
--         engancha el trigger prevent_tenant_change(), que lee NEW.tenant_id y
--         fallaría en tiempo de ejecución con "record new has no field".
-- Nota 2: sin `deleted_at`. El ciclo de vida usa status='deleted' más el
--         período de retención de 90 días (FINAL_DATABASE_MODEL.md §4.4).
-- Nota 3: created_by / updated_by son UUID SIN clave foránea. Dos razones: en
--         el orden del roadmap core.users no existe todavía (0010), y el actor
--         que crea un tenant es un platform admin, que por diseño no tiene
--         fila en core.users (se identifica por claim del JWT). Ponerle una FK
--         a core.users sería semánticamente incorrecto, no solo prematuro.
-- Nota 4: sin política de INSERT. Los tenants se crean por la RPC de
--         aprovisionamiento con service_role, que tiene BYPASSRLS. Ni
--         `olo_app` ni `authenticated` pueden crear tenants.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Tabla ───────────────────────────────────────────────────────────────
CREATE TABLE core.tenants (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(200) NOT NULL,
    slug          VARCHAR(100) NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'trial',
    plan          VARCHAR(50)  NOT NULL DEFAULT 'starter',
    settings      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    limits        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    trial_ends_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by    UUID,
    version       INT          NOT NULL DEFAULT 1,

    -- Ciclo de vida completo: trial → active → suspended → cancelled → deleted,
    -- más la rama trial → expired → cancelled.
    CONSTRAINT chk_tenants_status CHECK (
        status IN ('trial','active','suspended','cancelled','expired','deleted')),
    CONSTRAINT chk_tenants_plan CHECK (
        plan IN ('starter','professional','enterprise','custom')),
    -- El slug identifica al tenant en URLs: minúsculas, dígitos y guiones
    -- internos. Sin guion inicial ni final.
    CONSTRAINT chk_tenants_slug CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
    CONSTRAINT chk_tenants_name CHECK (length(btrim(name)) >= 2),
    CONSTRAINT chk_tenants_version CHECK (version >= 1),
    CONSTRAINT chk_tenants_trial CHECK (trial_ends_at IS NULL OR trial_ends_at > created_at),
    -- settings y limits son objetos, no arrays ni escalares. Sin esto, un
    -- '[]' o un '"texto"' pasarían y romperían la lectura de configuración.
    CONSTRAINT chk_tenants_settings_object CHECK (jsonb_typeof(settings) = 'object'),
    CONSTRAINT chk_tenants_limits_object   CHECK (jsonb_typeof(limits)   = 'object')
);

CREATE UNIQUE INDEX uq_tenants_slug ON core.tenants (slug);
CREATE INDEX idx_tenants_status ON core.tenants (status) WHERE status <> 'deleted';

COMMENT ON TABLE core.tenants IS
    'Organizacion cliente. Unidad de aislamiento de datos: toda tabla de negocio cuelga de aqui por tenant_id.';
COMMENT ON COLUMN core.tenants.slug       IS 'Identificador en URLs. Unico globalmente.';
COMMENT ON COLUMN core.tenants.settings   IS 'Configuracion del tenant (branding, locale, timezone por defecto).';
COMMENT ON COLUMN core.tenants.limits     IS 'Limites del plan contratado (usuarios, almacenes, storage).';
COMMENT ON COLUMN core.tenants.version    IS 'Optimistic locking. La incrementa la aplicacion, NUNCA el trigger.';
COMMENT ON COLUMN core.tenants.created_by IS 'Platform admin que aprovisiono el tenant. Sin FK: puede no existir en core.users.';


-- ── 2. Trigger ─────────────────────────────────────────────────────────────
-- Solo set_updated_at. prevent_tenant_change NO aplica (ver Nota 1).
CREATE TRIGGER set_updated_at_tenants
    BEFORE UPDATE ON core.tenants
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── 3. RLS · plantilla T2 sobre `id` ───────────────────────────────────────
ALTER TABLE core.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenants FORCE  ROW LEVEL SECURITY;

-- Piso duro. RESTRICTIVE se evalúa con AND, así que ninguna política que se
-- añada en el futuro puede ampliar este aislamiento por la vía del OR.
CREATE POLICY tenant_isolation ON core.tenants
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (id = core.current_tenant_id())
    WITH CHECK (id = core.current_tenant_id());

-- Concesión: el tenant se ve a sí mismo, y solo a sí mismo.
CREATE POLICY tenant_self ON core.tenants
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (id = core.current_tenant_id());

-- Sin políticas de INSERT, UPDATE ni DELETE para roles de aplicación:
-- el ciclo de vida del tenant es una operación de plataforma.


-- ── 4. Verificación estructural ────────────────────────────────────────────
DO $$
DECLARE
    v_rls   boolean;
    v_force boolean;
    v_pol   int;
    v_trg   int;
    v_chk   int;
BEGIN
    SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = 'tenants';

    SELECT count(*) INTO v_pol FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'tenants';

    SELECT count(*) INTO v_trg FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = 'tenants' AND NOT t.tgisinternal;

    SELECT count(*) INTO v_chk FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = 'tenants' AND con.contype = 'c';

    IF NOT v_rls   THEN RAISE EXCEPTION 'core.tenants sin ENABLE ROW LEVEL SECURITY'; END IF;
    IF NOT v_force THEN RAISE EXCEPTION 'core.tenants sin FORCE ROW LEVEL SECURITY'; END IF;
    IF v_pol <> 2  THEN RAISE EXCEPTION 'core.tenants tiene % politicas, se esperaban 2', v_pol; END IF;
    IF v_trg <> 1  THEN RAISE EXCEPTION 'core.tenants tiene % triggers, se esperaba 1', v_trg; END IF;
    IF v_chk <> 8  THEN RAISE EXCEPTION 'core.tenants tiene % CHECK, se esperaban 8', v_chk; END IF;

    -- Debe existir exactamente una política RESTRICTIVE: es el piso duro.
    IF (SELECT count(*) FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname='core' AND c.relname='tenants' AND p.polpermissive IS FALSE) <> 1 THEN
        RAISE EXCEPTION 'core.tenants no tiene exactamente 1 politica RESTRICTIVE';
    END IF;
END
$$;
