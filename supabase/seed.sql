-- ═══════════════════════════════════════════════════════════════════════════
-- seed.sql — datos de DESARROLLO
--
-- NO es una migración: los datos de negocio no se versionan como esquema. Se
-- ejecuta a mano contra el proyecto de desarrollo y es idempotente.
--
-- Crea el escenario mínimo para validar el vertical de extremo a extremo:
--   1 tenant · 1 país operativo · 1 compañía · 2 almacenes · 1 área · 2 ubicaciones
--   1 usuario con rol warehouse_manager y acceso SOLO al almacén WH-001
--
-- El segundo almacén existe a propósito y el usuario NO tiene acceso: es lo que
-- permite comprobar que RLS filtra de verdad en lugar de devolverlo todo.
--
-- Requisito previo: el usuario debe existir ya en auth.users. Se crea con la
-- Admin API de Supabase Auth, no desde SQL.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_auth_id  uuid := 'b0ab1526-6ec8-4103-8212-2855a509c788';
    v_country  uuid;
    v_tenant   uuid;
    v_tc       uuid;
    v_company  uuid;
    v_wh1      uuid;
    v_wh2      uuid;
    v_site     uuid;
    v_node     uuid;
    v_user     uuid;
    v_ra       uuid;
BEGIN
    SELECT id INTO v_country FROM public.countries WHERE iso_code = 'CR';

    -- Tenant
    INSERT INTO core.tenants (name, slug, status, plan)
    VALUES ('OLO Logistics Demo', 'olo-demo', 'active', 'professional')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_tenant;

    -- País operativo
    INSERT INTO core.tenant_countries
        (tenant_id, country_id, default_currency_code, default_timezone, default_locale)
    VALUES (v_tenant, v_country, 'CRC', 'America/Costa_Rica', 'es')
    ON CONFLICT (tenant_id, country_id) WHERE deleted_at IS NULL
    DO UPDATE SET default_timezone = EXCLUDED.default_timezone
    RETURNING id INTO v_tc;

    -- Compañía
    SELECT id INTO v_company FROM core.companies
     WHERE tenant_id = v_tenant AND name = 'OLO Costa Rica SA' AND deleted_at IS NULL;
    IF v_company IS NULL THEN
        INSERT INTO core.companies (tenant_id, tenant_country_id, name, legal_name, tax_id)
        VALUES (v_tenant, v_tc, 'OLO Costa Rica SA', 'OLO Logistics Costa Rica SA', '3-101-000001')
        RETURNING id INTO v_company;
    END IF;

    -- Dos almacenes. El usuario solo tendrá acceso al primero.
    SELECT id INTO v_wh1 FROM core.warehouses
     WHERE tenant_id = v_tenant AND code = 'WH-001' AND deleted_at IS NULL;
    IF v_wh1 IS NULL THEN
        INSERT INTO core.warehouses
            (tenant_id, company_id, name, code, timezone, locale, currency_code,
             latitude, longitude, address)
        VALUES (v_tenant, v_company, 'Centro de Distribución San José', 'WH-001',
                'America/Costa_Rica', 'es', 'CRC', 9.9281, -84.0907,
                '{"city":"San José","country":"CR"}'::jsonb)
        RETURNING id INTO v_wh1;
    END IF;

    SELECT id INTO v_wh2 FROM core.warehouses
     WHERE tenant_id = v_tenant AND code = 'WH-002' AND deleted_at IS NULL;
    IF v_wh2 IS NULL THEN
        INSERT INTO core.warehouses
            (tenant_id, company_id, name, code, timezone, currency_code)
        VALUES (v_tenant, v_company, 'Bodega Alajuela', 'WH-002',
                'America/Costa_Rica', 'CRC')
        RETURNING id INTO v_wh2;
    END IF;

    -- Sitio, nodo y ubicaciones en el almacén accesible.
    --
    -- La jerarquía es `core.warehouses → spatial.sites → spatial.nodes →
    -- spatial.locations` desde las migraciones 0048-0051. Ya no existe una tabla de
    -- áreas: un área es un nodo de tipo `storage_area` con función `storage`.
    SELECT id INTO v_site FROM spatial.sites
     WHERE tenant_id = v_tenant AND warehouse_id = v_wh1 AND code = 'DEFAULT'
       AND deleted_at IS NULL;
    IF v_site IS NULL THEN
        INSERT INTO spatial.sites (tenant_id, warehouse_id, name, code, is_validated)
        VALUES (v_tenant, v_wh1, 'Sitio unico (sin validar)', 'DEFAULT', false)
        RETURNING id INTO v_site;
    END IF;

    SELECT id INTO v_node FROM spatial.nodes
     WHERE tenant_id = v_tenant AND warehouse_id = v_wh1 AND node_code = 'ALM'
       AND deleted_at IS NULL;
    IF v_node IS NULL THEN
        INSERT INTO spatial.nodes (tenant_id, warehouse_id, site_id, node_type,
                                   node_function, node_code, name)
        VALUES (v_tenant, v_wh1, v_site, 'storage_area', 'storage',
                'ALM', 'Almacenamiento principal')
        RETURNING id INTO v_node;
    END IF;

    -- `logical_level`, no `level`: la migración 0052 la renombró para que la familia
    -- `logical_*` sea reconocible de un vistazo y no se confunda con `world_*`.
    INSERT INTO spatial.locations (tenant_id, warehouse_id, node_id, code, type,
                                   logical_level, max_units)
    SELECT v_tenant, v_wh1, v_node, c, 'rack', 1, 100
    FROM (VALUES ('ALM-01-01'), ('ALM-01-02')) AS t(c)
    WHERE NOT EXISTS (
        SELECT 1 FROM spatial.locations
         WHERE tenant_id = v_tenant AND node_id = v_node AND code = t.c AND deleted_at IS NULL);

    -- Usuario de negocio, ligado a la identidad de auth.users por auth_id
    SELECT id INTO v_user FROM core.users WHERE auth_id = v_auth_id;
    IF v_user IS NULL THEN
        INSERT INTO core.users
            (auth_id, email, first_name, last_name, locale, timezone, status)
        VALUES (v_auth_id, 'mgr@olo-dev.test', 'María', 'Rojas', 'es',
                'America/Costa_Rica', 'active')
        RETURNING id INTO v_user;
    END IF;

    -- Membresía activa: es lo que el Hook busca para emitir tenant_id
    INSERT INTO core.tenant_memberships
        (tenant_id, user_id, status, joined_at, is_default)
    VALUES (v_tenant, v_user, 'active', now(), true)
    ON CONFLICT (tenant_id, user_id)
    DO UPDATE SET status = 'active', revoked_at = NULL, joined_at = COALESCE(core.tenant_memberships.joined_at, now());

    -- Rol warehouse_manager con scope del almacén 1.
    -- NO es tenant_admin a propósito: con tenant_wide_access el filtrado por
    -- almacén no se ejercitaría y la prueba no demostraría nada.
    SELECT id INTO v_ra FROM core.role_assignments
     WHERE tenant_id = v_tenant AND user_id = v_user
       AND role_id = '00000000-0000-0000-0000-0000000000a2'
       AND scope_type = 'warehouse' AND scope_warehouse_id = v_wh1;
    IF v_ra IS NULL THEN
        INSERT INTO core.role_assignments
            (tenant_id, user_id, role_id, scope_type, scope_warehouse_id)
        VALUES (v_tenant, v_user, '00000000-0000-0000-0000-0000000000a2', 'warehouse', v_wh1)
        RETURNING id INTO v_ra;
    END IF;

    -- Proyección de acceso a almacenes. Hasta que exista el servicio de
    -- autorización que la mantiene, se rellena aquí.
    INSERT INTO core.user_warehouse_access
        (tenant_id, user_id, warehouse_id, source_role_assignment_id)
    VALUES (v_tenant, v_user, v_wh1, v_ra)
    ON CONFLICT (tenant_id, user_id, warehouse_id) WHERE revoked_at IS NULL
    DO NOTHING;

    RAISE NOTICE 'seed: tenant=% usuario=% wh_accesible=% wh_sin_acceso=%',
        v_tenant, v_user, v_wh1, v_wh2;
END
$$;

-- Resumen del escenario sembrado
SELECT t.slug           AS tenant,
       u.email          AS usuario,
       r.name           AS rol,
       w.code           AS almacen_con_acceso,
       (SELECT count(1) FROM core.warehouses w2
         WHERE w2.tenant_id = t.id AND w2.deleted_at IS NULL) AS almacenes_totales
FROM core.tenants t
JOIN core.tenant_memberships m ON m.tenant_id = t.id
JOIN core.users u              ON u.id = m.user_id
JOIN core.role_assignments ra  ON ra.tenant_id = t.id AND ra.user_id = u.id
JOIN core.roles r              ON r.id = ra.role_id
JOIN core.warehouses w         ON w.id = ra.scope_warehouse_id
WHERE t.slug = 'olo-demo';
