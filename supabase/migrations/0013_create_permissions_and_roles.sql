-- ═══════════════════════════════════════════════════════════════════════════
-- 0013_create_permissions_and_roles.sql
-- Crea      : core.permissions (catálogo + semilla), core.roles,
--             core.role_permissions, core.prevent_role_cycle()
-- Depende de: 0007 (tenants)
-- Riesgo    : medio
--
-- Por qué `permissions` es CATÁLOGO y no un CHECK: tiene atributos propios
-- (module, action, is_privileged) y da integridad referencial a lo que de otro
-- modo sería texto libre en JSONB. Un permiso mal escrito en JSONB no falla
-- nunca; con FK falla al escribir. Además la matriz de permisos de la UI es una
-- consulta relacional, no un escaneo de JSONB.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── core.permissions · catálogo global ─────────────────────────────────────
CREATE TABLE core.permissions (
    code          VARCHAR(64)  PRIMARY KEY,
    module        VARCHAR(30)  NOT NULL,
    action        VARCHAR(30)  NOT NULL,
    description   TEXT         NOT NULL,
    is_privileged BOOLEAN      NOT NULL DEFAULT FALSE,

    CONSTRAINT chk_perm_code   CHECK (code = module || ':' || action),
    CONSTRAINT chk_perm_format CHECK (code ~ '^[a-z_]+:[a-z_]+$')
);

CREATE INDEX idx_perm_module ON core.permissions (module);

COMMENT ON TABLE core.permissions IS
    'Catalogo de permisos module:action. Da FK contra lo que seria texto libre.';
COMMENT ON COLUMN core.permissions.is_privileged IS
    'Permiso sensible: su concesion debe auditarse con especial atencion.';

-- El CHECK chk_perm_code garantiza que `code` sea siempre module:action, así
-- que no puede haber divergencia entre las tres columnas.
INSERT INTO core.permissions (code, module, action, description, is_privileged) VALUES
    ('dashboard:read',      'dashboard',  'read',    'Ver el dashboard',                          false),
    ('companies:read',      'companies',  'read',    'Ver companias',                             false),
    ('companies:create',    'companies',  'create',  'Crear companias',                           false),
    ('companies:update',    'companies',  'update',  'Editar companias',                          false),
    ('companies:delete',    'companies',  'delete',  'Desactivar companias',                      true),
    ('warehouses:read',     'warehouses', 'read',    'Ver almacenes',                             false),
    ('warehouses:create',   'warehouses', 'create',  'Crear almacenes',                           false),
    ('warehouses:update',   'warehouses', 'update',  'Editar almacenes',                          false),
    ('warehouses:delete',   'warehouses', 'delete',  'Desactivar almacenes',                      true),
    ('areas:read',          'areas',      'read',    'Ver areas',                                 false),
    ('areas:write',         'areas',      'write',   'Crear y editar areas',                      false),
    ('locations:read',      'locations',  'read',    'Ver ubicaciones',                           false),
    ('locations:write',     'locations',  'write',   'Crear y editar ubicaciones',                false),
    ('users:read',          'users',      'read',    'Ver usuarios del tenant',                   false),
    ('users:invite',        'users',      'invite',  'Invitar usuarios',                          true),
    ('users:update',        'users',      'update',  'Editar usuarios',                           true),
    ('roles:read',          'roles',      'read',    'Ver roles',                                 false),
    ('roles:write',         'roles',      'write',   'Crear y editar roles',                      true),
    ('roles:assign',        'roles',      'assign',  'Asignar roles a usuarios',                  true),
    ('inventory:read',      'inventory',  'read',    'Ver inventario',                            false),
    ('inventory:write',     'inventory',  'write',   'Registrar movimientos de inventario',       false),
    ('inventory:count',     'inventory',  'count',   'Ejecutar conteos',                          false),
    ('inventory:adjust',    'inventory',  'adjust',  'Crear ajustes de inventario',               false),
    ('inventory:approve',   'inventory',  'approve', 'Aprobar ajustes de inventario',             true),
    ('products:read',       'products',   'read',    'Ver catalogo de productos',                 false),
    ('products:write',      'products',   'write',   'Crear y editar productos',                  false),
    ('reports:read',        'reports',    'read',    'Ver reportes',                              false),
    ('audit:read',          'audit',      'read',    'Consultar auditoria',                       true),
    ('settings:read',       'settings',   'read',    'Ver configuracion del tenant',              false),
    ('settings:update',     'settings',   'update',  'Editar configuracion del tenant',           true)
ON CONFLICT (code) DO NOTHING;

-- Catálogo de solo lectura (plantilla T1)
REVOKE ALL ON TABLE core.permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE core.permissions TO authenticated, olo_app;

ALTER TABLE core.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_read ON core.permissions
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);


-- ── core.roles ─────────────────────────────────────────────────────────────
-- tenant_id NULL = rol de sistema, visible para todos los tenants.
CREATE TABLE core.roles (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         REFERENCES core.tenants(id),
    name           VARCHAR(100) NOT NULL,
    description    TEXT,
    is_system      BOOLEAN      NOT NULL DEFAULT FALSE,
    parent_role_id UUID         REFERENCES core.roles(id),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by     UUID,
    version        INT          NOT NULL DEFAULT 1,
    deleted_at     TIMESTAMPTZ,

    CONSTRAINT chk_roles_version CHECK (version >= 1),
    CONSTRAINT chk_roles_name    CHECK (name ~ '^[a-z][a-z0-9_]*$'),
    -- Un rol de sistema NO pertenece a ningún tenant, y viceversa
    CONSTRAINT chk_roles_system  CHECK (is_system = (tenant_id IS NULL)),
    CONSTRAINT chk_roles_no_self CHECK (parent_role_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX uq_roles_tenant_name ON core.roles (tenant_id, name)
    WHERE tenant_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_roles_system_name ON core.roles (name)
    WHERE tenant_id IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_roles_tenant ON core.roles (tenant_id);
CREATE INDEX idx_roles_parent ON core.roles (parent_role_id) WHERE parent_role_id IS NOT NULL;

-- Prevención de ciclos: un CHECK no puede recorrer un grafo.
CREATE OR REPLACE FUNCTION core.prevent_role_cycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_cursor uuid := NEW.parent_role_id; v_depth int := 0;
BEGIN
    WHILE v_cursor IS NOT NULL LOOP
        IF v_cursor = NEW.id THEN
            RAISE EXCEPTION 'herencia circular de roles detectada en %', NEW.id
                USING ERRCODE = '23514';
        END IF;
        v_depth := v_depth + 1;
        IF v_depth > 16 THEN
            RAISE EXCEPTION 'la cadena de herencia de roles excede la profundidad maxima de 16'
                USING ERRCODE = '23514';
        END IF;
        SELECT parent_role_id INTO v_cursor FROM core.roles WHERE id = v_cursor;
    END LOOP;
    RETURN NEW;
END; $$;

CREATE TRIGGER prevent_role_cycle_roles BEFORE INSERT OR UPDATE ON core.roles
    FOR EACH ROW EXECUTE FUNCTION core.prevent_role_cycle();
CREATE TRIGGER set_updated_at_roles BEFORE UPDATE ON core.roles
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
-- prevent_tenant_change NO se engancha: tenant_id es NULLable aquí (roles de
-- sistema) y convertir un rol de sistema en rol de tenant, o al revés, es una
-- operación de plataforma legítima.

ALTER TABLE core.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.roles FORCE  ROW LEVEL SECURITY;

-- Restrictiva que admite el NULL de los roles de sistema
CREATE POLICY tenant_isolation ON core.roles
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id IS NULL OR tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());   -- no se crean roles de sistema

CREATE POLICY roles_read ON core.roles
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id IS NULL OR tenant_id = core.current_tenant_id());

CREATE POLICY roles_write ON core.roles
    AS PERMISSIVE FOR ALL TO olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());


-- ── core.role_permissions ──────────────────────────────────────────────────
CREATE TABLE core.role_permissions (
    role_id         UUID        NOT NULL REFERENCES core.roles(id) ON DELETE CASCADE,
    permission_code VARCHAR(64) NOT NULL REFERENCES core.permissions(code),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,

    PRIMARY KEY (role_id, permission_code)
);

CREATE INDEX idx_rp_permission ON core.role_permissions (permission_code);

COMMENT ON TABLE core.role_permissions IS
    'N:N rol-permiso. Sustituye a roles.permissions JSONB. ON DELETE CASCADE: si el rol muere, sus concesiones tambien.';

ALTER TABLE core.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.role_permissions FORCE  ROW LEVEL SECURITY;

-- No tiene tenant_id: hereda el aislamiento del rol al que pertenece.
CREATE POLICY rp_isolation ON core.role_permissions
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (EXISTS (
        SELECT 1 FROM core.roles r WHERE r.id = role_permissions.role_id
          AND (r.tenant_id IS NULL OR r.tenant_id = core.current_tenant_id())))
    WITH CHECK (EXISTS (
        SELECT 1 FROM core.roles r WHERE r.id = role_permissions.role_id
          AND r.tenant_id = core.current_tenant_id()));

CREATE POLICY rp_read ON core.role_permissions
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);

CREATE POLICY rp_write ON core.role_permissions
    AS PERMISSIVE FOR ALL TO olo_app USING (true) WITH CHECK (true);


-- ── Roles de sistema con sus permisos ──────────────────────────────────────
-- Son datos de plataforma, no de negocio: definen el vocabulario de
-- autorización que el producto ofrece, igual que el catálogo de permisos.
INSERT INTO core.roles (id, tenant_id, name, description, is_system) VALUES
    ('00000000-0000-0000-0000-0000000000a1', NULL, 'tenant_admin',
     'Administrador del tenant: acceso total dentro de su organizacion', true),
    ('00000000-0000-0000-0000-0000000000a2', NULL, 'warehouse_manager',
     'Gestion completa de los almacenes asignados', true),
    ('00000000-0000-0000-0000-0000000000a3', NULL, 'warehouse_operator',
     'Operacion diaria en los almacenes asignados', true),
    ('00000000-0000-0000-0000-0000000000a4', NULL, 'auditor',
     'Solo lectura, incluida la auditoria', true),
    ('00000000-0000-0000-0000-0000000000a5', NULL, 'viewer',
     'Solo lectura limitada', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-0000000000a1', code FROM core.permissions
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-0000000000a2', code FROM core.permissions
 WHERE code IN ('dashboard:read','warehouses:read','warehouses:update',
                'areas:read','areas:write','locations:read','locations:write',
                'inventory:read','inventory:write','inventory:count','inventory:adjust',
                'inventory:approve','products:read','products:write','reports:read','users:read')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-0000000000a3', code FROM core.permissions
 WHERE code IN ('dashboard:read','warehouses:read','areas:read','locations:read',
                'inventory:read','inventory:write','inventory:count','products:read')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-0000000000a4', code FROM core.permissions
 WHERE action = 'read'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT '00000000-0000-0000-0000-0000000000a5', code FROM core.permissions
 WHERE code IN ('dashboard:read','warehouses:read','areas:read','locations:read',
                'inventory:read','products:read')
ON CONFLICT DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_perm int; v_roles int; v_rp int;
BEGIN
    SELECT count(1) INTO v_perm  FROM core.permissions;
    SELECT count(1) INTO v_roles FROM core.roles WHERE is_system;
    SELECT count(1) INTO v_rp    FROM core.role_permissions;
    IF v_perm  < 30 THEN RAISE EXCEPTION 'catalogo de permisos incompleto: %', v_perm; END IF;
    IF v_roles <> 5 THEN RAISE EXCEPTION 'roles de sistema: % de 5', v_roles; END IF;
    IF v_rp    < 60 THEN RAISE EXCEPTION 'concesiones rol-permiso insuficientes: %', v_rp; END IF;
    -- tenant_admin debe tener TODOS los permisos
    IF (SELECT count(1) FROM core.role_permissions
         WHERE role_id='00000000-0000-0000-0000-0000000000a1') <> v_perm THEN
        RAISE EXCEPTION 'tenant_admin no tiene todos los permisos';
    END IF;
END
$$;
