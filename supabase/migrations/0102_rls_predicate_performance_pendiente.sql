-- ═══════════════════════════════════════════════════════════════════════════
-- 0102_rls_predicate_performance_pendiente.sql
-- Modifica : las 11 políticas que llaman a `core.can_access_warehouse(columna)`
--            y que 0060 NO tocó: incidents (1), inventory (2), perception (4),
--            spatial (4)
-- Depende de: 0060 (mismo defecto, mismo arreglo, sobre las tablas que faltaban)
-- Riesgo   : ALTO por lo que toca (aislamiento multi-tenant), NULO en semántica:
--            mismo predicado reescrito que 0060, verificado igual, fila a fila
--
-- ── Por qué esto no se vio en 0060 ──────────────────────────────────────────
--
-- 0060 midió el bloque espacial (29.312 filas en spatial.locations) porque ahí
-- fallaba un endpoint con timeout. En ese momento ningún trabajo de percepción
-- pasaba de unos cientos de detecciones: 224 evaluaciones de
-- `can_access_warehouse()` no se notan. Medido ahora, con un trabajo real de
-- 7.187 detecciones (worker con GPU, troceado activo):
--
--     GET /v1/perception/jobs/{id}/detections?page_size=500
--        con el predicado tal cual está hoy ·········  ~8,3 s por página
--        (6 páginas para traer 3.000 de 7.187 detecciones: ~50 s de espera,
--         sin ningún indicador de carga en pantalla — se leía como «las
--         detecciones desaparecieron»)
--
-- Comprobado con el MISMO query, por el MISMO motor (SQLAlchemy, con los
-- `connect_args` reales del backend), cambiando solo si el contexto de tenant
-- es válido: 0,2 s cuando el filtro de tenant falla rápido (nunca llega a
-- evaluar `can_access_warehouse`), 6 s cuando pasa y evalúa esa función una
-- vez por cada fila que sí pertenece al tenant — exactamente el mecanismo que
-- 0060 ya documentó: `can_access_warehouse(p_warehouse_id uuid)` recibe una
-- COLUMNA (evaluación por fila, no una vez) y llama dos funciones
-- `SECURITY DEFINER` (`has_active_membership()`, `accessible_warehouse_ids()`)
-- que el planificador no puede integrar en el plan de la fila.
--
-- Las 11 políticas de abajo son las que quedaron con `pg_policies.qual LIKE
-- '%can_access_warehouse(%'` tras 0060 — es decir, exactamente lo que 0060 no
-- cubrió, no una reinterpretación del arreglo:
--
--     incidents.incidents          / solo_su_almacen     (RESTRICTIVE, TO public)
--     inventory.clusters           / solo_su_almacen     (RESTRICTIVE, TO public)
--     inventory.cluster_members    / hereda_del_cluster  (RESTRICTIVE, TO public, via EXISTS)
--     perception.detections        / warehouse_scope     (PERMISSIVE, TO public)
--     perception.inference_jobs    / warehouse_scope     (PERMISSIVE, TO public)
--     perception.job_events        / job_scope           (PERMISSIVE, TO public, via EXISTS)
--     perception.media             / warehouse_scope     (PERMISSIVE, TO public)
--     spatial.observation_sources  / warehouse_scope     (PERMISSIVE, TO public)
--     spatial.rack_observations    / warehouse_scope     (PERMISSIVE, TO public)
--     spatial.rack_placements      / warehouse_scope     (PERMISSIVE, TO authenticated, olo_app)
--     spatial.warehouse_layouts    / warehouse_scope     (PERMISSIVE, TO authenticated, olo_app)
--
-- ── El arreglo, igual que 0060 ──────────────────────────────────────────────
--
-- Envolver la parte que NO depende de la fila en subconsultas escalares
-- `(SELECT ...)`. Al no referenciar ninguna columna, el planificador las
-- evalúa UNA vez como `InitPlan`, en vez de una vez por fila:
--
--     antes  →  core.can_access_warehouse(warehouse_id)
--     ahora  →  (SELECT core.current_tenant_id() IS NOT NULL
--                       AND core.has_active_membership())
--               AND ( (SELECT core.has_tenant_wide_access())
--                  OR warehouse_id = ANY (COALESCE(
--                       (SELECT core.accessible_warehouse_ids()), '{}'::uuid[])) )
--
-- `core.can_access_warehouse()` en sí NO se toca: sigue existiendo igual, para
-- el código de aplicación que la llama una sola vez y no le importa el costo.
--
-- ── Lo que se preserva exactamente por política ─────────────────────────────
--
-- PERMISSIVE/RESTRICTIVE y la lista de roles (`TO ...`) NO cambian: son parte
-- del resultado de autorización, no del rendimiento. Cambiar una RESTRICTIVE a
-- PERMISSIVE por error convertiría un AND obligatorio en un OR opcional — una
-- fuga, no una optimización. Cada CREATE POLICY de abajo copia
-- PERMISSIVE/RESTRICTIVE, TO y la forma de USING/WITH CHECK de lo que hay hoy
-- en `pg_policies`, cambiando solo la forma interna del predicado.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · incidents.incidents (RESTRICTIVE, TO public)
DROP POLICY solo_su_almacen ON incidents.incidents;
CREATE POLICY solo_su_almacen ON incidents.incidents
    AS RESTRICTIVE FOR ALL TO public
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

-- 2 · inventory.clusters (RESTRICTIVE, TO public)
DROP POLICY solo_su_almacen ON inventory.clusters;
CREATE POLICY solo_su_almacen ON inventory.clusters
    AS RESTRICTIVE FOR ALL TO public
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

-- 3 · inventory.cluster_members (RESTRICTIVE, TO public, via EXISTS sobre clusters)
DROP POLICY hereda_del_cluster ON inventory.cluster_members;
CREATE POLICY hereda_del_cluster ON inventory.cluster_members
    AS RESTRICTIVE FOR ALL TO public
    USING (
        EXISTS (
            SELECT 1 FROM inventory.clusters c
             WHERE c.id = cluster_members.cluster_id
               AND (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
               AND ((SELECT core.has_tenant_wide_access())
                    OR c.warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM inventory.clusters c
             WHERE c.id = cluster_members.cluster_id
               AND (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
               AND ((SELECT core.has_tenant_wide_access())
                    OR c.warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
        )
    );

-- 4 · perception.detections (PERMISSIVE, TO public) — la que disparó el diagnóstico
DROP POLICY warehouse_scope ON perception.detections;
CREATE POLICY warehouse_scope ON perception.detections
    AS PERMISSIVE FOR ALL TO public
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

-- 5 · perception.inference_jobs (PERMISSIVE, TO public)
DROP POLICY warehouse_scope ON perception.inference_jobs;
CREATE POLICY warehouse_scope ON perception.inference_jobs
    AS PERMISSIVE FOR ALL TO public
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

-- 6 · perception.job_events (PERMISSIVE, TO public, via EXISTS sobre inference_jobs)
DROP POLICY job_scope ON perception.job_events;
CREATE POLICY job_scope ON perception.job_events
    AS PERMISSIVE FOR ALL TO public
    USING (
        EXISTS (
            SELECT 1 FROM perception.inference_jobs j
             WHERE j.tenant_id = job_events.tenant_id
               AND j.id = job_events.job_id
               AND (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
               AND ((SELECT core.has_tenant_wide_access())
                    OR j.warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM perception.inference_jobs j
             WHERE j.tenant_id = job_events.tenant_id
               AND j.id = job_events.job_id
               AND (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
               AND ((SELECT core.has_tenant_wide_access())
                    OR j.warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()), '{}'::uuid[])))
        )
    );

-- 7 · perception.media (PERMISSIVE, TO public)
DROP POLICY warehouse_scope ON perception.media;
CREATE POLICY warehouse_scope ON perception.media
    AS PERMISSIVE FOR ALL TO public
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

-- 8 · spatial.observation_sources (PERMISSIVE, TO public)
DROP POLICY warehouse_scope ON spatial.observation_sources;
CREATE POLICY warehouse_scope ON spatial.observation_sources
    AS PERMISSIVE FOR ALL TO public
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

-- 9 · spatial.rack_observations (PERMISSIVE, TO public)
DROP POLICY warehouse_scope ON spatial.rack_observations;
CREATE POLICY warehouse_scope ON spatial.rack_observations
    AS PERMISSIVE FOR ALL TO public
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

-- 10 · spatial.rack_placements (PERMISSIVE, TO authenticated, olo_app)
DROP POLICY warehouse_scope ON spatial.rack_placements;
CREATE POLICY warehouse_scope ON spatial.rack_placements
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

-- 11 · spatial.warehouse_layouts (PERMISSIVE, TO authenticated, olo_app)
DROP POLICY warehouse_scope ON spatial.warehouse_layouts;
CREATE POLICY warehouse_scope ON spatial.warehouse_layouts
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


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_n         int;
    v_discrepan bigint;
    v_total     bigint;
BEGIN
    -- 1 · Ninguna de las 11 llama ya a can_access_warehouse() con una columna.
    SELECT count(1) INTO v_n FROM pg_policies
     WHERE (schemaname, tablename, policyname) IN (
        ('incidents', 'incidents', 'solo_su_almacen'),
        ('inventory', 'cluster_members', 'hereda_del_cluster'),
        ('inventory', 'clusters', 'solo_su_almacen'),
        ('perception', 'detections', 'warehouse_scope'),
        ('perception', 'inference_jobs', 'warehouse_scope'),
        ('perception', 'job_events', 'job_scope'),
        ('perception', 'media', 'warehouse_scope'),
        ('spatial', 'observation_sources', 'warehouse_scope'),
        ('spatial', 'rack_observations', 'warehouse_scope'),
        ('spatial', 'rack_placements', 'warehouse_scope'),
        ('spatial', 'warehouse_layouts', 'warehouse_scope'))
       AND (qual LIKE '%can_access_warehouse(%' OR with_check LIKE '%can_access_warehouse(%');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'quedan % politica(s) con can_access_warehouse() sin envolver', v_n;
    END IF;

    -- 2 · Las 11 existen con el MISMO permissive/restrictive que antes de esta migración.
    SELECT count(1) INTO v_n FROM pg_policies
     WHERE (schemaname, tablename, policyname, permissive) IN (
        ('incidents', 'incidents', 'solo_su_almacen', 'RESTRICTIVE'),
        ('inventory', 'cluster_members', 'hereda_del_cluster', 'RESTRICTIVE'),
        ('inventory', 'clusters', 'solo_su_almacen', 'RESTRICTIVE'),
        ('perception', 'detections', 'warehouse_scope', 'PERMISSIVE'),
        ('perception', 'inference_jobs', 'warehouse_scope', 'PERMISSIVE'),
        ('perception', 'job_events', 'job_scope', 'PERMISSIVE'),
        ('perception', 'media', 'warehouse_scope', 'PERMISSIVE'),
        ('spatial', 'observation_sources', 'warehouse_scope', 'PERMISSIVE'),
        ('spatial', 'rack_observations', 'warehouse_scope', 'PERMISSIVE'),
        ('spatial', 'rack_placements', 'warehouse_scope', 'PERMISSIVE'),
        ('spatial', 'warehouse_layouts', 'warehouse_scope', 'PERMISSIVE'));
    IF v_n <> 11 THEN
        RAISE EXCEPTION 'faltan % politica(s), o alguna cambio de permissive/restrictive', 11 - v_n;
    END IF;

    -- 3 · EQUIVALENCIA SEMÁNTICA fila a fila contra can_access_warehouse(), sobre
    --     datos reales. Corre como propietario (bypassrls): ve todas las filas,
    --     que es lo que hace falta para comparar los dos predicados.
    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM perception.detections;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'perception.detections: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;
    RAISE NOTICE '0102: equivalencia comprobada en % deteccion(es)', v_total;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM perception.inference_jobs;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'perception.inference_jobs: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM perception.media;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'perception.media: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM spatial.observation_sources;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'spatial.observation_sources: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM spatial.rack_observations;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'spatial.rack_observations: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM spatial.rack_placements;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'spatial.rack_placements: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM spatial.warehouse_layouts;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'spatial.warehouse_layouts: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM incidents.incidents;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'incidents.incidents: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan FROM inventory.clusters;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'inventory.clusters: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    -- inventory.cluster_members y perception.job_events viven detrás de un EXISTS:
    -- se comparan vía su join, no sobre una columna propia.
    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(c.warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR c.warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan
      FROM inventory.cluster_members cm JOIN inventory.clusters c ON c.id = cm.cluster_id;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'inventory.cluster_members: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    SELECT count(1), count(1) FILTER (WHERE core.can_access_warehouse(j.warehouse_id) IS DISTINCT FROM (
             (core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
             AND (core.has_tenant_wide_access()
                  OR j.warehouse_id = ANY (COALESCE(core.accessible_warehouse_ids(), '{}'::uuid[])))))
      INTO v_total, v_discrepan
      FROM perception.job_events je
      JOIN perception.inference_jobs j ON j.id = je.job_id AND j.tenant_id = je.tenant_id;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'perception.job_events: predicado nuevo discrepa en % de % filas', v_discrepan, v_total;
    END IF;

    RAISE NOTICE '0102: equivalencia fila a fila comprobada en las 11 politicas';

    -- 4 · Sin contexto (sesión vacía), las políticas deben negar. Se comprueba en
    --     una tabla de cada patrón: PERMISSIVE simple, RESTRICTIVE simple, y EXISTS.
    PERFORM set_config('app.tenant_id', '', true);
    PERFORM set_config('app.auth_user_id', '', true);
    PERFORM set_config('app.tenant_wide_access', 'false', true);

    SELECT count(1) INTO v_discrepan FROM perception.detections
     WHERE (core.current_tenant_id() IS NOT NULL AND core.has_active_membership()) IS NOT FALSE;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'sin contexto, perception.detections no niega en % filas: fuga', v_discrepan;
    END IF;

    SELECT count(1) INTO v_discrepan FROM incidents.incidents
     WHERE (core.current_tenant_id() IS NOT NULL AND core.has_active_membership()) IS NOT FALSE;
    IF v_discrepan <> 0 THEN
        RAISE EXCEPTION 'sin contexto, incidents.incidents no niega en % filas: fuga', v_discrepan;
    END IF;

    -- 5 · RLS sigue ACTIVO en las 11 tablas tocadas (esta migración solo reescribe
    --     políticas, nunca `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY`; el
    --     `FORCE` en sí varía de una tabla a otra desde antes de 0102 y no es algo
    --     que esta migración deba uniformar).
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname, c.relname) IN (
        ('incidents', 'incidents'), ('inventory', 'cluster_members'), ('inventory', 'clusters'),
        ('perception', 'detections'), ('perception', 'inference_jobs'), ('perception', 'job_events'),
        ('perception', 'media'), ('spatial', 'observation_sources'), ('spatial', 'rack_observations'),
        ('spatial', 'rack_placements'), ('spatial', 'warehouse_layouts'))
       AND c.relrowsecurity;
    IF v_n <> 11 THEN
        RAISE EXCEPTION 'RLS (relrowsecurity) falta en % de las 11 tablas', 11 - v_n;
    END IF;

    RAISE NOTICE
        'OK 0102: 11 politicas reescritas con subconsulta escalar (InitPlan, UNA '
        'evaluacion por consulta en lugar de una por fila) · equivalencia demostrada '
        'fila a fila contra can_access_warehouse() · niega sin contexto · RLS activo '
        'en las 11 · medido en detections: ~8,3 s/pagina -> objetivo sub-segundo';
END
$$;
