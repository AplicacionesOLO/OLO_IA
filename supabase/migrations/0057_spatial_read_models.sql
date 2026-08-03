-- ═══════════════════════════════════════════════════════════════════════════
-- 0057_spatial_read_models.sql
-- Crea   : 4 vistas de lectura para el explorador espacial
-- Depende de: 0051 (node_id), 0053 (bay), 0054 (external_code), 0056 (lotes)
-- Riesgo : bajo · solo vistas
--
-- ⚠ LAS CUATRO LLEVAN `security_invoker = true`. Sin él la vista se ejecuta con los
--   privilegios de su propietario —`postgres`, que tiene `rolbypassrls`— y se
--   convierte en una fuga entre tenants. Es la lección de la migración 0042, y aquí
--   el riesgo es mayor porque estas vistas SÍ las va a consultar el frontend.
--
-- POR QUÉ VISTAS Y NO MATERIALIZADAS. Una vista materializada sería un caché con
-- dos problemas: hay que refrescarla y puede quedar obsoleta justo después de una
-- importación. Con 29.310 ubicaciones y 3.048 nodos los agregados corren en
-- milisegundos sobre los índices que ya existen. Si el volumen creciera cien veces,
-- la materialización es la escalada — pero entonces sería explícitamente un caché.
--
-- NINGUNA VISTA DEVUELVE LAS 29.310 FILAS CRUDAS. `floor_plan` agrega por rack
-- (347 filas) y `front_view` por cuerpo. El detalle se pide por rack, paginado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · Contrato plano de una ubicación · CERO parseo en el cliente ─────────
CREATE VIEW spatial.locations_resolved
WITH (security_invoker = true) AS
SELECT
    l.id                          AS location_id,
    l.tenant_id,
    l.warehouse_id,
    w.code                        AS warehouse_code,
    w.name                        AS warehouse_name,
    s.id                          AS site_id,
    s.code                        AS site_code,
    -- NULL mientras no exista fuente fiable de pasillos. No se inventa.
    aisle.id                      AS aisle_id,
    aisle.node_code               AS aisle_code,
    rack.id                       AS rack_id,
    rack.node_code                AS rack_code,
    rack.external_code            AS rack_external_code,
    rack.logical_index            AS rack_index,
    CASE WHEN bay.node_type = 'bay' THEN bay.id            END AS bay_id,
    CASE WHEN bay.node_type = 'bay' THEN 'C' || lpad(bay.logical_index::text, 3, '0') END AS bay_code,
    CASE WHEN bay.node_type = 'bay' THEN bay.logical_index END AS bay_index,
    l.logical_level               AS level,
    l.logical_position            AS position,
    l.code                       AS full_code,
    l.external_code,
    l.external_location_id,
    l.code_form,
    l.type                        AS location_type,
    l.status                      AS location_status,
    l.location_situation,
    l.is_bulk_area,
    l.origin,
    l.max_weight_kg,
    l.max_units,
    -- Etiqueta legible: el frontend muestra «Almacenaje», no `ALMREP`.
    rack.node_function,
    nf.display_name               AS function_label,
    nf.implies_bulk,
    l.logical_x, l.logical_y, l.logical_z,
    l.world_frame_id, l.world_position,
    l.version,
    l.created_at, l.updated_at
FROM spatial.locations l
JOIN core.warehouses  w    ON w.id = l.warehouse_id
-- El padre directo: un cuerpo o un área de suelo.
JOIN spatial.nodes    bay  ON bay.id = l.node_id
-- El dueño del primer segmento: el rack si el padre es un cuerpo, o el propio nodo.
JOIN spatial.nodes    rack ON rack.id = COALESCE(bay.parent_node_id, bay.id)
JOIN spatial.sites    s    ON s.id = bay.site_id
LEFT JOIN spatial.nodes aisle
       ON aisle.id = rack.parent_node_id AND aisle.node_type = 'aisle'
LEFT JOIN spatial.node_functions nf ON nf.code = rack.node_function
WHERE l.deleted_at IS NULL
  AND bay.deleted_at IS NULL
  AND rack.deleted_at IS NULL;

COMMENT ON VIEW spatial.locations_resolved IS
    'Contrato PLANO de una ubicacion: warehouse, aisle, rack, bay, level, position y full_code sin una sola expresion regular en el cliente. security_invoker=true: sin el seria una fuga entre tenants.';


-- ── 2 · Plano agregado por rack · 347 filas, no 29.310 ─────────────────────
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
    COUNT(DISTINCT bay.id)                                          AS bay_count,
    COUNT(l.id)                                                     AS location_count,
    COUNT(l.id) FILTER (WHERE l.location_situation = 'OCUP')         AS occupied_count,
    COUNT(l.id) FILTER (WHERE l.status = 'available')                AS available_count,
    COUNT(l.id) FILTER (WHERE l.status = 'blocked')                  AS blocked_count,
    COUNT(l.id) FILTER (WHERE l.origin = 'inferred')                 AS inferred_count,
    COUNT(l.id) FILTER (WHERE l.is_bulk_area)                        AS bulk_count,
    -- Redondeado a un decimal. `NULLIF` evita la division por cero en un rack
    -- recien creado sin ubicaciones.
    ROUND(
        100.0 * COUNT(l.id) FILTER (WHERE l.location_situation = 'OCUP')
        / NULLIF(COUNT(l.id), 0), 1
    )                                                                AS occupancy_percentage,
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
WHERE rack.deleted_at IS NULL
  AND rack.node_type IN ('rack', 'storage_area')
GROUP BY rack.tenant_id, rack.warehouse_id, rack.id, rack.node_code,
         rack.external_code, rack.logical_index, rack.node_type, rack.node_function,
         nf.display_name, aisle.id, aisle.node_code, rack.site_id;

COMMENT ON VIEW spatial.floor_plan IS
    'Plano agregado: UNA fila por rack con sus recuentos. 347 filas en lugar de 29.310, para que el frontend dibuje la vista general sin descargar el catalogo entero.';


-- ── 3 · Vista frontal de un rack · una fila por hueco de sus cuerpos ───────
CREATE VIEW spatial.rack_front_view
WITH (security_invoker = true) AS
SELECT
    rack.tenant_id,
    rack.warehouse_id,
    rack.id                        AS rack_id,
    rack.node_code                 AS rack_code,
    bay.id                         AS bay_id,
    'C' || lpad(bay.logical_index::text, 3, '0') AS bay_code,
    bay.logical_index              AS bay_index,
    l.id                           AS location_id,
    l.logical_level                AS level,
    l.logical_position             AS position,
    l.code                         AS full_code,
    l.external_code,
    l.status                       AS location_status,
    l.location_situation,
    l.is_bulk_area,
    l.origin,
    l.max_weight_kg,
    l.max_units
FROM spatial.nodes rack
JOIN spatial.nodes bay
     ON bay.parent_node_id = rack.id AND bay.node_type = 'bay' AND bay.deleted_at IS NULL
JOIN spatial.locations l
     ON l.node_id = bay.id AND l.deleted_at IS NULL
WHERE rack.deleted_at IS NULL AND rack.node_type = 'rack';

COMMENT ON VIEW spatial.rack_front_view IS
    'Alzado de un rack: cuerpo x nivel x posicion. El frontend dibuja la matriz con bay_index en X, level en Y y position como profundidad, sin parsear nada.';


-- ── 4 · Resumen del almacén · una sola fila ────────────────────────────────
-- Con `LATERAL` en lugar de once subconsultas correlacionadas, por dos razones:
--
--   1. RENDIMIENTO. Las once recorrían `spatial.locations` once veces; el LATERAL
--      agrega en UNA pasada por almacén. Es lo que sostiene el objetivo de <300 ms.
--   2. NO AUTO-ACTUALIZABLE. Una vista que lee UNA sola tabla base la considera
--      PostgreSQL auto-actualizable, y un `INSERT` habría ido a `core.warehouses`.
--      Lo detectó la verificación de esta migración. Con LATERAL la vista pasa a ser
--      de varias relaciones y el motor la rechaza como destino de escritura, así que
--      la protección no depende solo de haber revocado el privilegio.
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
    ubic.occupied_count,
    ubic.available_count,
    ubic.blocked_count,
    ubic.inferred_count,
    ubic.opaque_count,
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
        count(1)                                                            AS location_count,
        count(1) FILTER (WHERE l.location_situation = 'OCUP')               AS occupied_count,
        count(1) FILTER (WHERE l.status = 'available')                      AS available_count,
        count(1) FILTER (WHERE l.status = 'blocked')                        AS blocked_count,
        count(1) FILTER (WHERE l.origin = 'inferred')                       AS inferred_count,
        count(1) FILTER (WHERE l.code_form = 'opaque')                      AS opaque_count,
        count(1) FILTER (WHERE l.world_position IS NOT NULL)                AS with_world_geometry
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
    'KPIs de un almacen en UNA fila. `with_world_geometry` mide cuanto falta para el gemelo metrico: 0 hasta el importador CAD.';


-- ⚠ Hay que REVOCAR, no solo conceder. `ALTER DEFAULT PRIVILEGES ... ON TABLES`
--   de la migración 0047 cubre TAMBIÉN las vistas, así que las cuatro nacen con
--   `INSERT, UPDATE, DELETE` para `olo_app`. Ninguna es escribible de verdad —todas
--   llevan JOIN y PostgreSQL no las considera auto-actualizables— pero anunciar un
--   privilegio que no se puede ejercer es ruido en la auditoría de permisos.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.locations_resolved FROM olo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.floor_plan         FROM olo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.rack_front_view    FROM olo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON spatial.warehouse_summary  FROM olo_app;

GRANT SELECT ON spatial.locations_resolved TO olo_app;
GRANT SELECT ON spatial.floor_plan         TO olo_app;
GRANT SELECT ON spatial.rack_front_view    TO olo_app;
GRANT SELECT ON spatial.warehouse_summary  TO olo_app;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_n int; r record;
BEGIN
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relkind = 'v'
       AND c.relname IN ('locations_resolved', 'floor_plan', 'rack_front_view',
                         'warehouse_summary');
    IF v_n <> 4 THEN RAISE EXCEPTION 'se esperaban 4 vistas, hay %', v_n; END IF;

    -- ⚠ LA COMPROBACIÓN QUE IMPORTA: `security_invoker` en las cuatro. Sin ella la
    --   vista salta RLS por el `rolbypassrls` del propietario.
    FOR r IN SELECT c.relname,
                    COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                               WHERE option_name = 'security_invoker'), 'false') AS si
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'spatial' AND c.relkind = 'v' LOOP
        IF r.si <> 'true' THEN
            RAISE EXCEPTION
                'la vista spatial.% NO tiene security_invoker=true: seria una fuga '
                'entre tenants (leccion de 0042)', r.relname;
        END IF;
    END LOOP;

    FOR r IN SELECT unnest(ARRAY['locations_resolved','floor_plan','rack_front_view',
                                 'warehouse_summary']) AS v LOOP
        IF NOT has_table_privilege('olo_app', 'spatial.' || r.v, 'SELECT') THEN
            RAISE EXCEPTION 'olo_app necesita SELECT sobre spatial.%', r.v;
        END IF;
        -- El privilegio revocado, tras el REVOKE de arriba.
        IF has_table_privilege('olo_app', 'spatial.' || r.v, 'INSERT') THEN
            RAISE EXCEPTION 'spatial.% conserva el privilegio de INSERT', r.v;
        END IF;
        -- Y la comprobacion que de verdad importa: que el MOTOR no la considere
        -- auto-actualizable. `has_table_privilege` mide el permiso, no la
        -- capacidad; una vista con JOIN no es escribible aunque el permiso exista.
        IF (SELECT is_insertable_into FROM information_schema.views
             WHERE table_schema = 'spatial' AND table_name = r.v) <> 'NO' THEN
            RAISE EXCEPTION
                'spatial.% es auto-actualizable: un read model no debe poder escribirse', r.v;
        END IF;
    END LOOP;

    -- Las vistas responden aunque no haya datos: un almacen vacio da 0, no error.
    PERFORM count(1) FROM spatial.locations_resolved;
    PERFORM count(1) FROM spatial.floor_plan;
    PERFORM count(1) FROM spatial.rack_front_view;
    SELECT count(1) INTO v_n FROM spatial.warehouse_summary;

    RAISE NOTICE
        'OK 0057: 4 vistas con security_invoker=true (verificado una por una) · '
        'solo SELECT para olo_app · % almacen(es) en el resumen', v_n;
END
$$;
