-- ═══════════════════════════════════════════════════════════════════════════
-- 0046_platform_owner_self_diagnosis.sql
-- Crea     : core.my_platform_access() — autodiagnóstico de la cadena de owner
-- Depende de: 0018 (core.current_auth_id), 0020 (platform.owners), 0022 (scope)
-- Riesgo   : bajo. No concede nada, no modifica datos, solo lee.
--
-- POR QUÉ EXISTE
--
--   La pregunta «¿por qué no soy Platform Owner?» se ha investigado dos veces, y
--   las dos han costado cinco consultas contra tablas de tres schemas distintos
--   —auth.users, core.users, platform.owners, core.permissions— más una llamada a
--   core.is_platform_owner() dentro del contexto del usuario. Ese coste hace que
--   se responda por hipótesis en lugar de por dato, y una hipótesis equivocada
--   sobre permisos manda a corregir la base cuando el fallo estaba en otro sitio.
--
--   Esta función responde la cadena completa de una vez.
--
-- EL ESTADO LADRILLO QUE VIGILA
--
--   `total_owners_activos = 0` es irrecuperable por API: conceder el privilegio
--   exige ya tenerlo, así que sin ninguna fila activa nadie puede volver a
--   crearla y el módulo de IA queda inalcanzable para todo el mundo.
--
--   Se llega ahí en silencio: la migración 0021 es un `INSERT ... SELECT` que
--   inserta cero filas si el usuario aún no está en `core.users`, avisa con un
--   NOTICE y pasa. Nadie la vuelve a ejecutar cuando el usuario se crea después.
--   Por eso el diagnóstico incluye el recuento global y un veredicto explícito.
--
-- POR QUÉ SOLO HABLA DEL LLAMANTE
--
--   Es `SECURITY DEFINER` y accesible a `authenticated`, así que tiene que ser
--   inocua para quien no es owner: informa del usuario ACTUAL y nada más. De los
--   demás owners publica un RECUENTO, nunca identidades — un no-owner no debe
--   poder enumerar quién administra la plataforma.
--
--   Que un no-owner pueda ejecutarla es el objetivo, no una concesión: si solo
--   respondiera a los owners, no serviría para diagnosticar precisamente el caso
--   en que alguien no lo es.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.my_platform_access()
RETURNS TABLE (
    auth_id                 uuid,
    core_user_id            uuid,
    email                   varchar(320),
    usuario_activo          boolean,
    tiene_fila_owner        boolean,
    fila_revocada_el        timestamptz,
    es_platform_owner       boolean,
    permisos_de_plataforma  int,
    total_owners_activos    int,
    veredicto               text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_auth     uuid := core.current_auth_id();
    v_user     uuid;
    v_email    varchar(320);
    v_activo   boolean := false;
    v_fila     boolean := false;
    v_revocada timestamptz;
    v_owner    boolean := false;
    v_permisos int;
    v_total    int;
    v_ver      text;
BEGIN
    SELECT u.id, u.email, (u.status = 'active' AND u.deleted_at IS NULL)
      INTO v_user, v_email, v_activo
      FROM core.users u
     WHERE u.auth_id = v_auth;

    SELECT true, o.revoked_at
      INTO v_fila, v_revocada
      FROM platform.owners o
     WHERE o.user_id = v_user;

    v_owner := core.is_platform_owner();

    SELECT count(1) INTO v_permisos FROM core.permissions WHERE scope = 'platform';
    SELECT count(1) INTO v_total    FROM platform.owners  WHERE revoked_at IS NULL;

    -- El orden importa: cada rama descarta la anterior, y la primera que se
    -- cumple es la que hay que arreglar. Decir «no tienes permiso» cuando el
    -- problema es que no hay identidad manda a la persona equivocada.
    v_ver := CASE
        WHEN v_auth IS NULL THEN
            'SIN CONTEXTO: la peticion no fija app.auth_user_id ni el claim sub. '
            'No es un problema de permisos: no hay identidad que comprobar.'
        WHEN v_user IS NULL THEN
            'SIN FILA EN core.users: existe la identidad de auth pero no el usuario '
            'de la aplicacion. Lo resuelve el Hook de 0016 o la siembra, no un permiso.'
        WHEN NOT v_activo THEN
            'USUARIO INACTIVO O BORRADO en core.users.'
        WHEN v_total = 0 THEN
            'CERO OWNERS ACTIVOS EN EL SISTEMA. Estado irrecuperable por API: '
            'conceder el privilegio exige tenerlo. Requiere reaplicar 0021 o un '
            'INSERT revisado en platform.owners.'
        WHEN NOT v_fila THEN
            'NO HAY FILA EN platform.owners para este usuario. Probable causa: 0021 '
            'se aplico antes de que el usuario existiera en core.users e inserto '
            'cero filas. Lo concede un owner activo por API.'
        WHEN v_revocada IS NOT NULL THEN
            'PRIVILEGIO REVOCADO el ' || v_revocada::text || '.'
        WHEN NOT v_owner THEN
            'INCOHERENCIA: hay fila activa en platform.owners pero '
            'core.is_platform_owner() devuelve false. Revisar la funcion, no los datos.'
        ELSE
            'OK: Platform Owner activo. /auth/me debe entregar los '
            || v_permisos || ' permisos de alcance plataforma. Si la interfaz sigue '
            'diciendo «sin permiso», el proceso del backend esta sirviendo codigo '
            'anterior al modulo: reinicialo.'
    END;

    RETURN QUERY SELECT v_auth, v_user, v_email, coalesce(v_activo, false),
                        coalesce(v_fila, false), v_revocada, v_owner,
                        v_permisos, v_total, v_ver;
END
$$;

COMMENT ON FUNCTION core.my_platform_access() IS
    'Autodiagnostico de la cadena de Platform Owner para el usuario actual. No concede nada. De los demas owners solo publica un recuento.';

GRANT EXECUTE ON FUNCTION core.my_platform_access() TO authenticated, olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    d          record;
    v_auth     uuid;
    v_definer  boolean;
BEGIN
    SELECT p.prosecdef INTO v_definer
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'my_platform_access';
    IF NOT coalesce(v_definer, false) THEN
        RAISE EXCEPTION 'core.my_platform_access() debe ser SECURITY DEFINER';
    END IF;

    -- Sin contexto debe explicar la ausencia de identidad, no callar ni fallar.
    PERFORM set_config('app.auth_user_id', '', true);
    SELECT * INTO d FROM core.my_platform_access();
    IF d.veredicto NOT LIKE 'SIN CONTEXTO%' THEN
        RAISE EXCEPTION 'sin identidad el veredicto debia ser SIN CONTEXTO, fue: %', d.veredicto;
    END IF;
    IF d.es_platform_owner THEN
        RAISE EXCEPTION 'sin identidad es_platform_owner debe ser false';
    END IF;
    RAISE NOTICE 'OK: sin contexto -> %', left(d.veredicto, 60);

    -- Y con el contexto de un owner activo debe confirmarlo.
    SELECT u.auth_id INTO v_auth
      FROM platform.owners o JOIN core.users u ON u.id = o.user_id
     WHERE o.revoked_at IS NULL
     LIMIT 1;

    IF v_auth IS NULL THEN
        RAISE WARNING
            'AVISO 0046: no hay ningun owner activo en este entorno. La comprobacion '
            'positiva no pudo ejecutarse, y ese es exactamente el estado ladrillo que '
            'esta funcion existe para delatar.';
    ELSE
        PERFORM set_config('app.auth_user_id', v_auth::text, true);
        SELECT * INTO d FROM core.my_platform_access();
        IF NOT d.es_platform_owner OR d.veredicto NOT LIKE 'OK:%' THEN
            RAISE EXCEPTION 'un owner activo debia dar veredicto OK, dio: %', d.veredicto;
        END IF;
        IF d.permisos_de_plataforma <> 27 THEN
            RAISE WARNING 'se esperaban 27 permisos de plataforma, hay %',
                          d.permisos_de_plataforma;
        END IF;
        RAISE NOTICE 'OK: owner % -> % permisos de plataforma, % owners activos',
                     d.email, d.permisos_de_plataforma, d.total_owners_activos;
    END IF;

    RAISE NOTICE 'OK 0046: autodiagnostico de Platform Owner disponible.';
END
$$;
