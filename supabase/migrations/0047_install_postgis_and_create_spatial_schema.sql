-- ═══════════════════════════════════════════════════════════════════════════
-- 0047_install_postgis_and_create_spatial_schema.sql
-- Crea     : extensión postgis en `extensions`, schema `spatial`, privilegios
-- Tablas   : ninguna
-- Depende de: 0002 (rol olo_app)
-- Riesgo   : bajo · reversible
--
-- `spatial` es el dominio del ESPACIO FÍSICO, en régimen TENANT con alcance de
-- almacén. Es el hogar reservado por ADR-008 y detallado en ADR-010.
--
-- POR QUÉ POSTGIS SE INSTALA AHORA Y EN `extensions`
--
--   `postgis` es **relocatable = false**: no existe `ALTER EXTENSION ... SET
--   SCHEMA`, así que el schema elegido aquí es PERMANENTE. Se elige `extensions`
--   porque es donde ya viven `pgcrypto`, `uuid-ossp` y `pg_stat_statements`, y es
--   la convención de Supabase.
--
--   Se instala en el Bloque 3 aunque las geometrías queden vacías, porque
--   instalarlo después sobre una base con millones de filas es una operación con
--   parada; hoy la base está pequeña.
--
-- ⚠ CONSECUENCIA MEDIDA: `extensions` NO está en el `search_path` de
--   `authenticated` ni de `olo_app` — solo `postgres` lo tiene. Por tanto TODA
--   referencia a PostGIS desde código de aplicación, desde una política RLS o desde
--   una función con `SET search_path = ''` debe ir CUALIFICADA:
--
--       extensions.geometry        extensions.ST_MakePoint(...)
--
--   Es la invariante PLT-12. La verificación de esta migración la demuestra en
--   vivo: comprueba que la forma cualificada resuelve y que la desnuda NO, con el
--   search_path vacío. No se modifica el `search_path` de ningún rol: los de
--   Supabase son gestionados por la plataforma y cambiarlos afectaría a PostgREST.
--
-- ⚠ `FOR ROLE postgres` es imprescindible, igual que en 0019 y 0031. `ALTER
--   DEFAULT PRIVILEGES` solo afecta a objetos futuros creados por el rol indicado;
--   las migraciones corren como `postgres`, así que sin la cláusula las tablas de
--   0048+ nacerían sin permisos para `olo_app` y todo fallaría con 42501.
--
-- NOTA PARA test_rls_coverage: PostGIS crea `extensions.spatial_ref_sys`, una
--   tabla propiedad de la extensión y SIN RLS. No es una tabla de dominio y la
--   invariante PLT-01 no aplica: la prueba debe excluir las tablas cuyo
--   propietario es una extensión.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;


CREATE SCHEMA spatial;

COMMENT ON SCHEMA spatial IS
    'Dominio del ESPACIO FISICO: sitios, arbol de nodos, ubicaciones, marcos de referencia y geometria del gemelo digital. Regimen TENANT con alcance de almacen. NUNCA referencia wms (ADR-009 R3): un estante existe aunque hoy no tenga nada encima.';

GRANT USAGE ON SCHEMA spatial TO olo_app;

-- Necesario para PLT-12: sin USAGE sobre `extensions`, `olo_app` no puede llamar
-- a una funcion de PostGIS ni siquiera cualificandola.
GRANT USAGE ON SCHEMA extensions TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA spatial
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA spatial
    GRANT USAGE, SELECT ON SEQUENCES TO olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pg_schema   text;
    v_pg_version  text;
    v_usage       boolean;
    v_create      boolean;
    v_ext_usage   boolean;
    v_default     int;
    v_path_roles  int;
    v_wkt         text;
    v_desnuda_fallo boolean := false;
BEGIN
    -- 1 · postgis instalado, y en `extensions`
    SELECT n.nspname, e.extversion INTO v_pg_schema, v_pg_version
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'postgis';
    IF v_pg_schema IS NULL THEN
        RAISE EXCEPTION 'postgis no quedo instalada';
    END IF;
    IF v_pg_schema <> 'extensions' THEN
        RAISE EXCEPTION
            'postgis quedo en el schema %, se esperaba extensions. Y NO es reubicable: '
            'hay que desinstalarla y volver a instalarla', v_pg_schema;
    END IF;

    -- 2 · schema spatial con los privilegios correctos
    SELECT has_schema_privilege('olo_app', 'spatial', 'USAGE'),
           has_schema_privilege('olo_app', 'spatial', 'CREATE'),
           has_schema_privilege('olo_app', 'extensions', 'USAGE')
      INTO v_usage, v_create, v_ext_usage;
    IF NOT v_usage     THEN RAISE EXCEPTION 'olo_app necesita USAGE sobre spatial'; END IF;
    IF v_create        THEN RAISE EXCEPTION 'olo_app NO debe tener CREATE sobre spatial'; END IF;
    IF NOT v_ext_usage THEN RAISE EXCEPTION 'olo_app necesita USAGE sobre extensions (PLT-12)'; END IF;

    SELECT count(1) INTO v_default
      FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'spatial' AND d.defaclrole = 'postgres'::regrole;
    IF v_default = 0 THEN
        RAISE EXCEPTION 'no hay default privileges de postgres en spatial';
    END IF;

    -- 3 · el search_path NO se ha tocado. Solo `postgres` debe tenerlo fijado;
    --     si apareciera en authenticated, anon u olo_app seria un efecto lateral
    --     de esta migracion sobre roles gestionados por Supabase.
    SELECT count(1) INTO v_path_roles
      FROM pg_roles
     WHERE rolname IN ('authenticated', 'anon', 'olo_app', 'service_role')
       AND array_to_string(coalesce(rolconfig, ARRAY[]::text[]), ',') LIKE '%search_path%';
    IF v_path_roles <> 0 THEN
        RAISE EXCEPTION
            '% rol(es) de aplicacion tienen search_path fijado. Esta migracion no debe '
            'modificarlo (PLT-12: se cualifica, no se cambia el rol)', v_path_roles;
    END IF;

    -- 4 · PRUEBA VIVA de la premisa de PLT-12, con el search_path VACIO, que es la
    --     condicion en la que corren todas las funciones SECURITY DEFINER de este
    --     proyecto. Verificar que postgis existe no demuestra que sea usable ahi.
    PERFORM set_config('search_path', '', true);

    BEGIN
        SELECT extensions.ST_AsText(extensions.ST_MakePoint(1, 2, 3)) INTO v_wkt;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION
            'extensions.ST_MakePoint no resuelve con search_path vacio: % (%). '
            'Sin esto, ninguna funcion SECURITY DEFINER podria tocar geometria',
            SQLERRM, SQLSTATE;
    END;
    IF v_wkt IS NULL THEN
        RAISE EXCEPTION 'la llamada cualificada devolvio NULL';
    END IF;

    -- El tipo, ademas de las funciones.
    PERFORM CAST(NULL AS extensions.geometry);

    -- Y la forma DESNUDA debe fallar: es lo que hace obligatoria la invariante.
    BEGIN
        PERFORM ST_MakePoint(1, 2);
    EXCEPTION WHEN undefined_function THEN
        v_desnuda_fallo := true;
    END;

    PERFORM set_config('search_path', '"$user", public, extensions', true);

    IF NOT v_desnuda_fallo THEN
        RAISE WARNING
            'ST_MakePoint SIN cualificar resolvio con search_path vacio. PLT-12 sigue '
            'siendo obligatoria por los roles de aplicacion, pero esta comprobacion '
            'ya no la demuestra: revisar si algo anadio extensions a un search_path';
    END IF;

    RAISE NOTICE
        'OK 0047: postgis % en extensions · schema spatial (usage=si create=no) · '
        '% entradas de default_acl · search_path intacto · cualificado=% desnudo_falla=%',
        v_pg_version, v_default, v_wkt, v_desnuda_fallo;
END
$$;
