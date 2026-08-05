-- ROLLBACK de 0072 · Devuelve `core.users` a «solo tu propia fila».
--
-- Consecuencia concreta si se ejecuta: `PATCH /v1/admin/users/{id}` vuelve a responder
-- 404 sobre usuarios que existen y que la pantalla lista, porque el UPDATE afecta a cero
-- filas. No es un error del endpoint: es RLS, y desde fuera no se distingue.
DROP POLICY IF EXISTS users_tenant_update ON core.users;
DROP POLICY IF EXISTS user_visibility ON core.users;

CREATE POLICY user_visibility ON core.users
    AS RESTRICTIVE FOR ALL
    USING (
        core.current_user_id() IS NOT NULL
        AND (
            id = core.current_user_id()
            OR EXISTS (
                SELECT 1 FROM core.tenant_memberships m
                 WHERE m.user_id = users.id
                   AND m.tenant_id = core.current_tenant_id()
                   AND m.revoked_at IS NULL))
    )
    WITH CHECK (id = core.current_user_id());
