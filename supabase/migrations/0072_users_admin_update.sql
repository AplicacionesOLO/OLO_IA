-- ══════════════════════════════════════════════════════════════════════════════
-- 0072 · Un administrador puede editar a otro usuario
--
-- `PATCH /v1/admin/users/{id}` respondía 404 sobre un usuario que existe y que el
-- resumen de configuración lista. No era el endpoint: era RLS.
--
-- ── QUE HABIA ──────────────────────────────────────────────────────────────
--
-- `core.users` tenía tres políticas:
--
--     users_read         PERMISSIVE  SELECT  true
--     users_self_update  PERMISSIVE  UPDATE  id = core.current_user_id()
--     user_visibility    RESTRICTIVE ALL     USING: propio OR miembro del tenant
--                                            WITH CHECK: id = core.current_user_id()
--
-- O sea: la única política de UPDATE era «solo tu propia fila», y encima la RESTRICTIVE
-- exigía en su `WITH CHECK` que la fila resultante fuera la propia. Dos candados, los
-- dos cerrados para un administrador que edita a un compañero. El UPDATE afectaba a
-- CERO filas y el servicio lo traducía —correctamente— a un 404.
--
-- ── POR QUE ESTO NO ES ABRIR UN AGUJERO ────────────────────────────────────
--
-- Es alinear `core.users` con el patrón que ya siguen TODAS las demás tablas de
-- configuración. Medido:
--
--     core.clients           tenant_isolation (RESTRICTIVE) + tenant_members (ALL)
--     core.companies         idem
--     core.tenant_countries  idem
--
-- En las tres, RLS acota al TENANT y la autoridad sobre quién puede escribir vive en la
-- API: `require("clients:update")`, `require("companies:delete")`. `core.users` era la
-- excepción, y por eso su CRUD no se podía completar sin tocar esto.
--
-- El permiso que manda sigue siendo `users:update`, que es PRIVILEGIADO y solo lo tiene
-- `tenant_admin`. Lo que cambia es que RLS deja de ser un segundo candado incoherente
-- con el resto del esquema.
--
-- Lo que NO se abre:
--
--   · el aislamiento entre tenants sigue intacto. La RESTRICTIVE exige pertenencia al
--     tenant actual en las dos direcciones, así que ninguna fila de otro operador entra.
--   · `users_self_update` se conserva. Editar tu propio perfil no debe exigir
--     `users:update`: cambiarte la zona horaria no es administrar usuarios.
--   · `email` y `auth_id` no se pueden cambiar desde la API —no están en la lista de
--     campos permitidos del repositorio— porque son la llave con la identidad de
--     Supabase Auth. RLS no lo impide; el repositorio sí, y está documentado allí.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1 · La RESTRICTIVE, coherente entre lectura y escritura ────────────────
--
-- Su `USING` ya permitía VER a los miembros del tenant; su `WITH CHECK` solo permitía
-- escribir la propia fila. Una política cuyo criterio de lectura y de escritura no
-- coinciden deja escrituras imposibles sobre filas visibles, que es lo que pasaba.
DROP POLICY IF EXISTS user_visibility ON core.users;

CREATE POLICY user_visibility ON core.users
    AS RESTRICTIVE FOR ALL
    USING (
        core.current_user_id() IS NOT NULL
        AND (
            id = core.current_user_id()
            OR EXISTS (
                SELECT 1
                  FROM core.tenant_memberships m
                 WHERE m.user_id = users.id
                   AND m.tenant_id = core.current_tenant_id()
                   AND m.revoked_at IS NULL
            )
        )
    )
    WITH CHECK (
        core.current_user_id() IS NOT NULL
        AND (
            id = core.current_user_id()
            OR EXISTS (
                SELECT 1
                  FROM core.tenant_memberships m
                 WHERE m.user_id = users.id
                   AND m.tenant_id = core.current_tenant_id()
                   AND m.revoked_at IS NULL
            )
        )
    );

-- ── 2 · La PERMISSIVE que faltaba ──────────────────────────────────────────
--
-- Mismo criterio que `tenant_members` en clients, companies y tenant_countries: acota
-- al tenant y deja la decisión de QUIEN puede escribir al permiso de la API.
CREATE POLICY users_tenant_update ON core.users
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
              FROM core.tenant_memberships m
             WHERE m.user_id = users.id
               AND m.tenant_id = core.current_tenant_id()
               AND m.revoked_at IS NULL
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM core.tenant_memberships m
             WHERE m.user_id = users.id
               AND m.tenant_id = core.current_tenant_id()
               AND m.revoked_at IS NULL
        )
    );

COMMENT ON POLICY users_tenant_update ON core.users IS
    'Acota al tenant; la autoridad sobre quien puede escribir es users:update en la API. Mismo patron que clients, companies y tenant_countries.';


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_update integer;
    v_check  text;
BEGIN
    SELECT count(*) INTO v_update
      FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'users'
       AND cmd IN ('UPDATE', 'ALL');
    -- users_self_update + users_tenant_update + user_visibility
    IF v_update <> 3 THEN
        RAISE EXCEPTION 'se esperaban 3 politicas que afecten a UPDATE, hay %', v_update;
    END IF;

    -- Lo que importa de verdad: que la RESTRICTIVE ya no exija ser uno mismo al
    -- escribir. Si alguien la volviera a poner asi, el CRUD de usuarios se rompe otra
    -- vez con un 404 que no explica nada.
    SELECT with_check INTO v_check
      FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'users' AND policyname = 'user_visibility';
    IF v_check IS NULL OR v_check NOT LIKE '%tenant_memberships%' THEN
        RAISE EXCEPTION
            'el WITH CHECK de user_visibility no admite miembros del tenant: %', v_check;
    END IF;

    RAISE NOTICE '0072 OK · un administrador puede editar a los usuarios de su tenant';
END $$;
