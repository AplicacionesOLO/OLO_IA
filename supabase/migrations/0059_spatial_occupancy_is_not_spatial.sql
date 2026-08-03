-- ═══════════════════════════════════════════════════════════════════════════
-- 0059_spatial_occupancy_is_not_spatial.sql
-- Modifica : spatial.floor_plan · spatial.warehouse_summary
-- Depende de: 0057 (las vistas), 0058 (nada, solo orden)
-- Riesgo   : bajo · solo vistas · CAMBIA EL CONTRATO de dos de ellas
--
-- ── El defecto ─────────────────────────────────────────────────────────────
--
-- 0057 expuso `occupied_count` y `occupancy_percentage` calculados como
-- `location_situation = 'OCUP'`. Con el catálogo real importado, eso resultó ser
-- tres errores a la vez:
--
--   1. LOS NÚMEROS NO PARTICIONAN. `available_count` y `blocked_count` salen de
--      `status` y suman exacto: 18.075 + 11.237 = 29.312. `occupied_count` sale
--      de OTRA columna y solapa con ambas: 15.862. Los tres juntos suman 45.174
--      de 29.312 ubicaciones. Un frontend que los pinte apilados dibuja un
--      gráfico imposible, y lo hará, porque los nombres invitan a ello.
--
--   2. LAS DOS COLUMNAS DEL ORIGEN SE CONTRADICEN. Medido sobre las 29.310:
--
--         situación  estado       filas
--         OCUP       available   15.480
--         BLOQ       blocked      5.111
--         BLOQES     blocked      2.774
--         DISP       available    2.058
--         DISP       blocked      1.973   ← contradicción
--         BLOQFI     blocked        996
--         BLOQ       available      389   ← contradicción
--         OCUP       blocked        382
--         RESREC     available      130
--         PROB       available       11
--         BLOQES     available        3   ← contradicción
--         RESREP     available        2
--         PROB       blocked          1
--
--      2.365 ubicaciones donde «Estado» y «Situación» dicen cosas distintas. No
--      es un defecto de la importación: el WMS de origen las tiene así. Elegir
--      una de las dos y llamarla «ocupación» oculta la discrepancia en lugar de
--      exponerla.
--
--   3. ES UNA FOTO, NO UN ESTADO. `location_situation` viene de un archivo
--      exportado el 25/06/2026. Un campo llamado `occupied_count` en el modelo
--      de lectura del ESPACIO se leerá como ocupación actual — y la ocupación
--      actual no vive aquí: vive en el inventario (SPA-11, SPA-12, y R3 del
--      ADR-009, que dice que `spatial` no referencia `wms`). El estante no sabe
--      lo que tiene encima.
--
-- ── El arreglo ─────────────────────────────────────────────────────────────
--
--   · Fuera `occupied_count` y `occupancy_percentage` de las dos vistas. Un
--     nombre que induce a error no se arregla con un comentario.
--   · Entra `wms_situation_counts jsonb`: el histograma COMPLETO del vocabulario
--     tal cual, sin privilegiar ningún valor. El vocabulario es abierto a
--     propósito (0052), así que una columna por valor se rompería con el
--     siguiente archivo; un jsonb no.
--   · Entra `status_situation_conflicts`: el recuento de filas donde las dos
--     columnas se contradicen. Un dato incómodo medido es mejor que un dato
--     cómodo inventado, y este es justo el que hay que mirar antes de confiar en
--     cualquiera de las dos.
--   · El prefijo `wms_` es deliberado: dice de dónde viene y que NO es una
--     propiedad del espacio.
--
-- La ocupación de verdad llegará como su propio modelo de lectura cuando exista
-- el snapshot de inventario, y entonces se llamará ocupación con todo derecho.
-- ═══════════════════════════════════════════════════════════════════════════

-- `CREATE OR REPLACE VIEW` no permite quitar ni reordenar columnas, así que hay
-- que recrear. El orden importa: `warehouse_summary` no depende de `floor_plan`,
-- pero se recrean las dos en el mismo bloque para que el contrato cambie de una
-- vez y no exista un instante con una vista nueva y otra vieja.
DROP VIEW IF EXISTS spatial.floor_plan;
DROP VIEW IF EXISTS spatial.warehouse_summary;


-- ── 1 · floor_plan ─────────────────────────────────────────────────────────
CREATE VIEW spatial.floor_plan
WITH (security_invoker = true) AS
SELECT
    rack.tenant_id,
    rack.warehouse_id,
    rack.id                       AS rack_id,
    rack.node_code                AS rack_code,
    rack.external_code            AS rack_external_code,
    rack.logical_index            AS rack_index,
    rack.node_type                AS rack_node_type,
    rack.node_function,
    nf.display_name               AS function_label,
    aisle.id                      AS aisle_id,
    aisle.node_code               AS aisle_code,
    rack.site_id,
    COUNT(DISTINCT bay.id)                                AS bay_count,
    COUNT(l.id)                                           AS location_count,
    -- Estas dos SÍ particionan `location_count`: `status` es vocabulario cerrado
    -- y verificado por CHECK. Ver el bloque de verificación al final.
    COUNT(l.id) FILTER (WHERE l.status = 'available')      AS available_count,
    COUNT(l.id) FILTER (WHERE l.status = 'blocked')        AS blocked_count,
    COUNT(l.id) FILTER (WHERE l.origin = 'inferred')       AS inferred_count,
    COUNT(l.id) FILTER (WHERE l.is_bulk_area)              AS bulk_count,
    -- El vocabulario del WMS al completo, sin elegir un valor favorito.
    -- Viene de `hist`, precalculado en UNA pasada. Ver la nota junto al join.
    COALESCE(hist.situation_counts, '{}'::jsonb)           AS wms_situation_counts,
    COUNT(l.id) FILTER (
        WHERE (l.location_situation LIKE 'BLOQ%' AND l.status <> 'blocked')
           OR (l.location_situation = 'DISP'    AND l.status <> 'available')
    )                                                      AS status_situation_conflicts,
    MIN(l.logical_x) AS min_logical_x, MAX(l.logical_x) AS max_logical_x,
    MIN(l.logical_y) AS min_logical_y, MAX(l.logical_y) AS max_logical_y,
    MAX(l.logical_level) AS max_level
FROM spatial.nodes rack
LEFT JOIN spatial.nodes bay
       ON bay.parent_node_id = rack.id AND bay.node_type = 'bay' AND bay.deleted_at IS NULL
LEFT JOIN spatial.locations l
       ON l.node_id = COALESCE(bay.id, rack.id) AND l.deleted_at IS NULL
LEFT JOIN spatial.nodes aisle
       ON aisle.id = rack.parent_node_id AND aisle.node_type = 'aisle'
LEFT JOIN spatial.node_functions nf ON nf.code = rack.node_function
-- ── El histograma, y las dos formas de hacerlo mal ─────────────────────────
--
-- Se intentaron las dos antes de llegar aquí, y las dos se midieron:
--
--   · `LEFT JOIN LATERAL` que devuelve UNA FILA POR SITUACIÓN → multiplica el
--     join con `bay` y `COUNT(l.id)` cuenta cada ubicación tantas veces como
--     situaciones tenga su rack: 98.334 en lugar de 29.312, factor 3,35. Lo
--     detuvo la comprobación 4.5 de esta misma migración, no una revisión.
--
--   · SUBCONSULTA ESCALAR correlacionada con `rack.id` → correcta, pero se
--     ejecuta 348 veces, una por rack, cada una recorriendo `locations`:
--     5.408 ms medidos con EXPLAIN ANALYZE, 11× el objetivo de 500 ms. El coste
--     estimado del plan era 14.777.903. Correcto y a la vez inservible.
--
-- Lo que funciona es agregar UNA VEZ para todos los racks y unir por clave:
-- primero (rack, situación) → recuentos, luego rack → jsonb. Una pasada sobre
-- `locations`, y como `rack_id` es único en el resultado, el join no puede
-- multiplicar nada. `hist.situation_counts` entra en el GROUP BY porque hay
-- exactamente un valor por rack: agruparlo no cambia el resultado, y `min(jsonb)`
-- no existe en PostgreSQL, asi que la alternativa de agregarlo no era opcion.
--
-- `warehouse_id` esta en el GROUP BY y en la condicion del join AUNQUE `rack_id`
-- ya sea unico. No es redundancia decorativa: sin el, `WHERE warehouse_id = $1`
-- en la consulta de fuera no puede bajar al subplan, y el histograma agregaria
-- las ubicaciones de TODOS los almacenes del tenant para devolver las de uno.
-- Con dos almacenes no se nota; con veinte, el plano de planta se vuelve lineal
-- en el tamano del tenant en lugar de en el del almacen.
LEFT JOIN (
    SELECT x.warehouse_id, x.rack_id,
           jsonb_object_agg(x.situacion, x.n) AS situation_counts
      FROM (
        SELECT l2.warehouse_id                                       AS warehouse_id,
               COALESCE(b.parent_node_id, l2.node_id)                AS rack_id,
               COALESCE(l2.location_situation, '(sin situacion)')     AS situacion,
               count(1)                                              AS n
          FROM spatial.locations l2
          LEFT JOIN spatial.nodes b
                 ON b.id = l2.node_id AND b.node_type = 'bay' AND b.deleted_at IS NULL
         WHERE l2.deleted_at IS NULL
         GROUP BY 1, 2, 3
      ) x
     GROUP BY x.warehouse_id, x.rack_id
) hist ON hist.rack_id = rack.id AND hist.warehouse_id = rack.warehouse_id
WHERE rack.deleted_at IS NULL
  AND rack.node_type IN ('rack', 'storage_area')
GROUP BY rack.tenant_id, rack.warehouse_id, rack.id, rack.node_code,
         rack.external_code, rack.logical_index, rack.node_type, rack.node_function,
         nf.display_name, aisle.id, aisle.node_code, rack.site_id,
         hist.situation_counts;

COMMENT ON VIEW spatial.floor_plan IS
    'Plano agregado: UNA fila por rack. `available_count` + `blocked_count` = `location_count` (particion real, sobre el vocabulario cerrado de `status`). `wms_situation_counts` es el histograma del vocabulario ABIERTO del WMS, con prefijo wms_ porque NO es una propiedad del espacio: es lo que dijo el archivo de origen. NO HAY occupied_count: la ocupacion es del inventario, no del estante (SPA-11, R3).';

COMMENT ON COLUMN spatial.floor_plan.status_situation_conflicts IS
    'Ubicaciones donde `status` y `location_situation` se contradicen. 2.365 en el catalogo real: el WMS de origen las tiene asi. Se expone en lugar de esconderse porque es lo primero que hay que mirar antes de confiar en cualquiera de las dos columnas.';


-- ── 2 · warehouse_summary ──────────────────────────────────────────────────
CREATE VIEW spatial.warehouse_summary
WITH (security_invoker = true) AS
SELECT
    w.tenant_id,
    w.id                 AS warehouse_id,
    w.code               AS warehouse_code,
    w.name               AS warehouse_name,
    nodos.site_count,
    nodos.aisle_count,
    nodos.rack_count,
    nodos.bay_count,
    ubic.location_count,
    ubic.available_count,
    ubic.blocked_count,
    ubic.inferred_count,
    ubic.opaque_count,
    ubic.wms_situation_counts,
    ubic.status_situation_conflicts,
    -- Cuántas capacidades declaró el WMS como «sin límite», y cuántas no declaró
    -- en absoluto. Antes de 0058 ambas eran NULL indistinguibles.
    ubic.capacity_unlimited_count,
    ubic.capacity_unknown_count,
    -- Cuánto falta para el gemelo métrico: 0 hasta el importador CAD.
    ubic.with_world_geometry,
    lotes.last_import_at,
    lotes.total_rows_rejected
FROM core.warehouses w
CROSS JOIN LATERAL (
    SELECT
        (SELECT count(1) FROM spatial.sites s
          WHERE s.warehouse_id = w.id AND s.deleted_at IS NULL)              AS site_count,
        count(1) FILTER (WHERE n.node_type = 'aisle')                        AS aisle_count,
        count(1) FILTER (WHERE n.node_type = 'rack')                         AS rack_count,
        count(1) FILTER (WHERE n.node_type = 'bay')                          AS bay_count
      FROM spatial.nodes n
     WHERE n.warehouse_id = w.id AND n.deleted_at IS NULL
) nodos
CROSS JOIN LATERAL (
    SELECT
        count(1)                                                       AS location_count,
        count(1) FILTER (WHERE l.status = 'available')                  AS available_count,
        count(1) FILTER (WHERE l.status = 'blocked')                    AS blocked_count,
        count(1) FILTER (WHERE l.origin = 'inferred')                   AS inferred_count,
        count(1) FILTER (WHERE l.code_form = 'opaque')                  AS opaque_count,
        count(1) FILTER (WHERE l.world_position IS NOT NULL)            AS with_world_geometry,
        count(1) FILTER (WHERE l.max_weight_kg IS NULL
                           AND l.raw_source ? 'peso_max_crudo')         AS capacity_unlimited_count,
        count(1) FILTER (WHERE l.max_weight_kg IS NULL
                           AND NOT (l.raw_source ? 'peso_max_crudo'))   AS capacity_unknown_count,
        count(1) FILTER (
            WHERE (l.location_situation LIKE 'BLOQ%' AND l.status <> 'blocked')
               OR (l.location_situation = 'DISP'    AND l.status <> 'available')
        )                                                              AS status_situation_conflicts,
        COALESCE(
            (SELECT jsonb_object_agg(situacion, n) FROM (
                SELECT COALESCE(l3.location_situation, '(sin situacion)') AS situacion,
                       count(1) AS n
                  FROM spatial.locations l3
                 WHERE l3.warehouse_id = w.id AND l3.deleted_at IS NULL
                 GROUP BY 1) h),
            '{}'::jsonb
        )                                                              AS wms_situation_counts
      FROM spatial.locations l
     WHERE l.warehouse_id = w.id AND l.deleted_at IS NULL
) ubic
CROSS JOIN LATERAL (
    SELECT max(b.finished_at)   AS last_import_at,
           sum(b.rows_rejected) AS total_rows_rejected
      FROM spatial.import_batches b
     WHERE b.warehouse_id = w.id AND b.status = 'completed'
) lotes
WHERE w.deleted_at IS NULL;

COMMENT ON VIEW spatial.warehouse_summary IS
    'KPIs de un almacen en UNA fila. `available_count` + `blocked_count` = `location_count`. `capacity_unlimited_count` y `capacity_unknown_count` separan «el WMS dijo ilimitado» de «el WMS no dijo nada», que antes de 0058 eran el mismo NULL. NO HAY occupied_count: la ocupacion es del inventario (SPA-11, R3).';


-- ── 3 · Privilegios · hay que REVOCAR, no solo conceder ────────────────────
-- `ALTER DEFAULT PRIVILEGES ... ON TABLES` de 0047 cubre TAMBIÉN las vistas, así
-- que las dos nacen con INSERT/UPDATE/DELETE para `olo_app`. Ver 0057.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.floor_plan        FROM olo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.warehouse_summary FROM olo_app;
GRANT SELECT ON spatial.floor_plan        TO olo_app;
GRANT SELECT ON spatial.warehouse_summary TO olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_n        int;
    v_wid      uuid;
    v_r        record;
    v_suma_hist bigint;
BEGIN
    -- 4.1 · `security_invoker` en las dos. Sin él la vista salta la RLS por el
    --       `rolbypassrls` de su propietario: la lección de 0042.
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname IN ('floor_plan', 'warehouse_summary')
       AND c.reloptions @> ARRAY['security_invoker=true'];
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'security_invoker falta en % vista(s)', 2 - v_n;
    END IF;

    -- 4.2 · `occupied_count` y `occupancy_percentage` NO deben existir en ninguna
    --       vista de spatial. Es el defecto que esta migración corrige, y una
    --       comprobación por nombre impide que vuelva por otra puerta.
    SELECT count(1) INTO v_n
      FROM information_schema.columns c
      JOIN pg_class cl ON cl.relname = c.table_name
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = c.table_schema
     WHERE c.table_schema = 'spatial' AND cl.relkind = 'v'
       AND c.column_name IN ('occupied_count', 'occupancy_percentage');
    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'quedan % columna(s) de ocupacion en vistas de spatial: la ocupacion no '
            'es una propiedad del espacio (SPA-11, R3)', v_n;
    END IF;

    -- 4.3 · Ninguna de las dos es insertable. `information_schema` es la
    --       autoridad, no `has_table_privilege`: fue el error de 0057.
    SELECT count(1) INTO v_n FROM information_schema.views
     WHERE table_schema = 'spatial' AND table_name IN ('floor_plan', 'warehouse_summary')
       AND is_insertable_into = 'YES';
    IF v_n <> 0 THEN RAISE EXCEPTION '% vista(s) son insertables', v_n; END IF;

    -- 4.4 · LA PARTICIÓN, sobre datos reales. Si el catálogo no está importado
    --       la comprobación se salta explícitamente en lugar de fingir que pasó.
    SELECT warehouse_id INTO v_wid FROM spatial.warehouse_summary
     WHERE location_count > 0 ORDER BY location_count DESC LIMIT 1;

    IF v_wid IS NULL THEN
        RAISE NOTICE '0059: sin ubicaciones importadas · particion no comprobada '
                     'sobre datos reales';
    ELSE
        SELECT * INTO v_r FROM spatial.warehouse_summary WHERE warehouse_id = v_wid;

        IF v_r.available_count + v_r.blocked_count <> v_r.location_count THEN
            RAISE EXCEPTION
                'available (%) + blocked (%) = % <> location_count (%): `status` dejo '
                'de ser una particion y las vistas mienten',
                v_r.available_count, v_r.blocked_count,
                v_r.available_count + v_r.blocked_count, v_r.location_count;
        END IF;

        -- El histograma también debe sumar el total: si no, el LATERAL está
        -- multiplicando filas, que es exactamente el fallo que se busca evitar.
        SELECT sum(valor::bigint) INTO v_suma_hist
          FROM jsonb_each_text(v_r.wms_situation_counts) AS h(clave, valor);
        IF v_suma_hist <> v_r.location_count THEN
            RAISE EXCEPTION
                'el histograma de situaciones suma % pero hay % ubicaciones: el '
                'LATERAL esta multiplicando filas',
                v_suma_hist, v_r.location_count;
        END IF;

        -- Y las contradicciones deben ser un número, aunque sea grande.
        IF v_r.status_situation_conflicts IS NULL THEN
            RAISE EXCEPTION 'status_situation_conflicts no deberia ser NULL';
        END IF;

        RAISE NOTICE
            '0059: sobre el almacen % · % ubicaciones · % disponibles + % bloqueadas '
            '= particion exacta · histograma de % situacion(es) que suma el total · '
            '% contradiccion(es) entre estado y situacion · % sin limite declarado, '
            '% sin dato de capacidad',
            v_r.warehouse_code, v_r.location_count, v_r.available_count,
            v_r.blocked_count,
            (SELECT count(1) FROM jsonb_object_keys(v_r.wms_situation_counts)),
            v_r.status_situation_conflicts,
            v_r.capacity_unlimited_count, v_r.capacity_unknown_count;

        -- 4.5 · `floor_plan` debe sumar lo mismo que el resumen. Dos vistas que
        --       cuentan lo mismo de forma distinta son dos oportunidades de
        --       discrepar; comprobarlo aquí es lo que impide que discrepen.
        SELECT sum(location_count), sum(available_count), sum(blocked_count)
          INTO v_n, v_r.available_count, v_r.blocked_count
          FROM spatial.floor_plan WHERE warehouse_id = v_wid;

        IF v_n <> (SELECT location_count FROM spatial.warehouse_summary
                    WHERE warehouse_id = v_wid) THEN
            RAISE EXCEPTION
                'floor_plan suma % ubicaciones y warehouse_summary %: las dos vistas '
                'discrepan', v_n,
                (SELECT location_count FROM spatial.warehouse_summary
                  WHERE warehouse_id = v_wid);
        END IF;
        RAISE NOTICE '0059: floor_plan y warehouse_summary coinciden en % ubicaciones', v_n;
    END IF;

    RAISE NOTICE
        'OK 0059: occupied_count y occupancy_percentage ELIMINADAS de las vistas · '
        'wms_situation_counts expone el vocabulario abierto completo · '
        'status_situation_conflicts expone las contradicciones del origen · '
        'capacity_unlimited/unknown separan dos NULL distintos · '
        'security_invoker=true · ninguna insertable';
END
$$;
