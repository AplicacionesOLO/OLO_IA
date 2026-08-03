-- ═══════════════════════════════════════════════════════════════════════════
-- 0047_install_postgis_and_create_spatial_schema_rollback.sql
-- Revierte : 0047 · el esquema `spatial` y la extensión PostGIS
--
-- ── Dos advertencias que no son formalidades ───────────────────────────────
--
-- 1. **PostGIS es `relocatable = false`.** El esquema de instalación es
--    permanente: si se desinstala y se vuelve a instalar, se puede elegir otro
--    esquema y todas las referencias cualificadas `extensions.geometry` dejarían
--    de resolver. Reinstalar PostGIS **debe** hacerse con
--    `WITH SCHEMA extensions`, igual que 0047.
--
-- 2. **`DROP EXTENSION postgis` con RESTRICT falla si algo la usa**, y eso es
--    deseable: `spatial.locations.world_position` es `extensions.geometry`. Hay
--    que revertir 0052 antes. La comprobación de abajo nombra qué lo usa en lugar
--    de dejar el error genérico de PostgreSQL.
--
-- ⚠ NO se usa CASCADE en ningún caso. `DROP EXTENSION postgis CASCADE` eliminaría
--   en silencio toda columna de tipo geométrico de la base — es exactamente la
--   clase de comodidad que borra datos sin preguntar.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_objetos text; v_tablas text; v_n int;
BEGIN
    -- ¿Queda algo dentro de `spatial`?
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_tablas
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relkind IN ('r', 'v', 'm', 'p');
    IF v_tablas IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede revertir 0047: el esquema `spatial` contiene %. Revierta '
            'primero las migraciones 0048-0060 en orden inverso.', v_tablas;
    END IF;

    -- ¿Alguna columna sigue usando un tipo de PostGIS?
    SELECT string_agg(DISTINCT format('%I.%I.%I', n.nspname, c.relname, a.attname),
                      ', ')
      INTO v_objetos
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t      ON t.oid = a.atttypid
      JOIN pg_namespace tn ON tn.oid = t.typnamespace
     WHERE a.attnum > 0 AND NOT a.attisdropped
       AND c.relkind IN ('r', 'p')
       AND tn.nspname = 'extensions'
       AND t.typname IN ('geometry', 'geography', 'box2d', 'box3d');
    IF v_objetos IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede revertir 0047: % usa(n) tipos de PostGIS. Revierta primero '
            'la migracion que anadio esas columnas (0052 anade world_position).',
            v_objetos;
    END IF;
END
$$;

DROP SCHEMA IF EXISTS spatial RESTRICT;
DROP EXTENSION IF EXISTS postgis RESTRICT;

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_namespace WHERE nspname = 'spatial';
    IF v_n <> 0 THEN RAISE EXCEPTION 'el esquema `spatial` sigue existiendo'; END IF;

    SELECT count(1) INTO v_n FROM pg_extension WHERE extname = 'postgis';
    IF v_n <> 0 THEN RAISE EXCEPTION 'PostGIS sigue instalada'; END IF;

    RAISE WARNING
        'rollback 0047: PostGIS desinstalada. Es `relocatable = false`: al volver a '
        'instalarla hay que usar WITH SCHEMA extensions, o todas las referencias '
        'cualificadas `extensions.ST_*` dejaran de resolver (invariante PLT-12).';

    RAISE NOTICE 'OK rollback 0047: esquema `spatial` y PostGIS eliminados con '
                 'RESTRICT (nunca CASCADE)';
END
$$;
