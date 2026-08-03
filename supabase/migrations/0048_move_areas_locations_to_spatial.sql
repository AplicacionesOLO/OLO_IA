-- ═══════════════════════════════════════════════════════════════════════════
-- 0048_move_areas_locations_to_spatial.sql
-- Mueve    : core.areas → spatial.areas · core.locations → spatial.locations
-- Depende de: 0012 (crea las tablas), 0015 (sus políticas), 0047 (schema spatial)
-- Riesgo   : ALTO · es la única migración de este bloque que mueve DATOS
--
-- `core.warehouses` NO se mueve: es la frontera de permisos. `core.role_assignments`,
-- `core.user_warehouse_access` y `core.can_access_warehouse()` dependen de ella, y
-- moverla rompería la autorización (ADR-009 §6).
--
-- MECANISMO: `ALTER TABLE ... SET SCHEMA`, el mismo de la migración 0033, donde se
-- verificó que políticas, triggers, índices, constraints y ACL viajan con la tabla.
-- **Los OID no cambian y las filas no se reescriben**, así que la garantía de «sin
-- pérdida de IDs» es del mecanismo, no del cuidado. Esta migración lo demuestra
-- comparando OID y huella antes y después.
--
-- DEPENDENCIAS MEDIDAS ANTES DE ESCRIBIR ESTO
--
--   FK entrantes desde otras tablas ... 1 (fk_loc_area, interna)
--   Funciones que las citan .......... 0
--   Vistas / vistas materializadas ... 0
--   Secuencias ....................... 0  (las PK son uuid, no serial)
--   Comentarios ...................... 1  (en fk_loc_area, viaja con la constraint)
--   Índices .......................... 12 (5 areas + 7 locations, 3 parciales)
--   Triggers ......................... 4  (a core.set_updated_at / core.prevent_tenant_change)
--   Políticas RLS .................... 4  (2 por tabla)
--   Código de aplicación ............. 2 sitios, actualizados en el mismo bloque:
--                                        backend/src/olo/repositories/warehouse.py
--                                        supabase/seed.sql
--
-- LO QUE NO HACE FALTA CORREGIR, Y POR QUÉ
--
--   · Los 4 triggers apuntan a funciones que se quedan en `core`. `pg_trigger`
--     guarda el OID de la función, no su nombre cualificado, así que siguen
--     resolviendo sin tocarlos.
--   · Las 4 políticas invocan `core.current_tenant_id()` y
--     `core.can_access_warehouse()`, ambas en `core` y con nombre cualificado en el
--     cuerpo de la política. Viajan con la tabla y siguen apuntando bien.
--   · `fk_area_warehouse` y `areas_tenant_id_fkey` pasan a ser FK ENTRE SCHEMAS
--     (`spatial` → `core`). PostgreSQL las mantiene sin intervención.
--
-- NO SE CREAN VISTAS DE COMPATIBILIDAD `core.areas` / `core.locations`. Una vista
-- con ese nombre seguiría en el esquema y el código nuevo la usaría, que es el
-- segundo camino a la misma verdad que la decisión D2 prohíbe. Las 2 referencias de
-- código se actualizan en su lugar.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    -- Estado ANTES
    v_oid_a_pre    oid;
    v_oid_l_pre    oid;
    v_n_a_pre      int;
    v_n_l_pre      int;
    v_fp_a_pre     text;
    v_fp_l_pre     text;
    v_fp_join_pre  text;
    v_acl_a_pre    text;
    v_acl_l_pre    text;
    -- Estado DESPUÉS
    v_oid_a_post   oid;
    v_oid_l_post   oid;
    v_n_a_post     int;
    v_n_l_post     int;
    v_fp_a_post    text;
    v_fp_l_post    text;
    v_fp_join_post text;
    v_acl_a_post   text;
    v_acl_l_post   text;
    -- Inventario de dependencias
    v_idx          int;
    v_trg          int;
    v_pol          int;
    v_pol_restr    int;
    v_con          int;
    v_force_a      boolean;
    v_force_l      boolean;
    v_owner_a      text;
    v_owner_l      text;
    v_resto        int;
BEGIN
    -- ── 1 · HUELLA ANTES ───────────────────────────────────────────────────
    -- Sobre la fila COMPLETA en jsonb: si cambiara un solo valor de una sola
    -- columna, la huella cambiaría. Ordenado por id para ser determinista.
    SELECT 'core.areas'::regclass, 'core.locations'::regclass
      INTO v_oid_a_pre, v_oid_l_pre;

    SELECT count(1), md5(coalesce(string_agg(to_jsonb(a)::text, '|' ORDER BY a.id), ''))
      INTO v_n_a_pre, v_fp_a_pre FROM core.areas a;

    SELECT count(1), md5(coalesce(string_agg(to_jsonb(l)::text, '|' ORDER BY l.id), ''))
      INTO v_n_l_pre, v_fp_l_pre FROM core.locations l;

    -- Huella del JOIN completo: demuestra que la jerarquía sigue enlazando igual,
    -- no solo que las filas existen por separado.
    SELECT md5(coalesce(string_agg(f, '|' ORDER BY f), '')) INTO v_fp_join_pre
      FROM (
        SELECT w.id::text || ';' || w.code || ';' ||
               a.id::text || ';' || a.code || ';' ||
               l.id::text || ';' || l.code AS f
          FROM core.warehouses w
          JOIN core.areas     a ON a.warehouse_id = w.id AND a.tenant_id = w.tenant_id
          JOIN core.locations l ON l.area_id      = a.id AND l.tenant_id = a.tenant_id
      ) s;

    SELECT c.relacl::text INTO v_acl_a_pre FROM pg_class c WHERE c.oid = v_oid_a_pre;
    SELECT c.relacl::text INTO v_acl_l_pre FROM pg_class c WHERE c.oid = v_oid_l_pre;

    RAISE NOTICE 'ANTES  areas    oid=% filas=% huella=%', v_oid_a_pre, v_n_a_pre, v_fp_a_pre;
    RAISE NOTICE 'ANTES  locations oid=% filas=% huella=%', v_oid_l_pre, v_n_l_pre, v_fp_l_pre;
    RAISE NOTICE 'ANTES  join      huella=%', v_fp_join_pre;

    -- ── 2 · EL TRASLADO ────────────────────────────────────────────────────
    -- `areas` primero: `locations` la referencia con fk_loc_area. El orden no es
    -- obligatorio para SET SCHEMA —la FK sigue válida entre schemas— pero deja el
    -- estado intermedio coherente si algo fallara en medio.
    EXECUTE 'ALTER TABLE core.areas     SET SCHEMA spatial';
    EXECUTE 'ALTER TABLE core.locations SET SCHEMA spatial';

    -- ── 3 · HUELLA DESPUÉS ─────────────────────────────────────────────────
    EXECUTE 'SELECT ''spatial.areas''::regclass'     INTO v_oid_a_post;
    EXECUTE 'SELECT ''spatial.locations''::regclass' INTO v_oid_l_post;

    EXECUTE 'SELECT count(1), md5(coalesce(string_agg(to_jsonb(a)::text, ''|'' ORDER BY a.id), '''')) '
            'FROM spatial.areas a' INTO v_n_a_post, v_fp_a_post;
    EXECUTE 'SELECT count(1), md5(coalesce(string_agg(to_jsonb(l)::text, ''|'' ORDER BY l.id), '''')) '
            'FROM spatial.locations l' INTO v_n_l_post, v_fp_l_post;

    EXECUTE $q$
        SELECT md5(coalesce(string_agg(f, '|' ORDER BY f), '')) FROM (
          SELECT w.id::text || ';' || w.code || ';' ||
                 a.id::text || ';' || a.code || ';' ||
                 l.id::text || ';' || l.code AS f
            FROM core.warehouses     w
            JOIN spatial.areas       a ON a.warehouse_id = w.id AND a.tenant_id = w.tenant_id
            JOIN spatial.locations   l ON l.area_id      = a.id AND l.tenant_id = a.tenant_id
        ) s
    $q$ INTO v_fp_join_post;

    SELECT c.relacl::text INTO v_acl_a_post FROM pg_class c WHERE c.oid = v_oid_a_post;
    SELECT c.relacl::text INTO v_acl_l_post FROM pg_class c WHERE c.oid = v_oid_l_post;

    -- ── 4 · LAS COMPROBACIONES QUE IMPORTAN ────────────────────────────────
    IF v_oid_a_post <> v_oid_a_pre THEN
        RAISE EXCEPTION 'el OID de areas cambio: % -> %. SET SCHEMA no debe recrear la tabla',
                        v_oid_a_pre, v_oid_a_post;
    END IF;
    IF v_oid_l_post <> v_oid_l_pre THEN
        RAISE EXCEPTION 'el OID de locations cambio: % -> %', v_oid_l_pre, v_oid_l_post;
    END IF;

    IF v_n_a_post <> v_n_a_pre OR v_n_l_post <> v_n_l_pre THEN
        RAISE EXCEPTION 'los conteos cambiaron: areas %->% locations %->%',
                        v_n_a_pre, v_n_a_post, v_n_l_pre, v_n_l_post;
    END IF;

    IF v_fp_a_post <> v_fp_a_pre THEN
        RAISE EXCEPTION 'la huella de areas cambio: % -> %', v_fp_a_pre, v_fp_a_post;
    END IF;
    IF v_fp_l_post <> v_fp_l_pre THEN
        RAISE EXCEPTION 'la huella de locations cambio: % -> %', v_fp_l_pre, v_fp_l_post;
    END IF;
    IF v_fp_join_post <> v_fp_join_pre THEN
        RAISE EXCEPTION 'la huella del JOIN cambio: la jerarquia ya no enlaza igual';
    END IF;

    IF v_acl_a_post <> v_acl_a_pre OR v_acl_l_post <> v_acl_l_pre THEN
        RAISE EXCEPTION 'los grants cambiaron. areas: % -> % · locations: % -> %',
                        v_acl_a_pre, v_acl_a_post, v_acl_l_pre, v_acl_l_post;
    END IF;

    -- Las tablas ya NO deben estar en core.
    SELECT count(1) INTO v_resto
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname IN ('areas', 'locations');
    IF v_resto <> 0 THEN
        RAISE EXCEPTION 'quedan % tabla(s) areas/locations en core', v_resto;
    END IF;

    -- ── 5 · LAS DEPENDENCIAS SOBREVIVEN ────────────────────────────────────
    SELECT count(1) INTO v_idx FROM pg_index i
      JOIN pg_class ct ON ct.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'spatial' AND ct.relname IN ('areas', 'locations');
    IF v_idx <> 12 THEN RAISE EXCEPTION 'se esperaban 12 indices, hay %', v_idx; END IF;

    SELECT count(1) INTO v_trg FROM pg_trigger t
      JOIN pg_class ct ON ct.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'spatial' AND ct.relname IN ('areas', 'locations')
       AND NOT t.tgisinternal;
    IF v_trg <> 4 THEN RAISE EXCEPTION 'se esperaban 4 triggers, hay %', v_trg; END IF;

    SELECT count(1), count(1) FILTER (WHERE permissive = 'RESTRICTIVE')
      INTO v_pol, v_pol_restr
      FROM pg_policies WHERE schemaname = 'spatial' AND tablename IN ('areas', 'locations');
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 politicas, hay %', v_pol; END IF;
    IF v_pol_restr <> 2 THEN
        RAISE EXCEPTION 'se esperaban 2 politicas RESTRICTIVE, hay %', v_pol_restr;
    END IF;

    -- PK + UNIQUE + FK: 8 en total, medidas antes de escribir esto.
    SELECT count(1) INTO v_con FROM pg_constraint co
      JOIN pg_class cl ON cl.oid = co.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname = 'spatial' AND cl.relname IN ('areas', 'locations')
       AND co.contype IN ('p', 'u', 'f');
    IF v_con <> 8 THEN RAISE EXCEPTION 'se esperaban 8 constraints p/u/f, hay %', v_con; END IF;

    -- fk_area_warehouse debe seguir apuntando a core.warehouses, entre schemas.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint co
          JOIN pg_class cl ON cl.oid = co.conrelid
          JOIN pg_namespace nl ON nl.oid = cl.relnamespace
          JOIN pg_class cr ON cr.oid = co.confrelid
          JOIN pg_namespace nr ON nr.oid = cr.relnamespace
         WHERE co.conname = 'fk_area_warehouse'
           AND nl.nspname = 'spatial' AND cl.relname = 'areas'
           AND nr.nspname = 'core'    AND cr.relname = 'warehouses'
    ) THEN
        RAISE EXCEPTION 'fk_area_warehouse ya no va de spatial.areas a core.warehouses';
    END IF;

    -- fk_loc_area, la FK TRIPLE, ahora interna a spatial.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint co
          JOIN pg_class cl ON cl.oid = co.conrelid
          JOIN pg_namespace nl ON nl.oid = cl.relnamespace
          JOIN pg_class cr ON cr.oid = co.confrelid
          JOIN pg_namespace nr ON nr.oid = cr.relnamespace
         WHERE co.conname = 'fk_loc_area'
           AND nl.nspname = 'spatial' AND cl.relname = 'locations'
           AND nr.nspname = 'spatial' AND cr.relname = 'areas'
           AND cardinality(co.conkey) = 3
    ) THEN
        RAISE EXCEPTION 'fk_loc_area no es la FK triple entre spatial.locations y spatial.areas';
    END IF;

    -- FORCE RLS sigue activo: sin el, el propietario salta las politicas.
    SELECT c.relforcerowsecurity, pg_get_userbyid(c.relowner)
      INTO v_force_a, v_owner_a FROM pg_class c WHERE c.oid = v_oid_a_post;
    SELECT c.relforcerowsecurity, pg_get_userbyid(c.relowner)
      INTO v_force_l, v_owner_l FROM pg_class c WHERE c.oid = v_oid_l_post;
    IF NOT v_force_a OR NOT v_force_l THEN
        RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY se perdio: areas=% locations=%',
                        v_force_a, v_force_l;
    END IF;
    IF v_owner_a <> 'postgres' OR v_owner_l <> 'postgres' THEN
        RAISE EXCEPTION 'el propietario cambio: areas=% locations=%', v_owner_a, v_owner_l;
    END IF;

    RAISE NOTICE 'DESPUES OID identicos · % + % filas intactas · huellas identicas · '
                 '12 indices · 4 triggers · 4 politicas (2 restrictive) · 8 constraints · '
                 'FORCE RLS activo · owner y grants sin cambio',
                 v_n_a_post, v_n_l_post;
END
$$;


-- ── Documentación del dominio, ahora que las tablas viven en `spatial` ──────
COMMENT ON TABLE spatial.areas IS
    'Areas de almacenamiento. TRASLADADA de core.areas en 0048 conservando OID y filas. Se convierte en spatial.nodes en 0051 y esta tabla se elimina: no escribas codigo nuevo contra ella.';

COMMENT ON TABLE spatial.locations IS
    'Ubicaciones fisicas. TRASLADADA de core.locations en 0048 conservando OID y filas. Unica fuente de verdad espacial (ADR-009 D2). La OCUPACION no vive aqui: es del snapshot de wms (ADR-010 SPA-11).';
