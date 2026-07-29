-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0011_create_tenant_memberships.sql
-- Crea      : core.tenant_memberships + RLS T6 + la restricción que disuelve DEC-14
-- Por qué   : eslabón N:N entre identidad y tenant. Ancla TODA la autorización:
--             las FK compuestas de role_assignments y user_warehouse_access
--             apuntarán aquí, de modo que sea imposible asignar un rol o un
--             almacén a quien no es miembro del tenant.
-- Depende de: 0007 (core.tenants), 0010 (core.users)
-- Rollback  : supabase/rollbacks/0011_create_tenant_memberships.down.sql
-- Riesgo    : ALTO
--
-- ⚠ DOS DECISIONES DE DISEÑO QUE NO SON OBVIAS
--
-- 1) UNIQUE (tenant_id, user_id) es TOTAL, no parcial.
--    PostgreSQL no admite índices parciales como destino de clave foránea, y
--    esta tabla lo es. Consecuencia deliberada: hay UNA fila por par
--    (tenant, usuario), y reincorporar a alguien pone revoked_at a NULL en la
--    misma fila. El historial de entradas y salidas vive en audit.events, que
--    es su sitio.
--
-- 2) uq_membership_one_active_per_user limita a UNA membresía activa por
--    usuario. Es lo que DISUELVE DEC-14 en lugar de aplazarlo: con una sola
--    membresía activa, «cuál es el tenant activo» no tiene ambigüedad posible,
--    así que el Hook lo resuelve sin necesidad de core.users.active_tenant_id,
--    sin endpoint de cambio de tenant y sin estado extra en el frontend.
--
--    La etapa 2 —multi-tenant real— es aditiva: DROP INDEX, una columna
--    active_tenant_id y un endpoint. NINGUNA política RLS cambia.
--
-- Nota: RLS plantilla T6. Su política NO invoca can_access_warehouse() ni
--       accessible_warehouse_ids(): esas funciones leerán
--       core.user_warehouse_access, y esta tabla es parte de la cadena de
--       autorización. Referenciarlas sería recursión.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE core.tenant_memberships (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES core.tenants(id),
    user_id     UUID        NOT NULL REFERENCES core.users(id),
    status      VARCHAR(20) NOT NULL DEFAULT 'invited',
    is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
    invited_by  UUID,
    joined_at   TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID,
    version     INT         NOT NULL DEFAULT 1,

    -- Destinos de FK compuesta (0014 los usará)
    CONSTRAINT uq_membership_tenant_user UNIQUE (tenant_id, user_id),
    CONSTRAINT uq_membership_tenant_id   UNIQUE (tenant_id, id),

    CONSTRAINT chk_memb_status  CHECK (status IN ('invited','active','suspended')),
    CONSTRAINT chk_memb_version CHECK (version >= 1),
    CONSTRAINT chk_memb_temporal CHECK (
        revoked_at IS NULL OR joined_at IS NULL OR revoked_at >= joined_at),
    -- Una membresía activa tiene fecha de incorporación
    CONSTRAINT chk_memb_active_joined CHECK (status <> 'active' OR joined_at IS NOT NULL)
);

-- ETAPA 1: una sola membresía activa por usuario. Esto disuelve DEC-14.
CREATE UNIQUE INDEX uq_membership_one_active_per_user
    ON core.tenant_memberships (user_id)
    WHERE revoked_at IS NULL AND status = 'active';

-- Un solo tenant por defecto por usuario
CREATE UNIQUE INDEX uq_membership_one_default
    ON core.tenant_memberships (user_id)
    WHERE is_default AND revoked_at IS NULL;

-- Índice que consumirá el Custom Access Token Hook: filtra por user_id SIN
-- conocer todavía el tenant, así que un índice que empiece por tenant_id no
-- le sirve.
CREATE INDEX idx_memb_user ON core.tenant_memberships (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_memb_tenant ON core.tenant_memberships (tenant_id, user_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE core.tenant_memberships IS
    'Pertenencia N:N de una identidad a un tenant. Ancla toda la autorizacion via FK compuesta.';
COMMENT ON INDEX core.uq_membership_one_active_per_user IS
    'ETAPA 1 de DEC-04: una sola membresia activa por usuario. Disuelve DEC-14. Se elimina al habilitar multi-tenant.';


CREATE TRIGGER set_updated_at_memb
    BEFORE UPDATE ON core.tenant_memberships
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER prevent_tenant_change_memb
    BEFORE UPDATE ON core.tenant_memberships
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();


-- ── RLS · plantilla T6 (read model de autorización) ────────────────────────
ALTER TABLE core.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenant_memberships FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.tenant_memberships
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Solo lectura para roles de aplicación: conceder o revocar una membresía es
-- una operación administrativa que pasa por el backend con privilegio.
CREATE POLICY membership_read ON core.tenant_memberships
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id());


-- ── Verificación estructural ───────────────────────────────────────────────
DO $$
DECLARE v_force boolean; v_pol int; v_idx int; v_uq int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='core' AND c.relname='tenant_memberships';
    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname='core' AND tablename='tenant_memberships';
    SELECT count(1) INTO v_idx FROM pg_indexes
     WHERE schemaname='core' AND indexname='uq_membership_one_active_per_user';
    -- Los dos UNIQUE totales deben existir como constraint, no solo como indice
    SELECT count(1) INTO v_uq FROM pg_constraint
     WHERE conname IN ('uq_membership_tenant_user','uq_membership_tenant_id') AND contype='u';

    IF NOT v_force THEN RAISE EXCEPTION 'tenant_memberships sin FORCE RLS'; END IF;
    IF v_pol <> 2  THEN RAISE EXCEPTION 'tenant_memberships: % politicas, se esperaban 2', v_pol; END IF;
    IF v_idx <> 1  THEN RAISE EXCEPTION 'falta uq_membership_one_active_per_user (etapa 1 de DEC-04)'; END IF;
    IF v_uq  <> 2  THEN RAISE EXCEPTION 'faltan los UNIQUE destino de FK compuesta (% de 2)', v_uq; END IF;
END
$$;
