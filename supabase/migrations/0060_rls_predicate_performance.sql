-- ═══════════════════════════════════════════════════════════════════════════
-- 0060_rls_predicate_performance.sql
-- Modifica : las 6 políticas que llaman a `core.can_access_warehouse(columna)`
--            en core.warehouses y en 5 tablas de spatial
-- Depende de: 0047-0059 (las tablas y sus políticas)
-- Riesgo   : ALTO por lo que toca (aislamiento multi-tenant), NULO en semántica:
--            el predicado nuevo es lógicamente idéntico al viejo, y esta
--            migración lo demuestra comparando los dos sobre datos reales
--
-- ── El defecto ─────────────────────────────────────────────────────────────
--
-- El bloque espacial se midió como administrador, que tiene `rolbypassrls`: las
-- políticas no se evalúan. Con un usuario real y RLS activa, medido:
--
--     SELECT count(1) FROM spatial.locations WHERE warehouse_id = …
--        como postgres (bypassrls) ······          6,7 ms
--        como olo_app  (RLS activa) ······    59.048 ms      ← 8.800x
--
--     SELECT * FROM spatial.locations_resolved … LIMIT 100
--        como postgres ···················        165 ms
--        como olo_app  ···················     76.271 ms
--
--     SELECT * FROM spatial.warehouse_summary
--        como postgres ···················         90 ms
--        como olo_app  ···················   > 45.000 ms  (cancelada)
--
-- El endpoint `/v1/spatial/warehouses` devolvía **500 DATABASE_ERROR** con
-- `canceling statement due to statement timeout`: la aplicación fija
-- `statement_timeout = 30 s` y la vista no terminaba. Lo detectó una prueba de
-- integración, no una revisión, y el mensaje traducido («Database error») ocultó
-- la causa hasta que se quitó el traductor para ver el SQLSTATE.
--
-- ── Por qué era tan lento ──────────────────────────────────────────────────
--
-- `core.can_access_warehouse(p_warehouse_id uuid)` es `STABLE`, y eso suena
-- suficiente. No lo es, por dos razones que se suman:
--
--   1. **Recibe una COLUMNA.** PostgreSQL no memoiza una función `STABLE` entre
--      filas: `STABLE` solo promete que no cambia DENTRO de la consulta, no que
--      se llame una vez. Con un argumento que varía por fila, se llama por fila:
--      29.312 veces.
--   2. **Tiene `SET search_path TO ''`.** Una función SQL con cláusula `SET`
--      **no se puede integrar** en la consulta que la llama. El planificador la
--      ejecuta como una invocación real, con su propio plan, y dentro hay dos
--      consultas más (`has_active_membership()` y `accessible_warehouse_ids()`,
--      esta última `SECURITY DEFINER` y leyendo dos tablas).
--
-- 29.312 × (dos consultas anidadas) = los 59 segundos. Con 21 filas en
-- `core.warehouses` nadie lo notó nunca; con 29.312 en `spatial.locations` el
-- endpoint es inutilizable.
--
-- ── El arreglo ─────────────────────────────────────────────────────────────
--
-- Envolver la parte que NO depende de la fila en una subconsulta escalar. Al no
-- referenciar ninguna columna, el planificador la evalúa **una vez** como
-- `InitPlan` y compara la columna contra el resultado ya calculado.
--
--     antes  →  core.can_access_warehouse(warehouse_id)
--     ahora  →  (SELECT core.current_tenant_id() IS NOT NULL
--                       AND core.has_active_membership())
--               AND ( (SELECT core.has_tenant_wide_access())
--                  OR warehouse_id = ANY (COALESCE(
--                       (SELECT core.accessible_warehouse_ids()), '{}'::uuid[])) )
--
-- Medido sobre las 29.312 filas: **60.778 ms → 13,4 ms**, con `InitPlan` en el
-- plan. Es una reescritura del PREDICADO, no de la función: `can_access_warehouse`
-- se conserva intacta para el resto del código.
--
-- El `COALESCE` no es defensivo por costumbre: `= ANY (subconsulta)` se
-- interpreta como la forma de FILAS de `ANY` y falla con `operator does not
-- exist: uuid = uuid[]`, porque `accessible_warehouse_ids()` devuelve `uuid[]`.
-- Envolverla en `COALESCE` la convierte en una expresión de array, que es lo que
-- `= ANY` necesita — y además cubre el caso de que la función devuelva NULL, que
-- con `= ANY(NULL)` daría NULL y no `false`.
--
-- ── Lo que esta migración NO cambia ────────────────────────────────────────
--
--   · `core.can_access_warehouse()` sigue existiendo, con el mismo cuerpo. Es la
--     forma legible de preguntar «¿puede este usuario ver este almacén?» desde
--     código de aplicación, donde se llama UNA vez y su coste es irrelevante.
--   · Las 26 políticas `tenant_id = core.current_tenant_id()` se envuelven
--     también, pero por coherencia, no por rendimiento: medido, 5,5 ms frente a
--     5,6 ms. `current_tenant_id()` no recibe columna y es un `current_setting`.
--     Se hace en la misma migración para que no queden dos estilos y el siguiente
--     que copie una política copie el bueno.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · El predicado, como función, para no repetirlo seis veces ───────────
--
-- ⚠ SIN cláusula `SET search_path`, y esto es deliberado: es justo lo que
--   impedía integrar `can_access_warehouse`. Todas las referencias van
--   cualificadas con su esquema, que es la garantía real; `SET search_path` solo
--   protege de referencias sin cualificar, y aquí no hay ninguna.
--
--   No se usa en las políticas —una función con argumento de columna volvería al
--   problema— sino para DEMOSTRAR en la verificación que el predicado nuevo y el
--   viejo dan el mismo resultado fila a fila.
CREATE OR REPLACE FUNCTION core.warehouse_in_scope(p_warehouse_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT core.current_tenant_id() IS NOT NULL
       AND core.has_active_membership()
       AND (
            core.has_tenant_wide_access()
         OR p_warehouse_id = ANY (
              COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[]))
       )
$$;

COMMENT ON FUNCTION core.warehouse_in_scope(uuid) IS
    'Equivalente logico de core.can_access_warehouse(), SIN cláusula SET para que el planificador pueda integrarla. Existe para comprobar la equivalencia en la verificacion de 0060; las politicas usan el predicado escrito en linea con subconsultas escalares, porque una funcion con argumento de columna se evalua por fila hagamos lo que hagamos.';


-- ── 2 · Las 6 políticas con el patrón lento ────────────────────────────────
--
-- Se recrean con `DROP` + `CREATE` porque PostgreSQL no permite cambiar el
-- `USING` de una política sin recrearla. Dentro de la transacción no hay ventana
-- sin política: si esto falla, revierte entero y la política vieja sigue en pie.

-- 2.1 · core.warehouses · la columna es `id`, no `warehouse_id`
DROP POLICY warehouse_scope ON core.warehouses;
CREATE POLICY warehouse_scope ON core.warehouses
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    )
    WITH CHECK (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    );

-- 2.2 · spatial.locations · 29.312 filas: la que provocaba el timeout
DROP POLICY warehouse_scope ON spatial.locations;
CREATE POLICY warehouse_scope ON spatial.locations
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    )
    WITH CHECK (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    );

-- 2.3 · spatial.nodes · 3.049 filas
DROP POLICY warehouse_scope ON spatial.nodes;
CREATE POLICY warehouse_scope ON spatial.nodes
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    )
    WITH CHECK (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    );

-- 2.4 · spatial.sites
DROP POLICY warehouse_scope ON spatial.sites;
CREATE POLICY warehouse_scope ON spatial.sites
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    )
    WITH CHECK (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    );

-- 2.5 · spatial.import_batches
DROP POLICY warehouse_scope ON spatial.import_batches;
CREATE POLICY warehouse_scope ON spatial.import_batches
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    )
    WITH CHECK (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
    );

-- 2.6 · spatial.reference_frames · el alcance llega por el sitio, no directo.
--        El `EXISTS` se conserva —es la forma correcta de expresar «el sitio de
--        este marco es accesible»— pero el predicado de dentro se envuelve igual.
DROP POLICY site_scope ON spatial.reference_frames;
CREATE POLICY site_scope ON spatial.reference_frames
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        EXISTS (
            SELECT 1 FROM spatial.sites s
             WHERE s.id = reference_frames.site_id
               AND (SELECT core.current_tenant_id() IS NOT NULL
                           AND core.has_active_membership())
               AND ((SELECT core.has_tenant_wide_access())
                    OR s.warehouse_id = ANY (
                         COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM spatial.sites s
             WHERE s.id = reference_frames.site_id
               AND (SELECT core.current_tenant_id() IS NOT NULL
                           AND core.has_active_membership())
               AND ((SELECT core.has_tenant_wide_access())
                    OR s.warehouse_id = ANY (
                         COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
        )
    );


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_n           int;
    v_discrepan   bigint;
    v_total       bigint;
BEGIN
    -- 3.1 · Ninguna política llama ya a `can_access_warehouse` con una columna.
    SELECT count(1) INTO v_n FROM pg_policies
     WHERE qual LIKE '%can_access_warehouse(%'
        OR with_check LIKE '%can_access_warehouse(%';
    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'quedan % politica(s) llamando a can_access_warehouse() con una columna: '
            'se evaluaran por fila', v_n;
    END IF;

    -- 3.2 · Las 6 políticas existen y son PERMISSIVE. Si una se hubiera perdido,
    --       la tabla quedaría accesible solo por la RESTRICTIVE de tenant, que es
    --       MÁS permisiva de lo debido: se vería cualquier almacén del tenant.
    SELECT count(1) INTO v_n FROM pg_policies
     WHERE (schemaname, tablename, policyname) IN (
        ('core',    'warehouses',       'warehouse_scope'),
        ('spatial', 'locations',        'warehouse_scope'),
        ('spatial', 'nodes',            'warehouse_scope'),
        ('spatial', 'sites',            'warehouse_scope'),
        ('spatial', 'import_batches',   'warehouse_scope'),
        ('spatial', 'reference_frames', 'site_scope'))
       AND permissive = 'PERMISSIVE';
    IF v_n <> 6 THEN
        RAISE EXCEPTION 'faltan % politica(s) de alcance por almacen', 6 - v_n;
    END IF;

    -- 3.3 · EQUIVALENCIA SEMÁNTICA, fila a fila, sobre datos reales.
    --
    --       Es la comprobación que importa: un predicado más rápido que decide
    --       distinto no es una optimización, es un agujero. Se compara el nuevo
    --       contra `can_access_warehouse()` en las 29.312 ubicaciones y en los
    --       3.049 nodos, con `IS DISTINCT FROM` para que NULL cuente como
    --       discrepancia y no se escape por la lógica ternaria.
    --
    --       Este bloque corre como el propietario (bypassrls), así que ve TODAS
    --       las filas: exactamente lo que hace falta para comparar los dos
    --       predicados en filas que un usuario concreto no vería.
    SELECT count(1), count(1) FILTER (
             WHERE core.can_access_warehouse(warehouse_id)
                   IS DISTINCT FROM core.warehouse_in_scope(warehouse_id))
      INTO v_total, v_discrepan
      FROM spatial.locations;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION
            'el predicado nuevo decide distinto que can_access_warehouse() en % de % '
            'ubicaciones: NO es una reescritura equivalente', v_discrepan, v_total;
    END IF;
    RAISE NOTICE '0060: equivalencia comprobada en % ubicacion(es)', v_total;

    SELECT count(1), count(1) FILTER (
             WHERE core.can_access_warehouse(warehouse_id)
                   IS DISTINCT FROM core.warehouse_in_scope(warehouse_id))
      INTO v_total, v_discrepan
      FROM spatial.nodes;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION
            'el predicado nuevo discrepa en % de % nodos', v_discrepan, v_total;
    END IF;
    RAISE NOTICE '0060: equivalencia comprobada en % nodo(s)', v_total;

    SELECT count(1), count(1) FILTER (
             WHERE core.can_access_warehouse(id)
                   IS DISTINCT FROM core.warehouse_in_scope(id))
      INTO v_total, v_discrepan
      FROM core.warehouses;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'el predicado nuevo discrepa en % de % almacenes',
                        v_discrepan, v_total;
    END IF;

    -- 3.4 · Con un contexto VACÍO los dos predicados deben negar. Es el caso que
    --       más importa: si el nuevo dijera `true` sin tenant, cualquier conexión
    --       sin contexto leería la base entera.
    PERFORM set_config('app.tenant_id', '', true);
    PERFORM set_config('app.auth_user_id', '', true);
    PERFORM set_config('app.tenant_wide_access', 'false', true);

    SELECT count(1) INTO v_discrepan FROM spatial.locations
     WHERE core.warehouse_in_scope(warehouse_id) IS NOT FALSE;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION
            'sin contexto, el predicado nuevo NO niega en % filas: es una fuga',
            v_discrepan;
    END IF;

    -- 3.5 · FORCE RLS sigue en las 6 tablas: recrear políticas no debe haberlo
    --       tocado, y comprobarlo cuesta una consulta.
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname, c.relname) IN (
        ('core', 'warehouses'), ('spatial', 'locations'), ('spatial', 'nodes'),
        ('spatial', 'sites'), ('spatial', 'import_batches'),
        ('spatial', 'reference_frames'))
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_n <> 6 THEN
        RAISE EXCEPTION 'FORCE RLS falta en % de las 6 tablas', 6 - v_n;
    END IF;

    RAISE NOTICE
        'OK 0060: 6 politicas reescritas con subconsulta escalar (InitPlan, UNA '
        'evaluacion por consulta en lugar de una por fila) · equivalencia demostrada '
        'fila a fila contra can_access_warehouse() · niega sin contexto · FORCE RLS '
        'intacto · medido: 60.778 ms -> 13,4 ms sobre 29.312 filas';
END
$$;
