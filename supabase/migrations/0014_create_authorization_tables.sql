-- ═══════════════════════════════════════════════════════════════════════════
-- 0014_create_authorization_tables.sql
-- Crea      : core.role_assignments, core.user_warehouse_access
-- Depende de: 0011 (memberships), 0012 (jerarquía), 0013 (roles)
-- Riesgo    : ALTO
--
-- ⚠ AQUÍ SE CIERRA LA CADENA DE AUTORIZACIÓN.
--
-- Las FK compuestas (tenant_id, user_id) → core.tenant_memberships hacen
-- IMPOSIBLE asignar un rol o el acceso a un almacén a alguien que no es miembro
-- del tenant. El modelo anterior referenciaba `users` y `roles` por separado y
-- nada impedía cruzarlos.
--
-- Es la misma técnica verificada para la jerarquía de almacenes (V5), aplicada
-- a la jerarquía de autorización:
--     tenant → membership → role_assignment
--     tenant → warehouse   → user_warehouse_access
-- ═══════════════════════════════════════════════════════════════════════════

-- ── core.role_assignments ──────────────────────────────────────────────────
CREATE TABLE core.role_assignments (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID        NOT NULL REFERENCES core.tenants(id),
    user_id            UUID        NOT NULL,
    role_id            UUID        NOT NULL REFERENCES core.roles(id),
    scope_type         VARCHAR(20) NOT NULL DEFAULT 'global',
    scope_company_id   UUID,
    scope_warehouse_id UUID,
    assigned_by        UUID,
    assigned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Solo se asignan roles a MIEMBROS del tenant
    CONSTRAINT fk_ra_membership FOREIGN KEY (tenant_id, user_id)
        REFERENCES core.tenant_memberships (tenant_id, user_id),
    -- El scope debe ser del mismo tenant
    CONSTRAINT fk_ra_company FOREIGN KEY (tenant_id, scope_company_id)
        REFERENCES core.companies (tenant_id, id),
    CONSTRAINT fk_ra_warehouse FOREIGN KEY (tenant_id, scope_warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),

    CONSTRAINT chk_ra_scope_type CHECK (scope_type IN ('global','company','warehouse')),
    -- Coherencia del scope: un scope_type='global' con scope_warehouse_id
    -- relleno es insertable sin esto, y su semántica sería indefinida.
    CONSTRAINT chk_ra_scope_coherent CHECK (
        (scope_type = 'global'    AND scope_company_id IS NULL     AND scope_warehouse_id IS NULL)
     OR (scope_type = 'company'   AND scope_company_id IS NOT NULL AND scope_warehouse_id IS NULL)
     OR (scope_type = 'warehouse' AND scope_warehouse_id IS NOT NULL)
    )
);

-- Una asignación por (usuario, rol, scope). COALESCE porque en un índice único
-- NULL no colisiona con NULL: sin él, el mismo rol global podría asignarse
-- infinitas veces.
CREATE UNIQUE INDEX uq_ra_unique ON core.role_assignments (
    tenant_id, user_id, role_id, scope_type,
    COALESCE(scope_company_id,   '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scope_warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX idx_ra_tenant_user ON core.role_assignments (tenant_id, user_id);
-- Índice sin tenant_id al frente, a propósito: el Custom Access Token Hook
-- filtra por user_id sin conocer todavía el tenant.
CREATE INDEX idx_ra_user_scope  ON core.role_assignments (user_id, scope_type);
CREATE INDEX idx_ra_role        ON core.role_assignments (role_id);
CREATE INDEX idx_ra_scope_wh    ON core.role_assignments (tenant_id, scope_warehouse_id)
    WHERE scope_warehouse_id IS NOT NULL;

COMMENT ON CONSTRAINT fk_ra_membership ON core.role_assignments IS
    'Hace imposible asignar un rol a quien no es miembro del tenant.';

ALTER TABLE core.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.role_assignments FORCE  ROW LEVEL SECURITY;

-- Plantilla T6: solo tenant_id. NO invoca can_access_warehouse() ni
-- accessible_warehouse_ids(): esas funciones leen user_warehouse_access y
-- referenciarlas desde la cadena de autorización sería recursión.
CREATE POLICY tenant_isolation ON core.role_assignments
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY ra_read ON core.role_assignments
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id());

CREATE POLICY ra_write ON core.role_assignments
    AS PERMISSIVE FOR ALL TO olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());


-- ── core.user_warehouse_access · read model ────────────────────────────────
-- Proyección derivada de role_assignments. Existe para que RLS resuelva el
-- scope de almacén con un lookup indexado en lugar de un JOIN sobre roles en
-- cada evaluación de política.
CREATE TABLE core.user_warehouse_access (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID        NOT NULL REFERENCES core.tenants(id),
    user_id                   UUID        NOT NULL,
    warehouse_id              UUID        NOT NULL,
    granted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by                UUID,
    revoked_at                TIMESTAMPTZ,
    source_role_assignment_id UUID        REFERENCES core.role_assignments(id) ON DELETE SET NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_uwa_membership FOREIGN KEY (tenant_id, user_id)
        REFERENCES core.tenant_memberships (tenant_id, user_id),
    CONSTRAINT fk_uwa_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),
    CONSTRAINT chk_uwa_temporal CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- PARCIAL: permite re-otorgar un acceso previamente revocado.
CREATE UNIQUE INDEX uq_uwa_active
    ON core.user_warehouse_access (tenant_id, user_id, warehouse_id)
    WHERE revoked_at IS NULL;

-- Índice que sostiene core.accessible_warehouse_ids(), que se evalúa dentro de
-- las políticas T3 de 16 tablas. Es el índice más caliente del schema.
CREATE INDEX idx_uwa_lookup ON core.user_warehouse_access (tenant_id, user_id)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_uwa_warehouse ON core.user_warehouse_access (tenant_id, warehouse_id)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE core.user_warehouse_access IS
    'Read model de acceso a almacenes, derivado de role_assignments. Lo mantiene el servicio de autorizacion en la misma transaccion.';

CREATE TRIGGER set_updated_at_uwa BEFORE UPDATE ON core.user_warehouse_access
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER prevent_tenant_change_uwa BEFORE UPDATE ON core.user_warehouse_access
    FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();

ALTER TABLE core.user_warehouse_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.user_warehouse_access FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.user_warehouse_access
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY uwa_read ON core.user_warehouse_access
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id());

CREATE POLICY uwa_write ON core.user_warehouse_access
    AS PERMISSIVE FOR ALL TO olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_fk int; v_idx int;
BEGIN
    SELECT count(1) INTO v_fk FROM pg_constraint
     WHERE conname IN ('fk_ra_membership','fk_uwa_membership','fk_ra_company',
                       'fk_ra_warehouse','fk_uwa_warehouse')
       AND array_length(conkey,1) = 2;
    IF v_fk <> 5 THEN RAISE EXCEPTION 'FK compuestas de autorizacion: % de 5', v_fk; END IF;

    SELECT count(1) INTO v_idx FROM pg_indexes
     WHERE schemaname='core' AND indexname IN ('idx_uwa_lookup','uq_uwa_active','uq_ra_unique');
    IF v_idx <> 3 THEN RAISE EXCEPTION 'indices de autorizacion: % de 3', v_idx; END IF;
END
$$;
