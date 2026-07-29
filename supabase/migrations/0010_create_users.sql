-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0010_create_users.sql
-- Crea      : core.users — IDENTIDAD GLOBAL DE PLATAFORMA
-- Por qué   : DEC-04. Una persona = una fila, sin importar en cuántos tenants
--             opere. La pertenencia se expresa en core.tenant_memberships (0011).
-- Depende de: 0005 (triggers)
-- Rollback  : supabase/rollbacks/0010_create_users.down.sql
-- Riesgo    : ALTO — cambio de modelo respecto a DATABASE_DESIGN.md
--
-- ⚠ ESTA TABLA NO LLEVA tenant_id. Es deliberado y es el núcleo de DEC-04.
--
-- El motivo técnico que decide el modelo: Supabase Auth impone unicidad GLOBAL
-- de email sobre auth.users. Como cada fila de core.users se corresponde 1:1
-- con una de auth.users vía auth_id, dos filas con el mismo email exigirían dos
-- auth.users con el mismo email, que Supabase rechaza. Es decir: el email ya
-- era global de hecho. Un UNIQUE (tenant_id, email) habría permitido a nivel de
-- base de datos algo que la capa de autenticación prohíbe, y el fallo aparecería
-- en el registro de GoTrue en lugar de aquí.
--
-- Nota 1: SIN POLÍTICAS RLS todavía. La plantilla T4 necesita
--         core.tenant_memberships, que llega en 0011. Se habilita RLS + FORCE
--         desde ya: sin políticas, ningún rol de aplicación alcanza la tabla.
--         Es fail-secure, no un hueco. `postgres` la alcanza por BYPASSRLS,
--         que es lo que permite sembrarla.
-- Nota 2: NO se engancha prevent_tenant_change(): la tabla no tiene tenant_id
--         y el trigger fallaría en tiempo de ejecución.
-- Nota 3: sin failed_login_attempts ni locked_until. Supabase Auth es el dueño
--         de la autenticación; mantener un segundo estado de bloqueo crearía
--         dos fuentes de verdad. Reclasificado a hardening por DEC-09.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE core.users (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id    UUID         NOT NULL,
    email      VARCHAR(320) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name  VARCHAR(100) NOT NULL,
    avatar_file_id UUID,
    locale     VARCHAR(10)  NOT NULL DEFAULT 'es',
    timezone   VARCHAR(50)  NOT NULL DEFAULT 'UTC',
    status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
    settings   JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by UUID,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by UUID,
    version    INT          NOT NULL DEFAULT 1,
    deleted_at TIMESTAMPTZ,

    CONSTRAINT uq_users_auth_id UNIQUE (auth_id),
    CONSTRAINT chk_users_status  CHECK (status IN ('pending','active','inactive','suspended')),
    CONSTRAINT chk_users_version CHECK (version >= 1),
    CONSTRAINT chk_users_email   CHECK (email = lower(email) AND email LIKE '%_@_%.__%'),
    CONSTRAINT chk_users_names   CHECK (length(btrim(first_name)) >= 1 AND length(btrim(last_name)) >= 1),
    CONSTRAINT chk_users_locale  CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
    CONSTRAINT chk_users_settings_object CHECK (jsonb_typeof(settings) = 'object')
);

-- Unicidad GLOBAL de email, coherente con auth.users. Parcial para que el soft
-- delete libere la dirección.
CREATE UNIQUE INDEX uq_users_email ON core.users (email) WHERE deleted_at IS NULL;

-- Índice crítico: lo consumen el Custom Access Token Hook y
-- core.current_user_id(), que resuelven por auth_id sin conocer el tenant.
CREATE INDEX idx_users_auth_id ON core.users (auth_id);

COMMENT ON TABLE core.users IS
    'Identidad GLOBAL de plataforma. SIN tenant_id: la pertenencia vive en core.tenant_memberships (DEC-04).';
COMMENT ON COLUMN core.users.auth_id IS
    'Corresponde 1:1 con auth.users.id (claim sub). NO es lo mismo que core.users.id.';
COMMENT ON COLUMN core.users.email IS
    'Unico GLOBALMENTE entre filas vivas, coherente con la unicidad que impone Supabase Auth.';


CREATE TRIGGER set_updated_at_users
    BEFORE UPDATE ON core.users
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS habilitado SIN políticas: fail-secure hasta 0011 ───────────────────
ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.users FORCE  ROW LEVEL SECURITY;


-- ── Verificación estructural ───────────────────────────────────────────────
DO $$
DECLARE v_force boolean; v_pol int; v_tid int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='users';
    SELECT count(1) INTO v_pol FROM pg_policies WHERE schemaname='core' AND tablename='users';
    SELECT count(1) INTO v_tid FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='users' AND a.attname='tenant_id'
       AND a.attnum > 0 AND NOT a.attisdropped;

    IF NOT v_force THEN RAISE EXCEPTION 'core.users sin FORCE RLS'; END IF;
    IF v_pol <> 0  THEN RAISE EXCEPTION 'core.users tiene % politicas, se esperaban 0 hasta 0011', v_pol; END IF;
    IF v_tid <> 0  THEN RAISE EXCEPTION 'core.users NO debe tener columna tenant_id (DEC-04)'; END IF;
END
$$;
