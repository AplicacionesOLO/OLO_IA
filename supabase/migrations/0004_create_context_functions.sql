-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0004_create_context_functions.sql
-- Crea      : core.current_auth_id(), core.current_tenant_id(),
--             core.has_tenant_wide_access()
-- Por qué   : son la base de TODA política RLS del sistema. Ninguna política
--             consulta current_setting() directamente; todas pasan por estas
--             funciones (RLS_IMPLEMENTATION_GUIDE.md §3).
--             Van antes de cualquier tabla con RLS.
-- Depende de: 0001 (schema core)
-- Rollback  : supabase/rollbacks/0004_create_context_functions.down.sql
-- Riesgo    : ALTO — un error aquí afecta a las 19 tablas de Fase 0
--
-- Contrato obligatorio para las tres (y para las cuatro de 0015):
--   • SET search_path = ''  SIEMPRE. Sin esto son vector de escalada y el
--     linter de Supabase las marca como function_search_path_mutable.
--   • STABLE: una evaluación por sentencia, no una por fila. Es lo que hace
--     que su coste dentro de una política sea constante.
--   • LANGUAGE sql: inlineable por el planner.
--   • SIN SECURITY DEFINER: solo leen ajustes de sesión. Las tres que lo
--     necesitan (current_user_id, has_active_membership,
--     accessible_warehouse_ids) llegan en 0015, cuando existan sus tablas.
--
-- Los dos canales (DEC-02):
--   Canal A — PostgREST / Realtime / Storage: el contexto llega en
--             request.jwt.claims, que Supabase puebla por petición.
--   Canal B — backend FastAPI y workers: el contexto llega en GUCs propios
--             (app.auth_user_id, app.tenant_id, app.tenant_wide_access)
--             fijados con set_config(..., true) dentro de transacción.
--   Precedencia verificada: el JWT gana al GUC.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Identidad externa ───────────────────────────────────────────────────
-- Delega en auth.uid() en lugar de leer el claim `sub` a mano: si Supabase
-- cambia cómo expone los claims, la función sigue siendo correcta sin que
-- tengamos que mantenerla. El fallback al GUC cubre el canal B, que es el que
-- usan los tests de aislamiento.
CREATE OR REPLACE FUNCTION core.current_auth_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        auth.uid(),
        NULLIF(current_setting('app.auth_user_id', true), '')::uuid
    )
$$;

COMMENT ON FUNCTION core.current_auth_id() IS
    'Identidad externa (auth.users.id / claim sub). Canal A: auth.uid(). Canal B: GUC app.auth_user_id. NULL si no hay contexto.';


-- ── 2. Tenant activo ───────────────────────────────────────────────────────
-- Lee request.jwt.claims DIRECTAMENTE en lugar de vía auth.jwt(). El
-- comportamiento es idéntico en Supabase, y así la función es portable a un
-- PostgreSQL sin el schema `auth`, lo que permite ejecutar la suite de
-- aislamiento sin levantar el stack completo.
--
-- NULL ⇒ sin contexto ⇒ la política RESTRICTIVE deniega todas las filas.
-- Es el comportamiento fail-secure exigido.
CREATE OR REPLACE FUNCTION core.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        -- Canal A
        NULLIF(
            NULLIF(current_setting('request.jwt.claims', true), '')::jsonb
                -> 'app_metadata' ->> 'tenant_id',
            ''),
        -- Canal B
        NULLIF(current_setting('app.tenant_id', true), '')
    )::uuid
$$;

COMMENT ON FUNCTION core.current_tenant_id() IS
    'Tenant activo. Canal A: claim app_metadata.tenant_id. Canal B: GUC app.tenant_id. El JWT tiene precedencia. NULL ⇒ RLS deniega todo.';


-- ── 3. Acceso amplio al tenant ─────────────────────────────────────────────
-- Booleano EXPLÍCITO con default false. Nunca se infiere de "la lista de
-- almacenes está vacía": esa inferencia convertía a un usuario recién creado
-- sin asignaciones en un usuario con acceso a todo el tenant.
CREATE OR REPLACE FUNCTION core.has_tenant_wide_access()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb
            -> 'app_metadata' ->> 'tenant_wide_access')::boolean,
        NULLIF(current_setting('app.tenant_wide_access', true), '')::boolean,
        false
    )
$$;

COMMENT ON FUNCTION core.has_tenant_wide_access() IS
    'Acceso a todos los almacenes del tenant. Explicito, default false (fail-secure). Nunca se infiere de una lista vacia.';


-- ── 4. Verificación fail-secure ────────────────────────────────────────────
-- Esta migración se ejecuta sin JWT y sin GUCs. Las tres funciones deben
-- devolver el valor "sin contexto". Si alguna devolviera algo distinto, el
-- aislamiento estaría roto desde el primer día.
DO $$
DECLARE
    v_auth   uuid;
    v_tenant uuid;
    v_wide   boolean;
BEGIN
    SELECT core.current_auth_id()        INTO v_auth;
    SELECT core.current_tenant_id()      INTO v_tenant;
    SELECT core.has_tenant_wide_access() INTO v_wide;

    IF v_auth IS NOT NULL THEN
        RAISE EXCEPTION 'current_auth_id() debe ser NULL sin contexto, devolvio %', v_auth;
    END IF;
    IF v_tenant IS NOT NULL THEN
        RAISE EXCEPTION 'current_tenant_id() debe ser NULL sin contexto, devolvio %', v_tenant;
    END IF;
    IF v_wide IS NOT FALSE THEN
        RAISE EXCEPTION 'has_tenant_wide_access() debe ser false sin contexto, devolvio %', v_wide;
    END IF;
END
$$;
