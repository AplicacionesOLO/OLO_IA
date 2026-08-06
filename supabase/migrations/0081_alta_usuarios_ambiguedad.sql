-- ═══════════════════════════════════════════════════════════════════════════════
-- 0081 · CORRIGE core.alta_usuario_invitado: «column reference user_id is ambiguous»
--
-- La 0080 declaraba la salida así:
--
--     RETURNS TABLE (user_id uuid, usuario_creado boolean, membresia_creada boolean)
--
-- En plpgsql, **los nombres de `RETURNS TABLE` se convierten en variables** de la
-- función, igual que si estuvieran en el DECLARE. Así que dentro del cuerpo, este
-- WHERE tiene dos candidatos para `user_id` —la variable de salida y la columna de la
-- tabla— y Postgres se niega a elegir:
--
--     UPDATE core.tenant_memberships
--        SET ...
--      WHERE tenant_id = v_tenant AND user_id = v_user;   ← ambiguo
--
--     ERROR:  column reference "user_id" is ambiguous
--     DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- No lo detectó la verificación de la 0080 porque comprueba que las funciones existan
-- y quién puede ejecutarlas, no que funcionen: el error es de ejecución, no de
-- compilación. Lo encontró la primera llamada real.
--
-- ── LA CORRECCIÓN ─────────────────────────────────────────────────────────────
--
-- Se cualifican TODAS las referencias a columnas con un alias de tabla (`m.user_id`,
-- `u.id`). La otra salida —`#variable_conflict use_column`— resolvería la ambigüedad
-- prefiriendo la columna en silencio, y eso es peor: convertiría cualquier colisión
-- futura entre una variable y una columna en un comportamiento inesperado sin error.
--
-- Los nombres de la salida NO se cambian: son el contrato que lee el backend.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.alta_usuario_invitado(
    p_auth_id    uuid,
    p_email      text,
    p_first_name text,
    p_last_name  text,
    p_locale     text DEFAULT 'es',
    p_timezone   text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
    user_id          uuid,
    usuario_creado   boolean,
    membresia_creada boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_tenant   uuid := core.current_tenant_id();
    v_actor    uuid := core.current_user_id();
    v_email    text := lower(btrim(p_email));
    v_user     uuid;
    v_creado   boolean := false;
    v_memb     boolean := false;
    v_revocada boolean;
BEGIN
    -- ── Quién llama ───────────────────────────────────────────────────────────
    -- Esta función no pasa por RLS, así que comprueba por su cuenta. Sin esto,
    -- cualquier ruta con una sesión de base de datos podría crear usuarios.
    IF v_tenant IS NULL OR v_actor IS NULL THEN
        RAISE EXCEPTION 'Sin contexto de sesión: no hay tenant ni usuario actual'
            USING ERRCODE = '42501';
    END IF;

    IF NOT core.has_active_membership() THEN
        RAISE EXCEPTION 'Quien invita no tiene membresía activa en este tenant'
            USING ERRCODE = '42501';
    END IF;

    -- `users:invite` es de alcance `tenant`, así que lo concede un rol. Un owner de
    -- plataforma también puede: su privilegio no viene de ningún rol y la CTE de
    -- roles no lo vería nunca.
    IF NOT (core.tiene_permiso('users:invite') OR core.is_platform_owner()) THEN
        RAISE EXCEPTION 'Falta el permiso users:invite' USING ERRCODE = '42501';
    END IF;

    -- ── Los datos ─────────────────────────────────────────────────────────────
    -- Se validan aquí y no solo en Python porque esta función es alcanzable sin
    -- pasar por la API, y una violación de CHECK no diría qué campo corregir.
    IF p_auth_id IS NULL THEN
        RAISE EXCEPTION 'Falta el auth_id: la identidad la crea Supabase Auth, no esta función'
            USING ERRCODE = '22004';
    END IF;
    IF v_email IS NULL OR v_email NOT LIKE '%_@_%.__%' THEN
        RAISE EXCEPTION 'Correo no válido: %', p_email USING ERRCODE = '22023';
    END IF;
    IF length(btrim(coalesce(p_first_name, ''))) < 1
       OR length(btrim(coalesce(p_last_name, ''))) < 1 THEN
        RAISE EXCEPTION 'Nombre y apellido son obligatorios' USING ERRCODE = '22023';
    END IF;

    -- ── El usuario ────────────────────────────────────────────────────────────
    -- Se busca por `auth_id` y no por correo: `auth_id` es la llave real —tiene
    -- UNIQUE— y es la que ata la fila a la identidad de Auth. Buscar por correo
    -- podría encontrar una fila vieja apuntando a OTRA identidad.
    --
    -- Se incluyen los borrados lógicamente: `uq_users_auth_id` no excluye
    -- `deleted_at`, así que un INSERT chocaría contra la fila borrada. Reactivarla es
    -- además lo correcto —es la misma persona—.
    SELECT u.id INTO v_user
      FROM core.users u
     WHERE u.auth_id = p_auth_id;

    IF v_user IS NULL THEN
        INSERT INTO core.users AS u
            (auth_id, email, first_name, last_name, locale, timezone, status, created_by)
        VALUES
            (p_auth_id, v_email, btrim(p_first_name), btrim(p_last_name),
             coalesce(nullif(btrim(p_locale), ''), 'es'),
             coalesce(nullif(btrim(p_timezone), ''), 'America/Costa_Rica'),
             -- 'pending' = nunca ha entrado. No bloquea nada; el primer `/auth/me`
             -- lo pasa a 'active'.
             'pending',
             v_actor)
        RETURNING u.id INTO v_user;
        v_creado := true;
    ELSE
        -- Ya existía: puede ser alguien de otro tenant, o un reingreso. NO se le
        -- reescribe el nombre ni el correo —son suyos, no de quien invita— pero sí se
        -- deshace la baja lógica, porque si no, la persona seguiría sin poder entrar
        -- (`core.current_user_id()` filtra por `deleted_at IS NULL`).
        UPDATE core.users u
           SET deleted_at = NULL,
               status      = CASE WHEN u.status IN ('inactive', 'suspended') THEN 'pending'
                                  ELSE u.status END,
               updated_by  = v_actor,
               updated_at  = now(),
               version     = u.version + 1
         WHERE u.id = v_user
           AND (u.deleted_at IS NOT NULL OR u.status IN ('inactive', 'suspended'));
    END IF;

    -- ── La membresía ──────────────────────────────────────────────────────────
    SELECT (m.revoked_at IS NOT NULL) INTO v_revocada
      FROM core.tenant_memberships m
     WHERE m.tenant_id = v_tenant AND m.user_id = v_user;

    IF v_revocada IS NULL THEN
        INSERT INTO core.tenant_memberships
            (tenant_id, user_id, status, is_default, invited_by, joined_at, created_by)
        VALUES
            (v_tenant, v_user, 'active', true, v_actor, now(), v_actor);
        v_memb := true;
    ELSIF v_revocada THEN
        -- Reingreso. `revoked_at` a NULL en lugar de una fila nueva:
        -- `uq_membership_tenant_user` es única por (tenant, usuario), y la fila ES el
        -- vínculo.
        UPDATE core.tenant_memberships m
           SET revoked_at = NULL,
               status     = 'active',
               joined_at  = coalesce(m.joined_at, now()),
               invited_by = v_actor,
               updated_by = v_actor,
               updated_at = now(),
               version    = m.version + 1
         WHERE m.tenant_id = v_tenant AND m.user_id = v_user;
        v_memb := true;
    ELSE
        -- Vigente pero quizá suspendida. Reinvitar a alguien suspendido lo reactiva:
        -- es lo que el gesto significa.
        UPDATE core.tenant_memberships m
           SET status     = 'active',
               joined_at  = coalesce(m.joined_at, now()),
               updated_by = v_actor,
               updated_at = now(),
               version    = m.version + 1
         WHERE m.tenant_id = v_tenant AND m.user_id = v_user
           AND m.status <> 'active';
    END IF;

    RETURN QUERY SELECT v_user, v_creado, v_memb;
END;
$$;

COMMENT ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text) IS
    'Crea la fila de usuario y su membresía en el tenant actual, en un solo paso. '
    'SECURITY DEFINER porque las políticas de core.users hacen la pareja '
    'usuario/membresía imposible de insertar por separado. Comprueba users:invite '
    'por su cuenta y toma el tenant del contexto, nunca de un parámetro.';

-- CREATE OR REPLACE conserva los privilegios, así que los GRANT de la 0080 siguen en
-- pie. Se repiten de todos modos: si alguna vez se aplica esta migración sobre una base
-- donde la función no existía, tiene que quedar igual de cerrada.
REVOKE ALL ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text)
    TO olo_app;


-- ── Verificación: que EJECUTE, no solo que exista ─────────────────────────────
-- Es la lección de la 0080. Comprobar que la función está creada no prueba nada de un
-- error que solo aparece al ejecutarla, así que aquí se llama de verdad —con un usuario
-- de mentira, dentro de una subtransacción que se deshace—.
DO $verif$
DECLARE
    v_tenant uuid;
    v_auth   uuid;
    r        RECORD;
    v_fake   uuid := '00000000-0000-4000-8000-0000ffff0081';
BEGIN
    SELECT m.tenant_id, u.auth_id INTO v_tenant, v_auth
      FROM core.users u
      JOIN core.tenant_memberships m
        ON m.user_id = u.id AND m.revoked_at IS NULL AND m.status = 'active'
      JOIN core.role_assignments ra ON ra.user_id = u.id AND ra.tenant_id = m.tenant_id
      JOIN core.role_permissions rp ON rp.role_id = ra.role_id
     WHERE u.deleted_at IS NULL AND rp.permission_code = 'users:invite'
     LIMIT 1;

    IF v_tenant IS NULL THEN
        RAISE NOTICE 'AVISO · no hay ningún usuario con users:invite: no se puede probar '
                     'la ejecución. La función queda creada.';
        RETURN;
    END IF;

    PERFORM set_config('app.tenant_id', v_tenant::text, false);
    PERFORM set_config('app.auth_user_id', v_auth::text, false);

    BEGIN
        SELECT * INTO r FROM core.alta_usuario_invitado(
            v_fake, 'verificacion.0081@olo-dev.test', 'Verificacion', 'Migracion');

        IF NOT r.usuario_creado OR NOT r.membresia_creada THEN
            RAISE EXCEPTION 'La función ejecutó pero no creó las filas: creado=% memb=%',
                r.usuario_creado, r.membresia_creada;
        END IF;

        -- Se deshace: era una prueba, no un usuario.
        DELETE FROM core.tenant_memberships m WHERE m.user_id = r.user_id;
        DELETE FROM core.users u WHERE u.id = r.user_id;
        RAISE NOTICE 'OK · core.alta_usuario_invitado ejecuta y crea las dos filas';
    EXCEPTION WHEN ambiguous_column THEN
        RAISE EXCEPTION 'Sigue habiendo una referencia ambigua: %', SQLERRM;
    END;

    PERFORM set_config('app.tenant_id', '', false);
    PERFORM set_config('app.auth_user_id', '', false);
END $verif$;
