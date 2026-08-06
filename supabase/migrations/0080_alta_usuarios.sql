-- ═══════════════════════════════════════════════════════════════════════════════
-- 0080 · ALTA DE USUARIOS POR INVITACIÓN
--
-- Hasta aquí NO existía forma de crear un usuario. No era un olvido de la API: es
-- que `core.users` **no tiene ninguna política PERMISSIVE de INSERT**, así que con
-- RLS activo todo INSERT se rechaza. Y `core.tenant_memberships` tampoco.
--
-- ── POR QUÉ NO BASTA AÑADIR UNA POLÍTICA DE INSERT ────────────────────────────
--
-- Sobre `core.users` hay una política RESTRICTIVE `user_visibility` que aplica a
-- ALL —y por tanto también al INSERT—, con este WITH CHECK:
--
--     core.current_user_id() IS NOT NULL
--     AND (id = core.current_user_id() OR EXISTS (membresía activa en este tenant))
--
-- Para insertar un usuario NUEVO no se cumple ninguna de las dos ramas: no es uno
-- mismo, y su membresía todavía no existe. Pero la membresía tiene FK contra
-- `core.users`, así que no puede existir antes que el usuario.
--
--     usuario ──necesita──▶ membresía ──necesita──▶ usuario
--
-- Es una circularidad real, no un descuido. Se sale de ella insertando las dos
-- filas en un único paso que no pase por esas políticas. La alternativa —debilitar
-- `user_visibility`— sería abrir la visibilidad de usuarios entre tenants, que es
-- justo lo que esa política protege.
--
-- ── QUÉ SE AÑADE ──────────────────────────────────────────────────────────────
--
--   core.tiene_permiso(code, warehouse)   el permiso efectivo de quien llama
--   core.alta_usuario_invitado(...)       las dos filas, atómicas
--
-- Las dos son SECURITY DEFINER, así que NO pasan por RLS. Eso las convierte en
-- superficie de escalada de privilegios, y por eso `alta_usuario_invitado`:
--
--   · comprueba ella misma el permiso `users:invite` —no confía en que la API lo
--     haya hecho; es la segunda capa, igual que el trigger de `role_permissions`
--     respecto a `require_permission`—
--   · toma el tenant de `core.current_tenant_id()`, NUNCA de un parámetro, así que
--     es imposible dar de alta a alguien en otro tenant
--   · lleva `SET search_path TO ''`: sin eso, un esquema en el search_path del que
--     llama podría suplantar a las tablas que la función nombra
--
-- ── LA IDENTIDAD DE AUTH NO SE CREA AQUÍ ──────────────────────────────────────
--
-- `p_auth_id` llega ya creado por la Admin API de Supabase Auth. Postgres no puede
-- crear identidades ni mandar correos, así que el backend invita primero y llama a
-- esta función después con el `auth_id` que Auth devolvió.
--
-- ── POR QUÉ LA MEMBRESÍA NACE 'active' Y NO 'invited' ─────────────────────────
--
-- `core.has_active_membership()` exige `status = 'active'`. Con 'invited', la
-- persona pondría su contraseña, entraría, y recibiría 403 en TODAS las pantallas
-- —incluido `/auth/me`, que es donde se activaría—. No habría ninguna vía para
-- salir de ese estado desde el producto: haría falta un UPDATE a mano.
--
-- La puerta de entrada no es este campo, es Auth: sin abrir el correo de
-- invitación no hay contraseña, y sin contraseña no hay sesión.
--
-- Lo que sí queda pendiente es `core.users.status = 'pending'`, que no bloquea
-- nada —solo se lee para mostrarlo— y pasa a 'active' en el primer `/auth/me`.
-- Así «pendiente» significa «nunca ha entrado», que es una información real.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── El permiso efectivo, en el motor ──────────────────────────────────────────
-- Misma CTE recursiva que usaba `_HAS_PERMISSION` en `security/authorization.py`,
-- traída aquí para que exista UNA sola definición. El backend pasa a llamar a esta
-- función: dos copias del cálculo de permisos acabarían divergiendo, y el síntoma
-- sería que la interfaz ofrece algo que después recibe 403.
--
-- STABLE, no VOLATILE: no escribe, y así el planificador puede reutilizar el valor
-- dentro de la misma sentencia.
CREATE OR REPLACE FUNCTION core.tiene_permiso(
    p_code      text,
    p_warehouse uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
    WITH RECURSIVE assigned AS (
        SELECT ra.role_id
        FROM core.role_assignments ra
        JOIN core.users u ON u.id = ra.user_id
        WHERE ra.tenant_id = core.current_tenant_id()
          AND u.auth_id    = core.current_auth_id()
          AND (
                ra.scope_type = 'global'
             OR p_warehouse IS NULL
             OR ra.scope_warehouse_id = p_warehouse
          )
    ),
    role_tree AS (
        SELECT a.role_id AS id FROM assigned a
        UNION
        SELECT r.parent_role_id
        FROM core.roles r
        JOIN role_tree rt ON rt.id = r.id
        WHERE r.parent_role_id IS NOT NULL
    )
    SELECT EXISTS (
        SELECT 1
        FROM core.role_permissions rp
        JOIN role_tree rt ON rt.id = rp.role_id
        WHERE rp.permission_code = p_code
    )
$$;

COMMENT ON FUNCTION core.tiene_permiso(text, uuid) IS
    'Permiso efectivo del usuario de la sesión en el tenant actual, con herencia '
    'por parent_role_id. Única definición: el backend la llama en lugar de repetir '
    'la CTE. No cubre los permisos de alcance platform —esos los da platform.owners—.';


-- ── El alta ───────────────────────────────────────────────────────────────────
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
    v_tenant  uuid := core.current_tenant_id();
    v_actor   uuid := core.current_user_id();
    v_email   text := lower(btrim(p_email));
    v_user    uuid;
    v_creado  boolean := false;
    v_memb    boolean := false;
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
    -- `deleted_at`, así que un INSERT choparía contra la fila borrada. Reactivarla es
    -- además lo correcto —es la misma persona—.
    SELECT u.id INTO v_user
      FROM core.users u
     WHERE u.auth_id = p_auth_id;

    IF v_user IS NULL THEN
        INSERT INTO core.users
            (auth_id, email, first_name, last_name, locale, timezone, status, created_by)
        VALUES
            (p_auth_id, v_email, btrim(p_first_name), btrim(p_last_name),
             coalesce(nullif(btrim(p_locale), ''), 'es'),
             coalesce(nullif(btrim(p_timezone), ''), 'America/Costa_Rica'),
             -- 'pending' = nunca ha entrado. No bloquea nada; el primer `/auth/me`
             -- lo pasa a 'active'.
             'pending',
             v_actor)
        RETURNING id INTO v_user;
        v_creado := true;
    ELSE
        -- Ya existía: puede ser alguien de otro tenant, o un reingreso. NO se le
        -- reescribe el nombre ni el correo —son suyos, no de quien invita— pero sí se
        -- deshace la baja lógica, porque si no, la persona seguiría sin poder entrar
        -- (`core.current_user_id()` filtra por `deleted_at IS NULL`).
        UPDATE core.users
           SET deleted_at = NULL,
               status      = CASE WHEN status IN ('inactive', 'suspended') THEN 'pending'
                                  ELSE status END,
               updated_by  = v_actor,
               updated_at  = now(),
               version     = version + 1
         WHERE id = v_user
           AND (deleted_at IS NOT NULL OR status IN ('inactive', 'suspended'));
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
        -- Reingreso. `revoked_at` a NULL en lugar de una fila nueva: `uq_membership_
        -- tenant_user` es única por (tenant, usuario), y la fila ES el vínculo.
        UPDATE core.tenant_memberships
           SET revoked_at = NULL,
               status     = 'active',
               joined_at  = coalesce(joined_at, now()),
               invited_by = v_actor,
               updated_by = v_actor,
               updated_at = now(),
               version    = version + 1
         WHERE tenant_id = v_tenant AND user_id = v_user;
        v_memb := true;
    ELSE
        -- Vigente pero quizá suspendida. Reinvitar a alguien suspendido lo reactiva:
        -- es lo que el gesto significa.
        UPDATE core.tenant_memberships
           SET status     = 'active',
               joined_at  = coalesce(joined_at, now()),
               updated_by = v_actor,
               updated_at = now(),
               version    = version + 1
         WHERE tenant_id = v_tenant AND user_id = v_user
           AND status <> 'active';
    END IF;

    RETURN QUERY SELECT v_user, v_creado, v_memb;
END;
$$;

COMMENT ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text) IS
    'Crea la fila de usuario y su membresía en el tenant actual, en un solo paso. '
    'SECURITY DEFINER porque las políticas de core.users hacen la pareja '
    'usuario/membresía imposible de insertar por separado. Comprueba users:invite '
    'por su cuenta y toma el tenant del contexto, nunca de un parámetro.';


-- ── Quién puede llamarlas ─────────────────────────────────────────────────────
-- EXECUTE a PUBLIC es el reparto por omisión de Postgres para funciones nuevas, y
-- en una SECURITY DEFINER que crea usuarios eso sería un agujero: `anon` y
-- `authenticated` de Supabase la tendrían. Se revoca y se concede solo a `olo_app`.
REVOKE ALL ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.alta_usuario_invitado(uuid, text, text, text, text, text)
    TO olo_app;

-- `tiene_permiso` sí es de lectura y la usan las políticas indirectamente, así que
-- se deja abierta como el resto de funciones de contexto (`has_active_membership`,
-- `is_platform_owner`): devuelve solo lo que el propio usuario de la sesión puede.
GRANT EXECUTE ON FUNCTION core.tiene_permiso(text, uuid) TO olo_app;


-- ── Verificación ──────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_defs int;
    v_grant boolean;
    v_publico boolean;
BEGIN
    SELECT count(*) INTO v_defs
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core'
       AND p.proname IN ('tiene_permiso', 'alta_usuario_invitado')
       AND p.prosecdef
       -- Literalmente `search_path=""`, con las comillas: es como Postgres guarda
       -- `SET search_path TO ''` en proconfig. Comprobado contra
       -- core.current_user_id, que ya lo lleva.
       AND p.proconfig @> ARRAY['search_path=""']::text[];
    IF v_defs <> 2 THEN
        RAISE EXCEPTION 'Se esperaban 2 funciones SECURITY DEFINER con search_path fijado, hay %', v_defs;
    END IF;

    SELECT has_function_privilege('olo_app',
        'core.alta_usuario_invitado(uuid, text, text, text, text, text)', 'EXECUTE')
      INTO v_grant;
    IF NOT v_grant THEN
        RAISE EXCEPTION 'olo_app no puede ejecutar core.alta_usuario_invitado';
    END IF;

    -- Que PUBLIC NO la tenga es la mitad del control: sin esto, `anon` podría crear
    -- usuarios sin autenticarse.
    SELECT has_function_privilege('public',
        'core.alta_usuario_invitado(uuid, text, text, text, text, text)', 'EXECUTE')
      INTO v_publico;
    IF v_publico THEN
        RAISE EXCEPTION 'PUBLIC todavía puede ejecutar core.alta_usuario_invitado';
    END IF;

    RAISE NOTICE 'OK · core.tiene_permiso y core.alta_usuario_invitado creadas';
END $$;
