-- Rollback de 0018. ATENCION: revertir vuelve a romper la resolucion de
-- permisos desde olo_app (permission denied for schema auth).
CREATE OR REPLACE FUNCTION core.current_auth_id()
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT COALESCE(auth.uid(), NULLIF(current_setting('app.auth_user_id', true), '')::uuid)
$$;