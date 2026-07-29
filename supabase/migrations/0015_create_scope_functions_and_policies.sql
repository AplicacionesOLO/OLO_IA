-- ═══════════════════════════════════════════════════════════════════════════
-- 0015_create_scope_functions_and_policies.sql
-- Crea      : core.current_user_id(), core.has_active_membership(),
--             core.accessible_warehouse_ids(), core.can_access_warehouse()
--             + políticas T3 de la jerarquía
--             + política T4 de core.users
--             + completa la T2 de core.tenants (deuda de 0007)
-- Depende de: 0010 (users), 0011 (memberships), 0012 (jerarquía), 0014 (uwa)
-- Riesgo    : ALTO — activa el aislamiento por almacén en todo el sistema
--
-- Por qué estas tres funciones SÍ son SECURITY DEFINER y las de 0004 no:
-- deben leer tablas cuya propia política RLS las invocaría de vuelta. Al
-- ejecutarse con los privilegios del propietario (postgres, que tiene
-- BYPASSRLS) rompen ese ciclo. Su seguridad NO viene del rol: viene de que
-- filtran internamente por el contexto actual. Un filtro mal escrito aquí
-- expone datos de otros tenants, así que cada uno lleva su justificación.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Identidad de negocio ────────────────────────────────────────────────
-- Resuelve core.users.id desde auth_id (CONF-06: el JWT NO lleva users.id).
-- SECURITY DEFINER porque la política T4 de core.users invoca esta función:
-- sin ello, cada evaluación se llamaría a sí misma.
CREATE OR REPLACE FUNCTION core.current_user_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT u.id
    FROM core.users u
    WHERE u.auth_id = core.current_auth_id()
      AND u.deleted_at IS NULL
$$;

COMMENT ON FUNCTION core.current_user_id() IS
    'core.users.id resuelto por auth_id. SECURITY DEFINER para romper la recursion con la politica T4 de core.users.';

-- ── 2. Puerta de fail-secure ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.has_active_membership()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM core.tenant_memberships m
        WHERE m.tenant_id  = core.current_tenant_id()
          AND m.user_id    = core.current_user_id()
          AND m.revoked_at IS NULL
          AND m.status     = 'active'
    )
$$;

COMMENT ON FUNCTION core.has_active_membership() IS
    'Sin membresia activa no hay acceso a nada. Puerta de fail-secure de todas las politicas permisivas.';

-- ── 3. Almacenes accesibles ────────────────────────────────────────────────
-- Se leen de la BASE, no del JWT: revocacion inmediata y sin bloat de token.
-- COALESCE garantiza array vacio y NUNCA NULL: con NULL, `x = ANY(NULL)` es
-- NULL y la politica quedaria indefinida en lugar de denegar.
CREATE OR REPLACE FUNCTION core.accessible_warehouse_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT COALESCE(array_agg(uwa.warehouse_id), ARRAY[]::uuid[])
    FROM core.user_warehouse_access uwa
    WHERE uwa.tenant_id  = core.current_tenant_id()
      AND uwa.user_id    = core.current_user_id()
      AND uwa.revoked_at IS NULL
$$;

COMMENT ON FUNCTION core.accessible_warehouse_ids() IS
    'Almacenes del usuario, leidos de la BD. Nunca devuelve NULL: array vacio si no tiene ninguno.';

-- ── 4. Predicado único de scope de almacén ─────────────────────────────────
-- Tener la lógica en un solo sitio es lo que evita que 16 tablas divergan.
-- NO es SECURITY DEFINER: solo compone las anteriores.
CREATE OR REPLACE FUNCTION core.can_access_warehouse(p_warehouse_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
    SELECT core.current_tenant_id() IS NOT NULL
       AND core.has_active_membership()
       AND (
            core.has_tenant_wide_access()
         OR p_warehouse_id = ANY (core.accessible_warehouse_ids())
       )
$$;

COMMENT ON FUNCTION core.can_access_warehouse(uuid) IS
    'Predicado unico de las politicas T3. Cero almacenes asignados => cero acceso, nunca acceso total.';


-- ── 5. Políticas T3 de la jerarquía ────────────────────────────────────────
-- warehouses: el predicado se evalúa sobre `id` — el almacén ES la fila.
CREATE POLICY tenant_isolation ON core.warehouses
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON core.warehouses
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (core.can_access_warehouse(id))
    WITH CHECK (core.can_access_warehouse(id));

CREATE POLICY tenant_isolation ON core.areas
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON core.areas
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

CREATE POLICY tenant_isolation ON core.locations
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

CREATE POLICY warehouse_scope ON core.locations
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING      (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));


-- ── 6. Política T4 de core.users ───────────────────────────────────────────
-- Única plantilla a medida del modelo: core.users no tiene tenant_id, así que
-- no hay piso de tenant posible. La regla es: veo mi propia fila, y veo a
-- quienes comparten membresía conmigo en el tenant actual.
--
-- El EXISTS lee core.tenant_memberships como el rol invocante, sujeto a la
-- política de esa tabla. No hay recursión porque la política de memberships
-- solo compara tenant_id y no consulta core.users.
CREATE POLICY user_visibility ON core.users
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (
        id = core.current_user_id()
        OR EXISTS (
            SELECT 1 FROM core.tenant_memberships m
            WHERE m.user_id    = core.users.id
              AND m.tenant_id  = core.current_tenant_id()
              AND m.revoked_at IS NULL
        )
    )
    WITH CHECK (id = core.current_user_id());   -- solo edito mi propia fila

CREATE POLICY users_read ON core.users
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (core.current_user_id() IS NOT NULL);

CREATE POLICY users_self_update ON core.users
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app
    USING      (id = core.current_user_id())
    WITH CHECK (id = core.current_user_id());

-- Sin políticas de INSERT ni DELETE: crear o eliminar identidades es operación
-- de plataforma y queda en platform.privileged_operation_log.


-- ── 7. Deuda de 0007: completar la T2 de core.tenants ──────────────────────
-- La política original solo comprobaba el tenant del claim. Ahora que existe
-- has_active_membership() se añade la puerta que exige pertenencia real: un
-- token con un tenant_id válido pero sin membresía activa deja de ver el tenant.
DROP POLICY IF EXISTS tenant_self ON core.tenants;

CREATE POLICY tenant_self ON core.tenants
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (id = core.current_tenant_id() AND core.has_active_membership());


-- ── 8. Verificación ────────────────────────────────────────────────────────
DO $$
DECLARE v_fn int; v_pol int; v_defs int;
BEGIN
    SELECT count(1) INTO v_fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='core' AND p.proname IN
       ('current_user_id','has_active_membership','accessible_warehouse_ids','can_access_warehouse');
    IF v_fn <> 4 THEN RAISE EXCEPTION 'funciones de scope: % de 4', v_fn; END IF;

    -- Las tres que deben ser SECURITY DEFINER, y can_access_warehouse que NO
    SELECT count(1) INTO v_defs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='core' AND p.prosecdef
       AND p.proname IN ('current_user_id','has_active_membership','accessible_warehouse_ids');
    IF v_defs <> 3 THEN RAISE EXCEPTION 'SECURITY DEFINER en % de 3 funciones', v_defs; END IF;

    IF (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='core' AND p.proname='can_access_warehouse') THEN
        RAISE EXCEPTION 'can_access_warehouse no debe ser SECURITY DEFINER';
    END IF;

    -- Toda función de core debe tener search_path fijado
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='core' AND p.prokind='f' AND p.proconfig IS NULL) THEN
        RAISE EXCEPTION 'hay funciones en core sin search_path fijado';
    END IF;

    -- Cada tabla de la jerarquía: 1 restrictiva + 1 permisiva
    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname='core' AND tablename IN ('warehouses','areas','locations');
    IF v_pol <> 6 THEN RAISE EXCEPTION 'politicas de jerarquia: % de 6', v_pol; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname='core' AND tablename='users';
    IF v_pol <> 3 THEN RAISE EXCEPTION 'politicas de core.users: % de 3', v_pol; END IF;
END
$$;
