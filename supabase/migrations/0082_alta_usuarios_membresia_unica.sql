-- ═══════════════════════════════════════════════════════════════════════════════
-- 0082 · TRES CORRECCIONES A core.alta_usuario_invitado
--
-- Las tres las encontró la prueba de extremo a extremo, no la lectura del código, y
-- las tres son del mismo tipo: reglas del esquema que la función ignoraba.
--
-- ── 1 · `status = 'pending'` DEJABA A LA PERSONA SIN PODER ENTRAR NUNCA ────────
--
-- El Custom Access Token Hook (migración 0016) decide el `tenant_id` del JWT así:
--
--     WHERE u.auth_id = v_auth_id
--       AND u.deleted_at IS NULL
--       AND u.status = 'active'          ← aquí
--       AND m.revoked_at IS NULL
--       AND m.status = 'active'
--
-- Con `u.status = 'pending'` el hook no encuentra nada y —fail-secure, a propósito—
-- emite el token SIN `app_metadata.tenant_id`. El login devuelve 200, y a partir de
-- ahí TODAS las peticiones responden 403 NO_ACTIVE_MEMBERSHIP.
--
-- Incluida `/auth/me`, que era justo donde `pending` iba a pasar a `active`. Es la
-- misma circularidad que la 0080 evitó para la membresía, y en la que caímos con el
-- estado del usuario:
--
--     pending ──impide──▶ token con tenant ──impide──▶ /auth/me ──que activaría──▶ pending
--
-- Medido: la persona invitada ponía su contraseña, entraba, y no podía abrir ni una
-- pantalla. Así que el usuario nace **'active'**.
--
-- Lo que se pierde es poder distinguir «invitado que aún no ha entrado» en la lista de
-- usuarios. No se pierde el dato: Supabase Auth guarda `last_sign_in_at`. Y la puerta
-- de entrada nunca fue este campo, es Auth: sin abrir el correo no hay contraseña, y
-- sin contraseña no hay sesión.
--
-- ── 2 · UN USUARIO SOLO PUEDE TENER UNA MEMBRESÍA ACTIVA ──────────────────────
--
--     uq_membership_one_active_per_user
--       UNIQUE (user_id) WHERE revoked_at IS NULL AND status = 'active'
--
-- No es por tenant: es por USUARIO, en todo el sistema. Y es deliberado — el hook lo
-- dice: «garantiza 0 o 1 fila, así que no hay ambigüedad sobre cuál es el tenant
-- activo». Si una persona tuviera dos, `core.current_tenant_id()` no tendría respuesta.
--
-- La 0080 insertaba la membresía sin mirarlo. Invitar a alguien que ya trabaja para
-- OTRO operador reventaba con una violación de unicidad, y el mensaje no explicaba nada.
--
-- Y la salida correcta NO es mover a esa persona: eso le quitaría el acceso a su
-- operador actual, en silencio, como efecto colateral de un alta. Se RECHAZA con un
-- mensaje que dice qué pasa y quién puede resolverlo.
--
-- ── 3 · `is_default = true` A CIEGAS ─────────────────────────────────────────
--
--     uq_membership_one_default  UNIQUE (user_id) WHERE is_default AND revoked_at IS NULL
--
-- Mismo problema en pequeño. Ahora se pone `true` solo si esa persona no tiene ya otra
-- membresía marcada como predeterminada.
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
    v_otro     uuid;
    v_default  boolean;
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

    IF NOT (core.tiene_permiso('users:invite') OR core.is_platform_owner()) THEN
        RAISE EXCEPTION 'Falta el permiso users:invite' USING ERRCODE = '42501';
    END IF;

    -- ── Los datos ─────────────────────────────────────────────────────────────
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
    -- Se busca por `auth_id`: es la llave real —tiene UNIQUE— y la que ata la fila a
    -- la identidad de Auth. Se incluyen los borrados lógicamente, porque
    -- `uq_users_auth_id` no excluye `deleted_at` y un INSERT chocaría con la fila vieja.
    SELECT u.id INTO v_user
      FROM core.users u
     WHERE u.auth_id = p_auth_id;

    -- ── ¿Trabaja ya para otro operador? ───────────────────────────────────────
    -- Se comprueba ANTES de escribir nada. `uq_membership_one_active_per_user` lo
    -- impediría igualmente, pero con una violación de unicidad que no explica ni qué
    -- pasa ni qué hacer.
    IF v_user IS NOT NULL THEN
        SELECT m.tenant_id INTO v_otro
          FROM core.tenant_memberships m
         WHERE m.user_id = v_user
           AND m.revoked_at IS NULL
           AND m.status = 'active'
           AND m.tenant_id <> v_tenant
         LIMIT 1;

        IF v_otro IS NOT NULL THEN
            -- No se le mueve: quitarle el acceso a su operador actual como efecto
            -- colateral de un alta sería destructivo y nadie lo ha pedido.
            RAISE EXCEPTION
                'Esa persona ya tiene una cuenta activa en otro operador. Una cuenta '
                'pertenece a un solo operador a la vez, así que primero tiene que '
                'darse de baja allí.'
                USING ERRCODE = 'P0001', DETAIL = 'CORE_USER_ACTIVE_IN_OTHER_TENANT';
        END IF;
    END IF;

    IF v_user IS NULL THEN
        INSERT INTO core.users AS u
            (auth_id, email, first_name, last_name, locale, timezone, status, created_by)
        VALUES
            (p_auth_id, v_email, btrim(p_first_name), btrim(p_last_name),
             coalesce(nullif(btrim(p_locale), ''), 'es'),
             coalesce(nullif(btrim(p_timezone), ''), 'America/Costa_Rica'),
             -- 'active', NO 'pending': ver la cabecera. El hook de 0016 exige
             -- `u.status = 'active'` para poner el tenant en el JWT, así que con
             -- 'pending' la persona entra y no puede abrir ni una pantalla.
             'active',
             v_actor)
        RETURNING u.id INTO v_user;
        v_creado := true;
    ELSE
        -- Ya existía: reingreso, o alguien a quien se dio de baja. NO se le reescribe el
        -- nombre ni el correo —son suyos, no de quien invita— pero sí se deshace la baja,
        -- porque si no seguiría sin poder entrar: `core.current_user_id()` filtra por
        -- `deleted_at IS NULL` y el hook por `status = 'active'`.
        UPDATE core.users u
           SET deleted_at = NULL,
               status      = 'active',
               updated_by  = v_actor,
               updated_at  = now(),
               version     = u.version + 1
         WHERE u.id = v_user
           AND (u.deleted_at IS NOT NULL OR u.status <> 'active');
    END IF;

    -- ── La membresía ──────────────────────────────────────────────────────────
    SELECT (m.revoked_at IS NOT NULL) INTO v_revocada
      FROM core.tenant_memberships m
     WHERE m.tenant_id = v_tenant AND m.user_id = v_user;

    -- `is_default` solo si no tiene ya otra predeterminada:
    -- `uq_membership_one_default` es única por usuario.
    SELECT NOT EXISTS (
        SELECT 1 FROM core.tenant_memberships m
         WHERE m.user_id = v_user AND m.is_default AND m.revoked_at IS NULL
           AND m.tenant_id <> v_tenant
    ) INTO v_default;

    IF v_revocada IS NULL THEN
        INSERT INTO core.tenant_memberships
            (tenant_id, user_id, status, is_default, invited_by, joined_at, created_by)
        VALUES
            (v_tenant, v_user, 'active', v_default, v_actor, now(), v_actor);
        v_memb := true;
    ELSIF v_revocada THEN
        -- Reingreso al MISMO operador. `revoked_at` a NULL en lugar de una fila nueva:
        -- `uq_membership_tenant_user` es única por (tenant, usuario), y la fila ES el
        -- vínculo.
        UPDATE core.tenant_memberships m
           SET revoked_at = NULL,
               status     = 'active',
               is_default = v_default,
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
    'usuario/membresía imposible de insertar por separado. Comprueba users:invite por su '
    'cuenta, toma el tenant del contexto, y rechaza a quien ya tenga cuenta activa en '
    'otro operador (uq_membership_one_active_per_user).';

REVOKE ALL ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text)
    TO olo_app;


-- ── Verificación: que el usuario nazca en un estado con el que SE PUEDA ENTRAR ─
DO $verif$
DECLARE
    v_tenant uuid;
    v_auth   uuid;
    r        RECORD;
    v_estado text;
    v_claim  uuid;
    v_fake   uuid := '00000000-0000-4000-8000-0000ffff0082';
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
        RAISE NOTICE 'AVISO · nadie tiene users:invite: no se puede probar la ejecución.';
        RETURN;
    END IF;

    PERFORM set_config('app.tenant_id', v_tenant::text, false);
    PERFORM set_config('app.auth_user_id', v_auth::text, false);

    SELECT * INTO r FROM core.alta_usuario_invitado(
        v_fake, 'verificacion.0082@olo-dev.test', 'Verificacion', 'Migracion');

    SELECT u.status INTO v_estado FROM core.users u WHERE u.id = r.user_id;
    IF v_estado <> 'active' THEN
        RAISE EXCEPTION 'El usuario nace con status=%, y el hook de 0016 exige active',
            v_estado;
    END IF;

    -- La comprobación que de verdad importa: la MISMA consulta del hook. Si no
    -- devuelve tenant, el JWT saldría sin él y la persona no podría abrir nada.
    SELECT m.tenant_id INTO v_claim
      FROM core.users u
      JOIN core.tenant_memberships m ON m.user_id = u.id
     WHERE u.auth_id = v_fake
       AND u.deleted_at IS NULL
       AND u.status = 'active'
       AND m.revoked_at IS NULL
       AND m.status = 'active'
     LIMIT 1;

    IF v_claim IS NULL THEN
        RAISE EXCEPTION 'El hook de 0016 NO encontraria tenant para el usuario recien '
                        'creado: entraria y no podria abrir ninguna pantalla';
    END IF;

    DELETE FROM core.tenant_memberships m WHERE m.user_id = r.user_id;
    DELETE FROM core.users u WHERE u.id = r.user_id;

    PERFORM set_config('app.tenant_id', '', false);
    PERFORM set_config('app.auth_user_id', '', false);
    RAISE NOTICE 'OK · el usuario nace active y el hook le daria tenant_id en el JWT';
END $verif$;
