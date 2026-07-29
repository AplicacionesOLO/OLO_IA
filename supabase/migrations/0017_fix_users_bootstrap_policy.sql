-- ═══════════════════════════════════════════════════════════════════════════
-- 0017_fix_users_bootstrap_policy.sql
-- Corrige   : las dos políticas de lectura de core.users
-- Depende de: 0015
-- Riesgo    : ALTO — toca la política de la tabla de identidad
--
-- ⚠ DOS DEFECTOS CORREGIDOS, ambos detectados ejecutando el vertical de extremo
--   a extremo contra la base real. Ninguna prueba unitaria los habría visto.
--
-- DEFECTO 1 · la permisiva exigía resolver la identidad para conceder lectura
--
--   `users_read` de 0015 usaba `core.current_user_id() IS NOT NULL`. Esa
--   condición no aporta aislamiento —el aislamiento lo impone la RESTRICTIVA— y
--   sí añade una dependencia de arranque innecesaria sobre la misma tabla que
--   se está leyendo. Pasa a `USING (true)`.
--
-- DEFECTO 2 · FUGA: sin identidad se veían los usuarios del tenant
--
--   La restrictiva `user_visibility` era:
--       id = current_user_id() OR EXISTS (… m.tenant_id = current_tenant_id() …)
--
--   Con `app.tenant_id` fijado pero SIN identidad —`current_user_id()` NULL— la
--   primera rama daba false, pero la segunda seguía cumpliéndose para todos los
--   miembros del tenant. Resultado medido: 1 usuario visible sin identidad
--   alguna. Vía API no era alcanzable, porque el JWT siempre trae ambos claims,
--   pero un worker mal configurado —que fija tenant_id y no auth_user_id— sí
--   habría leído el directorio de usuarios del tenant.
--
--   Se añade la guarda `current_user_id() IS NOT NULL` como primer factor. Ahora
--   sin identidad no hay lectura posible, con independencia del tenant.
--
-- Verificado tras aplicar, como `authenticated`:
--   se ve a sí mismo = true · no ve al otro tenant = true · sin identidad = 0 filas
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Permisiva: concede lectura; el aislamiento no es su tarea ───────────────
DROP POLICY IF EXISTS users_read ON core.users;

CREATE POLICY users_read ON core.users
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (true);

COMMENT ON POLICY users_read ON core.users IS
    'Concede lectura. El aislamiento lo impone la RESTRICTIVA user_visibility, que se evalua con AND.';


-- ── Restrictiva: exige identidad ANTES de cualquier otra condición ──────────
DROP POLICY IF EXISTS user_visibility ON core.users;

CREATE POLICY user_visibility ON core.users
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (
        -- Sin identidad no se ve nada, ni siquiera con un tenant válido en el
        -- contexto. Es la guarda que cierra el defecto 2.
        core.current_user_id() IS NOT NULL
        AND (
            id = core.current_user_id()
            OR EXISTS (
                SELECT 1
                FROM core.tenant_memberships m
                WHERE m.user_id    = core.users.id
                  AND m.tenant_id  = core.current_tenant_id()
                  AND m.revoked_at IS NULL
            )
        )
    )
    WITH CHECK (id = core.current_user_id());   -- solo edito mi propia fila

COMMENT ON POLICY user_visibility ON core.users IS
    'Piso duro: exige identidad, y limita a la propia fila o a co-miembros del tenant actual.';
