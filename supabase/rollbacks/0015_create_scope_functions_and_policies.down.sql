-- Rollback de 0015_create_scope_functions_and_policies.sql
-- Primero las politicas que dependen de las funciones, luego las funciones.
-- SIN CASCADE en los DROP FUNCTION: si una politica de una migracion posterior
-- las usara, el DROP falla a proposito. Con CASCADE se eliminarian esas
-- politicas y las tablas quedarian sin aislamiento por almacen.
DROP POLICY IF EXISTS warehouse_scope  ON core.locations;
DROP POLICY IF EXISTS tenant_isolation ON core.locations;
DROP POLICY IF EXISTS warehouse_scope  ON core.areas;
DROP POLICY IF EXISTS tenant_isolation ON core.areas;
DROP POLICY IF EXISTS warehouse_scope  ON core.warehouses;
DROP POLICY IF EXISTS tenant_isolation ON core.warehouses;

DROP POLICY IF EXISTS users_self_update ON core.users;
DROP POLICY IF EXISTS users_read        ON core.users;
DROP POLICY IF EXISTS user_visibility   ON core.users;

-- Restituye la politica T2 de tenants tal como la dejo 0007 (sin la puerta de
-- membresia, que es lo que esta migracion habia anadido).
DROP POLICY IF EXISTS tenant_self ON core.tenants;
CREATE POLICY tenant_self ON core.tenants
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (id = core.current_tenant_id());

DROP FUNCTION IF EXISTS core.can_access_warehouse(uuid);
DROP FUNCTION IF EXISTS core.accessible_warehouse_ids();
DROP FUNCTION IF EXISTS core.has_active_membership();
DROP FUNCTION IF EXISTS core.current_user_id();