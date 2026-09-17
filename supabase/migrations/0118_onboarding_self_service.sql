-- ═══════════════════════════════════════════════════════════════════════════
-- 0118_onboarding_self_service.sql
-- Crea      : core.crear_tenant_propio()
-- Depende de: 0007 (tenants), 0010/0011 (users/memberships), 0013 (roles),
--             0014 (role_assignments), 0080 (alta_usuario_invitado, mismo
--             patron de alta de usuario)
-- Riesgo     : ALTO -- primera funcion que deja crear una fila en
--              core.tenants a un rol de aplicacion. Ver la cabecera de 0007:
--              "Sin politica de INSERT... ni olo_app ni authenticated pueden
--              crear tenants" -- eso sigue siendo cierto, esta migracion NO
--              toca RLS ni agrega una politica. Abre una UNICA puerta,
--              deliberada y acotada, del mismo tipo que 0080 abrio para
--              core.users: una funcion SECURITY DEFINER que decide POR SU
--              CUENTA a quien deja pasar.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- #8 DEL PLAN DE MEJORAS SAAS: ONBOARDING SELF-SERVICE
--
-- Hoy, un tenant SOLO se crea a mano (admin_sql.py / una migracion, ver la
-- cabecera de 0007) y un usuario SOLO se crea invitado a un tenant que ya
-- existe (core.alta_usuario_invitado, 0080). No hay forma de que alguien
-- llegue, cree su propia organizacion y sea su primer administrador sin que
-- una persona de la plataforma mueva un dedo.
--
-- ── POR QUE ESTA FUNCION NO EXIGE is_platform_owner() (a diferencia de
--    fijar_cuota_tenant / fijar_modelo_flota) ──────────────────────────────
--
-- Esas dos son un platform owner actuando sobre el tenant de OTRO. Esta es
-- justo lo contrario: alguien SIN NINGUN privilegio, recien autenticado en
-- Supabase (con o sin fila en core.users todavia), creando SU PROPIA
-- organizacion. Exigir un privilegio que por definicion no puede tener
-- volveria la funcion inalcanzable. La seguridad no viene de quien puede
-- llamarla -- cualquier `authenticated` puede, y esta GRANT es intencional --
-- sino de lo ESTRECHO de lo que hace: crea un tenant NUEVO (nunca modifica
-- uno existente), y solo se vincula a SI MISMA la identidad que ya trae el
-- JWT (core.current_auth_id()), nunca a otro usuario.
--
-- ── POR QUE RECHAZA A QUIEN YA TIENE MEMBRESIA ACTIVA ────────────────────
--
-- Esto es "crear MI organizacion", no "crear otra organizacion mas desde una
-- cuenta que ya esta en una". Sin este candado, cualquier usuario ya
-- instalado en un tenant podria multiplicar tenants vacios llamando esta
-- funcion una y otra vez.
--
-- ── EL SLUG SE DERIVA, NUNCA SE PIDE ──────────────────────────────────────
--
-- Pedirle a la persona que registra su empresa que piense en un "slug" es
-- friccion que no le importa a nadie en ese momento. Se deriva del nombre
-- (chk_tenants_slug, 0007) y, si choca, se le agrega un sufijo numerico --
-- la persona nunca ve ese detalle ni tiene que resolverlo.
--
-- ── TRIAL POR DEFECTO ──────────────────────────────────────────────────────
--
-- `status='trial'` y `trial_ends_at` a 14 dias son los valores que 0007 ya
-- preveia (`status` por omision YA es 'trial') -- nada nuevo se inventa
-- aqui, solo se usa lo que el esquema ya sabia decir. Nada en el sistema
-- today hace cumplir ese vencimiento (eso es el #10 del plan, facturacion,
-- explicitamente pendiente de una decision de negocio) -- un trial vencido
-- hoy simplemente sigue funcionando, igual que "sin cuota" en core.
-- tenant_quotas es "sin limite".
-- ═══════════════════════════════════════════════════════════════════════════

CREATE FUNCTION core.crear_tenant_propio(
    p_org_name   text,
    p_email      text,
    p_first_name text,
    p_last_name  text,
    p_locale     text DEFAULT 'es',
    p_timezone   text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
    out_tenant_id   uuid,
    out_tenant_name text,
    out_tenant_slug text,
    out_user_id     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth_id   uuid := core.current_auth_id();
    -- A DIFERENCIA de core.current_tenant_id() (que SI puede leer el JWT via
    -- `request.jwt.claims`, "Canal A"): esta funcion la llama el backend por
    -- conexion directa a Postgres, que NUNCA fija esa GUC -- solo fija
    -- `app.auth_user_id`/`app.tenant_id` ("Canal B", ver TenantContext.
    -- as_gucs() y onboarding_session()). El correo se recibe EXPLICITO, ya
    -- verificado por el backend al decodificar el JWT -- mismo patron que
    -- `p_email` en core.alta_usuario_invitado (0080).
    v_email     text := lower(btrim(coalesce(p_email, '')));
    v_org_name  text := btrim(coalesce(p_org_name, ''));
    v_slug_base text;
    v_slug      text;
    v_intento   int := 0;
    v_user      uuid;
    v_tenant    uuid;
    v_rol_admin CONSTANT uuid := '00000000-0000-0000-0000-0000000000a1'; -- tenant_admin, ver 0013
BEGIN
    -- ── Quien llama ──────────────────────────────────────────────────────────
    IF v_auth_id IS NULL THEN
        RAISE EXCEPTION 'Sin identidad autenticada' USING ERRCODE = '42501';
    END IF;
    IF v_email = '' OR v_email NOT LIKE '%_@_%.__%' THEN
        RAISE EXCEPTION 'El token no trae un correo valido' USING ERRCODE = '42501';
    END IF;

    -- Ya en una organizacion: esto no es para el (ver la cabecera).
    IF EXISTS (
        SELECT 1 FROM core.users u
        JOIN core.tenant_memberships m ON m.user_id = u.id
        WHERE u.auth_id = v_auth_id
          AND u.deleted_at IS NULL
          AND m.status = 'active' AND m.revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Esta identidad ya pertenece a una organizacion' USING ERRCODE = '42710';
    END IF;

    -- ── Los datos ─────────────────────────────────────────────────────────────
    IF length(v_org_name) < 2 THEN
        RAISE EXCEPTION 'El nombre de la organizacion debe tener al menos 2 caracteres'
            USING ERRCODE = '22023';
    END IF;
    IF length(btrim(coalesce(p_first_name, ''))) < 1
       OR length(btrim(coalesce(p_last_name, ''))) < 1 THEN
        RAISE EXCEPTION 'Nombre y apellido son obligatorios' USING ERRCODE = '22023';
    END IF;

    -- ── El slug: derivado, con sufijo si choca ──────────────────────────────
    v_slug_base := lower(regexp_replace(v_org_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug_base := trim(both '-' from v_slug_base);
    IF v_slug_base = '' THEN
        v_slug_base := 'org';
    END IF;
    v_slug := v_slug_base;
    LOOP
        EXIT WHEN NOT EXISTS (SELECT 1 FROM core.tenants t WHERE t.slug = v_slug);
        v_intento := v_intento + 1;
        IF v_intento > 50 THEN
            RAISE EXCEPTION 'No se pudo generar un identificador unico para %', v_org_name;
        END IF;
        v_slug := v_slug_base || '-' || v_intento;
    END LOOP;

    -- ── El tenant ────────────────────────────────────────────────────────────
    INSERT INTO core.tenants (name, slug, status, plan, trial_ends_at)
    VALUES (v_org_name, v_slug, 'trial', 'starter', now() + interval '14 days')
    RETURNING id INTO v_tenant;

    -- ── El usuario -- mismo patron que core.alta_usuario_invitado (0080),
    -- sin "actor": aqui la persona se da de alta a si misma ─────────────────
    SELECT u.id INTO v_user FROM core.users u WHERE u.auth_id = v_auth_id;
    IF v_user IS NULL THEN
        INSERT INTO core.users
            (auth_id, email, first_name, last_name, locale, timezone, status)
        VALUES
            (v_auth_id, v_email, btrim(p_first_name), btrim(p_last_name),
             coalesce(nullif(btrim(p_locale), ''), 'es'),
             coalesce(nullif(btrim(p_timezone), ''), 'America/Costa_Rica'),
             'active')
        RETURNING id INTO v_user;
    ELSE
        -- Reingreso de un correo que existio antes (borrado logico o
        -- inactivo): igual criterio que 0080, deshacer la baja sin
        -- reescribir nombre/correo, que son suyos.
        UPDATE core.users
           SET deleted_at = NULL,
               status      = 'active',
               updated_at  = now(),
               version     = version + 1
         WHERE id = v_user
           AND (deleted_at IS NOT NULL OR status <> 'active');
    END IF;

    -- ── La membresia y el rol de administrador de SU tenant ─────────────────
    INSERT INTO core.tenant_memberships
        (tenant_id, user_id, status, is_default, joined_at, created_by)
    VALUES
        (v_tenant, v_user, 'active', true, now(), v_user);

    INSERT INTO core.role_assignments (tenant_id, user_id, role_id, scope_type, assigned_by)
    VALUES (v_tenant, v_user, v_rol_admin, 'global', v_user);

    RETURN QUERY SELECT v_tenant, v_org_name, v_slug, v_user;
END;
$$;

COMMENT ON FUNCTION core.crear_tenant_propio(text, text, text, text, text, text) IS
    'Autoservicio (#8 del plan de mejoras SaaS): crea un tenant NUEVO y a su primer administrador, para la identidad de Supabase Auth que llama. Rechaza a quien ya tiene una membresia activa en algun tenant. No exige is_platform_owner() -- por diseno, ver la cabecera. p_email lo resuelve el backend del JWT verificado -- esta funcion no tiene canal propio para leerlo (conexion directa, no PostgREST).';

-- Solo `olo_app`: el backend es el UNICO camino, igual que el resto de
-- funciones de este estilo (fijar_cuota_tenant, fijar_modelo_flota). NO se le
-- da a `authenticated` directo -- eso permitiria llamarla via PostgREST sin
-- pasar por la validacion/registro de peticion del backend.
REVOKE ALL ON FUNCTION core.crear_tenant_propio(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.crear_tenant_propio(text, text, text, text, text, text) TO olo_app;


-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
BEGIN
    IF to_regprocedure('core.crear_tenant_propio(text,text,text,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'crear_tenant_propio no se creo';
    END IF;

    -- Sin contexto de sesion (esto corre como superusuario, sin JWT), debe
    -- rechazar por falta de identidad -- la misma comprobacion que impide
    -- que alguien la llame sin haber iniciado sesion.
    BEGIN
        PERFORM core.crear_tenant_propio('Empresa de prueba', 'ana@ejemplo.com', 'Ana', 'Perez');
        RAISE EXCEPTION 'crear_tenant_propio no deberia funcionar sin sesion autenticada';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '42501' THEN
            RAISE EXCEPTION 'se esperaba 42501 (sin identidad), salio %: %', SQLSTATE, SQLERRM;
        END IF;
    END;

    RAISE NOTICE '0118 OK - core.crear_tenant_propio() lista, rechaza sin sesion como se espera.';
END $$;
