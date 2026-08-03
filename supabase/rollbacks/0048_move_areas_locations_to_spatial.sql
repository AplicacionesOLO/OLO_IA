-- ROLLBACK de 0048_move_areas_locations_to_spatial.sql
--
-- Devuelve las tablas a `core` con el mismo mecanismo y las mismas comprobaciones:
-- OID idéntico, huella idéntica, dependencias intactas. Es el rollback de la única
-- migración del bloque que mueve DATOS, así que verifica lo mismo en la dirección
-- contraria en lugar de dar el `SET SCHEMA` por bueno.
--
-- ⚠ Después de ejecutar esto, el código de aplicación que apunta a `spatial.areas`
--   y `spatial.locations` queda desalineado hasta reaplicar 0048. Es esperado: el
--   código sigue al estado de la migración, no al revés. Los dos sitios son
--   `backend/src/olo/repositories/warehouse.py` y `supabase/seed.sql`.

DO $$
DECLARE
    v_oid_a_pre   oid;  v_oid_l_pre   oid;
    v_n_a_pre     int;  v_n_l_pre     int;
    v_fp_a_pre    text; v_fp_l_pre    text; v_fp_join_pre  text;
    v_acl_a_pre   text; v_acl_l_pre   text;
    v_oid_a_post  oid;  v_oid_l_post  oid;
    v_n_a_post    int;  v_n_l_post    int;
    v_fp_a_post   text; v_fp_l_post   text; v_fp_join_post text;
    v_acl_a_post  text; v_acl_l_post  text;
    v_idx int; v_trg int; v_pol int; v_con int;
    v_force_a boolean; v_force_l boolean;
    v_resto int;
BEGIN
    -- ── Huella ANTES del rollback (estado en spatial) ──────────────────────
    SELECT 'spatial.areas'::regclass, 'spatial.locations'::regclass
      INTO v_oid_a_pre, v_oid_l_pre;

    SELECT count(1), md5(coalesce(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))
      INTO v_n_a_pre, v_fp_a_pre FROM spatial.areas a;
    SELECT count(1), md5(coalesce(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))
      INTO v_n_l_pre, v_fp_l_pre FROM spatial.locations l;

    SELECT md5(coalesce(string_agg(f, '|' ORDER BY f), '')) INTO v_fp_join_pre
      FROM (
        SELECT w.id::text || ';' || w.code || ';' ||
               a.id::text || ';' || a.code || ';' ||
               l.id::text || ';' || l.code AS f
          FROM core.warehouses   w
          JOIN spatial.areas     a ON a.warehouse_id = w.id AND a.tenant_id = w.tenant_id
          JOIN spatial.locations l ON l.area_id      = a.id AND l.tenant_id = a.tenant_id
      ) s;

    SELECT c.relacl::text INTO v_acl_a_pre FROM pg_class c WHERE c.oid = v_oid_a_pre;
    SELECT c.relacl::text INTO v_acl_l_pre FROM pg_class c WHERE c.oid = v_oid_l_pre;

    -- ── El traslado inverso: `locations` primero, orden simétrico ──────────
    EXECUTE 'ALTER TABLE spatial.locations SET SCHEMA core';
    EXECUTE 'ALTER TABLE spatial.areas     SET SCHEMA core';

    -- ── Huella DESPUÉS (estado restaurado en core) ────────────────────────
    EXECUTE 'SELECT ''core.areas''::regclass'     INTO v_oid_a_post;
    EXECUTE 'SELECT ''core.locations''::regclass' INTO v_oid_l_post;

    EXECUTE 'SELECT count(1), md5(coalesce(string_agg(to_jsonb(a)::text, ''|'' ORDER BY a.id), '''')) '
            'FROM core.areas a' INTO v_n_a_post, v_fp_a_post;
    EXECUTE 'SELECT count(1), md5(coalesce(string_agg(to_jsonb(l)::text, ''|'' ORDER BY l.id), '''')) '
            'FROM core.locations l' INTO v_n_l_post, v_fp_l_post;

    EXECUTE $q$
        SELECT md5(coalesce(string_agg(f, '|' ORDER BY f), '')) FROM (
          SELECT w.id::text || ';' || w.code || ';' ||
                 a.id::text || ';' || a.code || ';' ||
                 l.id::text || ';' || l.code AS f
            FROM core.warehouses w
            JOIN core.areas      a ON a.warehouse_id = w.id AND a.tenant_id = w.tenant_id
            JOIN core.locations  l ON l.area_id      = a.id AND l.tenant_id = a.tenant_id
        ) s
    $q$ INTO v_fp_join_post;

    SELECT c.relacl::text INTO v_acl_a_post FROM pg_class c WHERE c.oid = v_oid_a_post;
    SELECT c.relacl::text INTO v_acl_l_post FROM pg_class c WHERE c.oid = v_oid_l_post;

    -- ── Restauración EXACTA ────────────────────────────────────────────────
    IF v_oid_a_post <> v_oid_a_pre OR v_oid_l_post <> v_oid_l_pre THEN
        RAISE EXCEPTION 'los OID cambiaron en el rollback: areas %->% locations %->%',
                        v_oid_a_pre, v_oid_a_post, v_oid_l_pre, v_oid_l_post;
    END IF;
    IF v_n_a_post <> v_n_a_pre OR v_n_l_post <> v_n_l_pre THEN
        RAISE EXCEPTION 'los conteos cambiaron: areas %->% locations %->%',
                        v_n_a_pre, v_n_a_post, v_n_l_pre, v_n_l_post;
    END IF;
    IF v_fp_a_post <> v_fp_a_pre OR v_fp_l_post <> v_fp_l_pre THEN
        RAISE EXCEPTION 'las huellas de fila cambiaron en el rollback';
    END IF;
    IF v_fp_join_post <> v_fp_join_pre THEN
        RAISE EXCEPTION 'la huella del JOIN cambio en el rollback';
    END IF;
    IF v_acl_a_post <> v_acl_a_pre OR v_acl_l_post <> v_acl_l_pre THEN
        RAISE EXCEPTION 'los grants cambiaron en el rollback';
    END IF;

    -- Ya no deben quedar en spatial.
    SELECT count(1) INTO v_resto
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname IN ('areas', 'locations');
    IF v_resto <> 0 THEN
        RAISE EXCEPTION 'quedan % tabla(s) areas/locations en spatial', v_resto;
    END IF;

    -- Y las dependencias siguen enteras en core.
    SELECT count(1) INTO v_idx FROM pg_index i
      JOIN pg_class ct ON ct.oid = i.indrelid JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'core' AND ct.relname IN ('areas', 'locations');
    IF v_idx <> 12 THEN RAISE EXCEPTION 'se esperaban 12 indices en core, hay %', v_idx; END IF;

    SELECT count(1) INTO v_trg FROM pg_trigger t
      JOIN pg_class ct ON ct.oid = t.tgrelid JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'core' AND ct.relname IN ('areas', 'locations') AND NOT t.tgisinternal;
    IF v_trg <> 4 THEN RAISE EXCEPTION 'se esperaban 4 triggers en core, hay %', v_trg; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'core' AND tablename IN ('areas', 'locations');
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 politicas en core, hay %', v_pol; END IF;

    SELECT count(1) INTO v_con FROM pg_constraint co
      JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname = 'core' AND cl.relname IN ('areas', 'locations')
       AND co.contype IN ('p', 'u', 'f');
    IF v_con <> 8 THEN RAISE EXCEPTION 'se esperaban 8 constraints, hay %', v_con; END IF;

    SELECT c.relforcerowsecurity INTO v_force_a FROM pg_class c WHERE c.oid = v_oid_a_post;
    SELECT c.relforcerowsecurity INTO v_force_l FROM pg_class c WHERE c.oid = v_oid_l_post;
    IF NOT v_force_a OR NOT v_force_l THEN
        RAISE EXCEPTION 'FORCE RLS se perdio en el rollback';
    END IF;

    -- fk_loc_area vuelve a ser interna a core, y sigue siendo triple.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint co
          JOIN pg_class cl ON cl.oid = co.conrelid
          JOIN pg_namespace nl ON nl.oid = cl.relnamespace
          JOIN pg_class cr ON cr.oid = co.confrelid
          JOIN pg_namespace nr ON nr.oid = cr.relnamespace
         WHERE co.conname = 'fk_loc_area'
           AND nl.nspname = 'core' AND cl.relname = 'locations'
           AND nr.nspname = 'core' AND cr.relname = 'areas'
           AND cardinality(co.conkey) = 3
    ) THEN
        RAISE EXCEPTION 'fk_loc_area no volvio a ser la FK triple dentro de core';
    END IF;

    RAISE NOTICE
        'OK rollback 0048: areas y locations de vuelta en core · OID % y % intactos · '
        '% + % filas · huellas identicas · 12 indices · 4 triggers · 4 politicas · '
        '8 constraints · FORCE RLS activo · grants sin cambio',
        v_oid_a_post, v_oid_l_post, v_n_a_post, v_n_l_post;
END
$$;

-- Los comentarios de tabla que anadio 0048 desaparecen con el traslado inverso solo
-- si se borran explicitamente: el comentario viaja con la tabla, no con el schema.
COMMENT ON TABLE core.areas     IS NULL;
COMMENT ON TABLE core.locations IS NULL;
