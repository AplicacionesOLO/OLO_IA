-- ═══════════════════════════════════════════════════════════════════════════
-- 0048_move_areas_locations_to_spatial_rollback.sql
-- Revierte : 0048 · devuelve las tablas a `core`
--
-- `ALTER TABLE ... SET SCHEMA` es simétrico: **los OID no cambian y las filas no
-- se reescriben**, así que la vuelta es exacta y demostrable comparando OID y
-- huella antes y después — el mismo mecanismo que usó 0048 en el otro sentido.
--
-- ⚠ Cuál de las dos tablas se mueve depende de si 0051 se revirtió ya:
--     · con 0051 revertida  → existen `spatial.areas` y `spatial.locations`
--     · sin revertir        → `spatial.areas` no existe (0051 la eliminó)
--   Se mueve lo que haya, y se dice qué se movió. Un rollback que asuma un estado
--   intermedio concreto falla justo cuando hace falta.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_oid_a_pre  oid;  v_oid_l_pre  oid;
    v_oid_a_post oid;  v_oid_l_post oid;
    v_n_a int := 0;    v_n_l int := 0;
    v_fp_a_pre text := ''; v_fp_l_pre text := '';
    v_fp_a_post text := ''; v_fp_l_post text := '';
    v_hay_areas boolean;
    v_hay_locs  boolean;
BEGIN
    v_hay_areas := to_regclass('spatial.areas')     IS NOT NULL;
    v_hay_locs  := to_regclass('spatial.locations')  IS NOT NULL;

    IF NOT v_hay_areas AND NOT v_hay_locs THEN
        RAISE EXCEPTION 'no hay nada que mover: ni spatial.areas ni spatial.locations';
    END IF;

    -- ── Huella ANTES ───────────────────────────────────────────────────────
    IF v_hay_areas THEN
        v_oid_a_pre := 'spatial.areas'::regclass;
        EXECUTE 'SELECT count(1), md5(coalesce(string_agg(to_jsonb(a)::text, ''|'' '
                'ORDER BY a.id), '''')) FROM spatial.areas a'
           INTO v_n_a, v_fp_a_pre;
    END IF;
    IF v_hay_locs THEN
        v_oid_l_pre := 'spatial.locations'::regclass;
        EXECUTE 'SELECT count(1), md5(coalesce(string_agg(to_jsonb(l)::text, ''|'' '
                'ORDER BY l.id), '''')) FROM spatial.locations l'
           INTO v_n_l, v_fp_l_pre;
    END IF;
    RAISE NOTICE 'ANTES  areas oid=% filas=% huella=%', v_oid_a_pre, v_n_a, v_fp_a_pre;
    RAISE NOTICE 'ANTES  locs  oid=% filas=% huella=%', v_oid_l_pre, v_n_l, v_fp_l_pre;

    -- ── El movimiento ──────────────────────────────────────────────────────
    IF v_hay_locs THEN
        EXECUTE 'ALTER TABLE spatial.locations SET SCHEMA core';
    END IF;
    IF v_hay_areas THEN
        EXECUTE 'ALTER TABLE spatial.areas SET SCHEMA core';
    END IF;

    -- ── Huella DESPUÉS: tiene que ser IDÉNTICA, y el OID también ───────────
    IF v_hay_areas THEN
        v_oid_a_post := 'core.areas'::regclass;
        EXECUTE 'SELECT md5(coalesce(string_agg(to_jsonb(a)::text, ''|'' '
                'ORDER BY a.id), '''')) FROM core.areas a' INTO v_fp_a_post;
        IF v_oid_a_post <> v_oid_a_pre THEN
            RAISE EXCEPTION 'el OID de areas cambio: % -> %. SET SCHEMA no deberia '
                            'reescribir la tabla', v_oid_a_pre, v_oid_a_post;
        END IF;
        IF v_fp_a_post <> v_fp_a_pre THEN
            RAISE EXCEPTION 'la huella de areas cambio: % -> %', v_fp_a_pre, v_fp_a_post;
        END IF;
    END IF;
    IF v_hay_locs THEN
        v_oid_l_post := 'core.locations'::regclass;
        EXECUTE 'SELECT md5(coalesce(string_agg(to_jsonb(l)::text, ''|'' '
                'ORDER BY l.id), '''')) FROM core.locations l' INTO v_fp_l_post;
        IF v_oid_l_post <> v_oid_l_pre THEN
            RAISE EXCEPTION 'el OID de locations cambio: % -> %',
                            v_oid_l_pre, v_oid_l_post;
        END IF;
        IF v_fp_l_post <> v_fp_l_pre THEN
            RAISE EXCEPTION 'la huella de locations cambio: % -> %',
                            v_fp_l_pre, v_fp_l_post;
        END IF;
    END IF;

    -- `%%` es un porcentaje LITERAL en PL/pgSQL y no consume argumento: con dos
    -- argumentos y dos `%%` el RAISE falla con «too many parameters». Lo detuvo la
    -- prueba de la cadena completa en transaccion abortada.
    RAISE NOTICE
        'OK rollback 0048: % areas y % locations de vuelta en `core` · OID y huella '
        'IDENTICOS (SET SCHEMA no reescribe filas)',
        CASE WHEN v_hay_areas THEN v_n_a::text ELSE 'sin' END,
        CASE WHEN v_hay_locs  THEN v_n_l::text ELSE 'sin' END;
END
$$;
