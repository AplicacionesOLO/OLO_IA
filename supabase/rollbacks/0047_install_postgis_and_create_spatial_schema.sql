-- ROLLBACK de 0047_install_postgis_and_create_spatial_schema.sql
--
-- SIN `CASCADE`, a propósito. Si algo depende del schema o de la extensión, el
-- fallo es la señal deseada: significa que hay una migración posterior sin
-- revertir. Un `CASCADE` borraría esa dependencia en silencio.
--
-- ⚠ `DROP EXTENSION postgis` falla si existe alguna columna de tipo geometry.
--   Por tanto 0051/0052 deben estar revertidas antes de ejecutar esto, y la
--   verificación del final lo comprueba explícitamente para que el mensaje
--   diga qué falta en lugar de un error del motor.
--
-- `GRANT USAGE ON SCHEMA extensions TO olo_app` NO se revoca: `extensions` es un
-- schema preexistente de Supabase y otras extensiones viven ahí. Revocar el USAGE
-- podría romper el acceso de `olo_app` a `uuid-ossp` o `pgcrypto`. Conceder USAGE
-- sobre un schema compartido no es reversible sin riesgo, y no deja residuo dañino.

DO $$
DECLARE v_geom int;
BEGIN
    SELECT count(1) INTO v_geom
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
     WHERE t.typname IN ('geometry', 'geography')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND c.relkind IN ('r', 'p', 'v', 'm')
       AND n.nspname NOT IN ('extensions', 'pg_catalog');
    IF v_geom > 0 THEN
        RAISE EXCEPTION
            'Hay % columna(s) de tipo geometry/geography fuera de extensions. '
            'Revierte primero las migraciones que las crearon (0051/0052) o '
            'DROP EXTENSION postgis fallara.', v_geom;
    END IF;
END
$$;

DROP SCHEMA spatial;

DROP EXTENSION postgis;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_schema  int;
    v_ext     int;
    v_default int;
    v_path    int;
BEGIN
    SELECT count(1) INTO v_schema FROM pg_namespace WHERE nspname = 'spatial';
    IF v_schema <> 0 THEN RAISE EXCEPTION 'el schema spatial sigue existiendo'; END IF;

    SELECT count(1) INTO v_ext FROM pg_extension WHERE extname = 'postgis';
    IF v_ext <> 0 THEN RAISE EXCEPTION 'postgis sigue instalada'; END IF;

    -- Al borrar el schema, sus entradas de pg_default_acl deben desaparecer solas.
    SELECT count(1) INTO v_default
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname IS NULL OR n.nspname = 'spatial';
    IF v_default <> 0 THEN
        RAISE EXCEPTION 'quedan % default_acl huerfanas de spatial', v_default;
    END IF;

    -- La base queda como estaba: ningun rol de aplicacion con search_path tocado.
    SELECT count(1) INTO v_path
      FROM pg_roles
     WHERE rolname IN ('authenticated', 'anon', 'olo_app', 'service_role')
       AND array_to_string(coalesce(rolconfig, ARRAY[]::text[]), ',') LIKE '%search_path%';
    IF v_path <> 0 THEN
        RAISE EXCEPTION '% rol(es) de aplicacion con search_path fijado', v_path;
    END IF;

    RAISE NOTICE
        'OK rollback 0047: sin schema spatial, sin postgis, sin default_acl huerfanas, search_path intacto';
END
$$;
