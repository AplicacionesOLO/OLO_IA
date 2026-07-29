-- Rollback de 0017_fix_users_bootstrap_policy.sql
-- Restituye la politica tal como la dejo 0015. ATENCION: esa version tiene la
-- dependencia circular de arranque que 0017 corrige, asi que revertir vuelve a
-- romper la lectura de core.users desde el backend.
DROP POLICY IF EXISTS users_read ON core.users;
CREATE POLICY users_read ON core.users
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (core.current_user_id() IS NOT NULL);