-- ═══════════════════════════════════════════════════════════════════════════
-- 0018_fix_current_auth_id_definer.sql
-- Corrige   : core.current_auth_id() pasa a SECURITY DEFINER
-- Depende de: 0004
-- Riesgo    : medio
--
-- ⚠ DEFECTO DETECTADO EJECUTANDO EL VERTICAL. Síntoma:
--       permission denied for schema auth
--
--   `core.current_auth_id()` llama a `auth.uid()`. El schema `auth` lo posee
--   `supabase_admin` y `olo_app` NO tiene USAGE sobre él. Sin SECURITY DEFINER,
--   la función se ejecuta con los privilegios del invocante, así que cualquier
--   consulta de `olo_app` que la invoque DIRECTAMENTE falla con 42501.
--
--   Por qué no se detectó antes: las funciones que ya eran SECURITY DEFINER
--   —`has_active_membership()`, `current_user_id()`— la llamaban desde dentro, y
--   ahí se ejecutaba con los privilegios del definer. Solo falló cuando una
--   consulta del backend la invocó directamente, en la resolución de permisos.
--
--   La alternativa —`GRANT USAGE ON SCHEMA auth TO olo_app`— **no es posible**:
--   `postgres` no es dueño de `auth` ni tiene GRANT OPTION sobre él. Se probó y
--   el GRANT no surte efecto (has_schema_privilege sigue devolviendo false).
--
-- Seguridad: la función solo lee ajustes de sesión y `auth.uid()`. No accede a
-- datos de negocio, no recibe parámetros y `search_path` está fijado, así que
-- SECURITY DEFINER no amplía nada explotable.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.current_auth_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        auth.uid(),
        NULLIF(current_setting('app.auth_user_id', true), '')::uuid
    )
$$;

COMMENT ON FUNCTION core.current_auth_id() IS
    'Identidad externa. SECURITY DEFINER: olo_app no tiene USAGE sobre el schema auth y no se le puede conceder.';

DO $$
BEGIN
    IF NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'core' AND p.proname = 'current_auth_id') THEN
        RAISE EXCEPTION 'current_auth_id debe ser SECURITY DEFINER';
    END IF;
END
$$;
