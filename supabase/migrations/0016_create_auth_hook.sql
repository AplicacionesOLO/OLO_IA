-- ═══════════════════════════════════════════════════════════════════════════
-- 0016_create_auth_hook.sql
-- Crea      : public.custom_access_token_hook(jsonb)
-- Depende de: 0011 (memberships), 0014 (role_assignments), 0013 (roles)
-- Riesgo    : ALTO — es el riesgo nº1 declarado del proyecto
--
-- ⚠ ADELANTADA respecto al roadmap, donde ocupaba el hueco 0021.
--   Motivo: es prerrequisito duro del primer vertical. Sin el Hook, un login
--   produce un JWT sin `tenant_id`, `core.current_tenant_id()` devuelve NULL y
--   RLS deniega absolutamente todo: no hay flujo extremo a extremo posible.
--   Las migraciones 0017-0021 conservan su contenido previsto.
--
-- ⚠ LA FUNCION VIVE EN public, NO EN uth.
--   Verificado en este proyecto: el schema uth lo posee supabase_admin y
--   postgres NO tiene CREATE sobre el. Intentarlo produce un fallo de
--   privilegios. Supabase espera la funcion en un schema propio y la referencia
--   por URI:  pg-functions://postgres/public/custom_access_token_hook
--
--   Consecuencia importante: en public los privilegios por defecto conceden
--   EXECUTE a anon y authenticated sobre toda funcion nueva, asi que el REVOKE
--   del final no es defensivo: es imprescindible.
--
-- Publica en app_metadata SOLO dos claims (DEC-03, JWT mínimo):
--     tenant_id           uuid
--     tenant_wide_access  boolean
--
-- Lo que NO publica y por qué:
--   • core.users.id  — se resuelve por auth_id en la base (CONF-06)
--   • warehouse_ids  — revocación diferida hasta el refresh, y bloat de cabecera
--   • permissions    — RF-RBAC-007 exige efecto inmediato; en el token habría
--                      hasta una hora de retraso
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth_id   uuid;
    v_tenant_id uuid;
    v_wide      boolean := false;
    v_claims    jsonb;
BEGIN
    v_auth_id := NULLIF(event -> 'claims' ->> 'sub', '')::uuid;
    IF v_auth_id IS NULL THEN
        RETURN event;
    END IF;

    -- Membresía activa del usuario. La restricción
    -- uq_membership_one_active_per_user garantiza 0 o 1 fila, así que no hay
    -- ambigüedad sobre cuál es el tenant activo: es lo que disuelve DEC-14.
    SELECT m.tenant_id
      INTO v_tenant_id
      FROM core.users u
      JOIN core.tenant_memberships m ON m.user_id = u.id
     WHERE u.auth_id      = v_auth_id
       AND u.deleted_at   IS NULL
       AND u.status       = 'active'
       AND m.revoked_at   IS NULL
       AND m.status       = 'active'
     LIMIT 1;

    -- FAIL-SECURE: sin membresía activa NO se añade ningún claim propio. El
    -- login tiene éxito —la identidad es válida— pero el token no da acceso a
    -- ningún dato. El backend lo detecta y responde 403 NO_ACTIVE_MEMBERSHIP
    -- con un mensaje accionable, en lugar de dejar ver una aplicación vacía.
    IF v_tenant_id IS NULL THEN
        RETURN event;
    END IF;

    -- Acceso amplio al tenant: lo concede un rol global cuyo nombre está en la
    -- lista. Se calcula aquí porque el canal A (PostgREST, Realtime, Storage)
    -- solo dispone del JWT y no puede consultar la base.
    SELECT EXISTS (
        SELECT 1
        FROM core.role_assignments ra
        JOIN core.roles r ON r.id = ra.role_id
        JOIN core.users u ON u.id = ra.user_id
        WHERE u.auth_id       = v_auth_id
          AND ra.tenant_id    = v_tenant_id
          AND ra.scope_type   = 'global'
          AND r.name IN ('tenant_admin', 'auditor')
    ) INTO v_wide;

    v_claims := event -> 'claims';

    -- ⚠ INICIALIZACIÓN OBLIGATORIA, no defensiva.
    --   jsonb_set exige que TODOS los niveles intermedios de la ruta existan.
    --   Si `app_metadata` no está, jsonb_set(claims,'{app_metadata,tenant_id}',…)
    --   devuelve el objeto SIN CAMBIOS y SIN ERROR. El resultado sería un JWT
    --   válido sin tenant_id y RLS denegando todo, en el 100 % de los logins.
    IF v_claims -> 'app_metadata' IS NULL
       OR jsonb_typeof(v_claims -> 'app_metadata') <> 'object' THEN
        v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb, true);
    END IF;

    v_claims := jsonb_set(v_claims, '{app_metadata,tenant_id}',
                          to_jsonb(v_tenant_id::text), true);
    v_claims := jsonb_set(v_claims, '{app_metadata,tenant_wide_access}',
                          to_jsonb(v_wide), true);

    RETURN jsonb_set(event, '{claims}', v_claims, true);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
    'Publica tenant_id y tenant_wide_access en app_metadata. Fail-secure: sin membresia activa no anade claims.';

-- Solo GoTrue puede ejecutarlo.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- El Hook lee estas tablas con los privilegios del propietario (SECURITY
-- DEFINER), pero supabase_auth_admin necesita USAGE sobre el schema para poder
-- invocar la función cualificada.
GRANT USAGE ON SCHEMA core TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_result jsonb; v_event jsonb;
BEGIN
    IF to_regprocedure('public.custom_access_token_hook(jsonb)') IS NULL THEN
        RAISE EXCEPTION 'el hook no se creo';
    END IF;

    -- Fail-secure con un sub inexistente: debe devolver el evento intacto.
    v_event := '{"claims":{"sub":"00000000-0000-0000-0000-0000000000ff","aud":"authenticated"}}'::jsonb;
    v_result := public.custom_access_token_hook(v_event);
    IF v_result <> v_event THEN
        RAISE EXCEPTION 'el hook modifico el evento de un usuario sin membresia';
    END IF;

    -- Un evento sin `sub` no debe romper el login.
    v_event := '{"claims":{"aud":"authenticated"}}'::jsonb;
    IF public.custom_access_token_hook(v_event) <> v_event THEN
        RAISE EXCEPTION 'el hook modifico un evento sin sub';
    END IF;
END
$$;
