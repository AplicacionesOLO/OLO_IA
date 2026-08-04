-- ══════════════════════════════════════════════════════════════════════════════
-- 0068 · Ocupación: lo que hay en cada hueco, derivado del snapshot del WMS
--
-- El catálogo espacial dice DÓNDE está cada hueco. El snapshot del WMS dice QUÉ tiene.
-- Esta migración une las dos cosas y expone la ocupación, que es la pregunta que el
-- almacén se hace todos los días y que hasta ahora no se podía contestar: la capa de
-- mapa de calor del explorador estaba deshabilitada y el visor 3D no podía colorear
-- por ocupación porque el dato no existía.
--
-- ── LA OCUPACIÓN SE DERIVA, NO SE GUARDA ────────────────────────────────────
--
-- No hay ninguna columna `ocupado`. Un hueco está ocupado si y solo si el snapshot
-- vigente tiene una línea de stock apuntando a él, y eso es una consulta.
--
-- Guardarlo como booleano crearía un dato que hay que mantener sincronizado con las
-- líneas que lo justifican, y en cuanto llegara un snapshot nuevo habría que
-- recorrer las 29.312 ubicaciones para actualizarlo. Peor: si la actualización
-- fallara a medias, quedaría un almacén donde la mitad de los huecos miente y la
-- otra no, sin forma de saber cuál es cuál.
--
-- ── EL SNAPSHOT «VIGENTE» ES UNA DECISIÓN, Y ESTÁ AQUÍ ─────────────────────
--
-- Puede haber varias fotos del mismo almacén: la del martes y la de hoy. La vigente
-- es la de `taken_at` más reciente entre las que están `ready`. Las que están
-- `loading` NO cuentan: una foto a medias es peor que ninguna, porque parece
-- completa.
--
-- Que la elección viva en una vista y no en cada consulta importa: si cada endpoint
-- eligiera por su cuenta, el mapa de calor podría estar pintando la foto de ayer
-- mientras la tabla muestra la de hoy, y las dos parecerían correctas.
--
-- ── LO QUE NO AFIRMA ────────────────────────────────────────────────────────
--
-- «Ocupado» aquí significa «el WMS dice que hay algo». NO significa que alguien lo
-- haya visto: para eso están las observaciones de la flota (0067), que son otra
-- fuente y pueden CONTRADECIR a esta. Esa contradicción es información valiosa —un
-- hueco que el WMS cree lleno y el dron ve vacío es un descuadre— y se puede
-- consultar precisamente porque las dos fuentes se guardan por separado.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1 · Permisos ───────────────────────────────────────────────────────────
-- `inventory:read` ya existe (0013) y ya está asignado a los cinco roles. No hace
-- falta uno nuevo: leer la ocupación es leer inventario.
--
-- Se comprueba en lugar de asumirlo: si el permiso no estuviera, los endpoints
-- quedarían accesibles para nadie y el síntoma sería un 403 sin explicación.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM core.permissions WHERE code = 'inventory:read') THEN
        RAISE EXCEPTION 'falta el permiso inventory:read, que 0013 deberia haber creado';
    END IF;
END $$;


-- ── 2 · El snapshot vigente de cada almacén ────────────────────────────────
CREATE VIEW inventory.v_current_snapshot AS
SELECT DISTINCT ON (s.tenant_id, s.warehouse_id)
       s.tenant_id,
       s.warehouse_id,
       s.id AS snapshot_id,
       s.taken_at,
       s.received_at,
       s.source,
       s.row_count,
       s.notes
  FROM inventory.wms_snapshots s
 WHERE s.status = 'ready'
   AND s.deleted_at IS NULL
 ORDER BY s.tenant_id, s.warehouse_id, s.taken_at DESC, s.received_at DESC;

ALTER VIEW inventory.v_current_snapshot SET (security_invoker = true);

COMMENT ON VIEW inventory.v_current_snapshot IS
    'La foto vigente por almacen: la mas reciente en estado ready. Las que estan loading NO cuentan: una foto a medias parece completa.';


-- ── 3 · Ocupación por UBICACIÓN ────────────────────────────────────────────
-- Una fila por hueco del catálogo, ocupado o no. Se parte de `spatial.locations` y
-- NO del stock, y esa dirección es la que hace útil la vista: partiendo del stock
-- solo se verían los huecos llenos, y la pregunta que importa —«¿qué queda libre?»—
-- no tendría respuesta.
CREATE VIEW inventory.v_location_occupancy AS
SELECT l.tenant_id,
       l.warehouse_id,
       l.id                       AS location_id,
       l.code                     AS location_code,
       l.node_id                  AS bay_id,
       l.logical_level            AS level,
       l.status                   AS spatial_status,
       l.location_situation       AS wms_situation,
       cs.snapshot_id,
       cs.taken_at,
       -- Ocupado = el snapshot vigente tiene alguna línea aquí. `count` y no un
       -- `EXISTS` porque el número de líneas es dato: un hueco con 14 líneas
       -- distintas es un hueco compartido por 14 SKU, y eso se quiere ver.
       count(st.id)               AS lines,
       (count(st.id) > 0)         AS occupied,
       count(DISTINCT st.pallet_code) AS pallets,
       count(DISTINCT st.sku)     AS skus,
       count(DISTINCT st.client_id) AS clients,
       sum(st.qty)                AS units,
       min(st.expires_at)         AS first_expiry
  FROM spatial.locations l
  LEFT JOIN inventory.v_current_snapshot cs
       ON cs.tenant_id = l.tenant_id AND cs.warehouse_id = l.warehouse_id
  LEFT JOIN inventory.wms_stock st
       ON st.snapshot_id = cs.snapshot_id AND st.location_id = l.id
 WHERE l.deleted_at IS NULL
 GROUP BY l.tenant_id, l.warehouse_id, l.id, l.code, l.node_id, l.logical_level,
          l.status, l.location_situation, cs.snapshot_id, cs.taken_at;

ALTER VIEW inventory.v_location_occupancy SET (security_invoker = true);

COMMENT ON VIEW inventory.v_location_occupancy IS
    'Una fila por hueco del catalogo, ocupado o no. Parte de spatial.locations y no del stock: partiendo del stock, «que queda libre» no tendria respuesta.';


-- ── 4 · Ocupación por RACK ─────────────────────────────────────────────────
-- Es la que alimenta el mapa de calor y el color por ocupación del visor 3D: 347
-- filas en lugar de 29.312, agregadas en la base.
--
-- Agregar aquí y no en el cliente no es una optimización cosmética: son 29.312 filas
-- por el cable para pintar 347 cajas, y el navegador tendría que reagruparlas en
-- cada fotograma del giro de la cámara.
CREATE VIEW inventory.v_rack_occupancy AS
SELECT o.tenant_id,
       o.warehouse_id,
       r.id                                  AS rack_id,
       r.node_code                           AS rack_code,
       r.node_function,
       o.snapshot_id,
       o.taken_at,
       count(*)                              AS locations,
       count(*) FILTER (WHERE o.occupied)    AS occupied,
       count(*) FILTER (WHERE NOT o.occupied) AS free,
       -- El porcentaje se calcula aquí para que TODOS lo calculen igual. Con
       -- `nullif` porque un rack sin ubicaciones daría división por cero, y devolver
       -- 0 % diría «está vacío» cuando lo cierto es «no tiene huecos».
       round(100.0 * count(*) FILTER (WHERE o.occupied) / nullif(count(*), 0), 1)
                                             AS occupancy_pct,
       sum(o.units)                          AS units,
       sum(o.pallets)                        AS pallets,
       count(DISTINCT o.location_id) FILTER (WHERE o.spatial_status = 'blocked') AS blocked,
       min(o.first_expiry)                   AS first_expiry
  FROM inventory.v_location_occupancy o
  JOIN spatial.nodes b ON b.id = o.bay_id
  JOIN spatial.nodes r ON r.id = b.parent_node_id AND r.node_type = 'rack'
 GROUP BY o.tenant_id, o.warehouse_id, r.id, r.node_code, r.node_function,
          o.snapshot_id, o.taken_at;

ALTER VIEW inventory.v_rack_occupancy SET (security_invoker = true);

COMMENT ON VIEW inventory.v_rack_occupancy IS
    'Ocupacion agregada por rack: 347 filas en vez de 29.312. Alimenta el mapa de calor y el color por ocupacion del visor 3D.';


-- ── 5 · El descuadre entre lo que el WMS DICE y lo que TIENE ───────────────
-- El catálogo trae `location_situation` del WMS —OCUP, DISP…— y el snapshot trae las
-- líneas de stock. Los dos vienen del mismo sistema y pueden contradecirse: un hueco
-- marcado OCUP sin ninguna línea, o uno marcado DISP con 14.
--
-- Se expone porque es exactamente el tipo de dato que nadie mira hasta que algo no
-- cuadra, y entonces hay que poder mirarlo sin escribir una consulta. `summary` ya
-- cuenta 2.365 contradicciones entre estado y situación; esta vista es la otra mitad.
CREATE VIEW inventory.v_occupancy_mismatch AS
SELECT o.tenant_id,
       o.warehouse_id,
       o.location_id,
       o.location_code,
       o.wms_situation,
       o.spatial_status,
       o.lines,
       o.units,
       CASE
           WHEN o.wms_situation = 'OCUP' AND o.lines = 0 THEN 'dice_ocupado_sin_stock'
           WHEN o.wms_situation = 'DISP' AND o.lines > 0 THEN 'dice_libre_con_stock'
           WHEN o.spatial_status = 'blocked' AND o.lines > 0 THEN 'bloqueado_con_stock'
       END AS mismatch
  FROM inventory.v_location_occupancy o
 WHERE (o.wms_situation = 'OCUP' AND o.lines = 0)
    OR (o.wms_situation = 'DISP' AND o.lines > 0)
    OR (o.spatial_status = 'blocked' AND o.lines > 0);

ALTER VIEW inventory.v_occupancy_mismatch SET (security_invoker = true);

COMMENT ON VIEW inventory.v_occupancy_mismatch IS
    'Huecos donde el WMS se contradice consigo mismo: dice OCUP y no tiene stock, dice DISP y si lo tiene, o esta bloqueado con carga.';


-- ── 6 · Stock huérfano: líneas que apuntan a un hueco que no existe ───────
-- 773 líneas medidas. Son un dato REAL del WMS que apunta a un sitio que el catálogo
-- espacial no conoce, y por eso no se descartan al importar: descartarlas escondería
-- una discrepancia entre los dos sistemas, y con ella la pregunta de quién de los
-- dos está desactualizado.
CREATE VIEW inventory.v_orphan_stock AS
SELECT st.tenant_id,
       st.warehouse_id,
       st.snapshot_id,
       st.location_code,
       count(*)                       AS lines,
       count(DISTINCT st.pallet_code) AS pallets,
       sum(st.qty)                    AS units
  FROM inventory.wms_stock st
 WHERE st.location_id IS NULL
 GROUP BY st.tenant_id, st.warehouse_id, st.snapshot_id, st.location_code;

ALTER VIEW inventory.v_orphan_stock SET (security_invoker = true);

COMMENT ON VIEW inventory.v_orphan_stock IS
    'Lineas de stock cuyo codigo de ubicacion no existe en el catalogo espacial. No se descartan al importar: son la discrepancia entre los dos sistemas.';


-- ── 7 · Índices que estas vistas necesitan ────────────────────────────────
-- `v_location_occupancy` une 29.312 ubicaciones con 41.055 líneas por `location_id`
-- y `snapshot_id`. Sin este índice es un recorrido completo del stock por consulta.
CREATE INDEX IF NOT EXISTS ix_stock_snapshot_location
    ON inventory.wms_stock (snapshot_id, location_id);

-- Por almacén y hueco: es como se pregunta por una ubicación concreta.
CREATE INDEX IF NOT EXISTS ix_stock_warehouse_location
    ON inventory.wms_stock (warehouse_id, location_id);

-- El pallet es la unidad que se mueve, y «¿dónde está este pallet?» es la consulta
-- que hace quien lo busca por el almacén.
CREATE INDEX IF NOT EXISTS ix_stock_pallet
    ON inventory.wms_stock (pallet_code)
    WHERE pallet_code IS NOT NULL;

-- El SKU: «¿en qué huecos está este artículo?».
CREATE INDEX IF NOT EXISTS ix_stock_sku
    ON inventory.wms_stock (tenant_id, sku)
    WHERE sku IS NOT NULL;

-- La foto vigente se busca por almacén y fecha en cada consulta de ocupación.
CREATE INDEX IF NOT EXISTS ix_snapshot_vigente
    ON inventory.wms_snapshots (tenant_id, warehouse_id, taken_at DESC)
    WHERE status = 'ready' AND deleted_at IS NULL;


-- ── 8 · Permisos de lectura ────────────────────────────────────────────────
-- `security_invoker` en las cinco vistas, así que RLS filtra con el contexto de quien
-- consulta: sin él la vista leería con los permisos de su propietario y un tenant
-- vería el inventario de otro.
GRANT SELECT ON inventory.v_current_snapshot    TO olo_app;
GRANT SELECT ON inventory.v_location_occupancy  TO olo_app;
GRANT SELECT ON inventory.v_rack_occupancy      TO olo_app;
GRANT SELECT ON inventory.v_occupancy_mismatch  TO olo_app;
GRANT SELECT ON inventory.v_orphan_stock        TO olo_app;


-- ── 9 · Verificación ───────────────────────────────────────────────────────
DO $$
DECLARE
    v_vistas int;
    v_idx    int;
    v_sin_si int;
BEGIN
    SELECT count(*) INTO v_vistas FROM pg_views
     WHERE schemaname = 'inventory'
       AND viewname IN ('v_current_snapshot', 'v_location_occupancy', 'v_rack_occupancy',
                        'v_occupancy_mismatch', 'v_orphan_stock');
    IF v_vistas <> 5 THEN
        RAISE EXCEPTION 'se esperaban 5 vistas, hay %', v_vistas;
    END IF;

    -- Sin `security_invoker` la vista consulta con los permisos de su propietario y
    -- RLS no filtra: seria una fuga entre tenants, no un detalle de configuracion.
    SELECT count(*) INTO v_sin_si
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'inventory'
       AND c.relname IN ('v_current_snapshot', 'v_location_occupancy', 'v_rack_occupancy',
                         'v_occupancy_mismatch', 'v_orphan_stock')
       AND NOT (coalesce(array_to_string(c.reloptions, ','), '') LIKE '%security_invoker=true%');
    IF v_sin_si <> 0 THEN
        RAISE EXCEPTION '% vistas sin security_invoker', v_sin_si;
    END IF;

    SELECT count(*) INTO v_idx FROM pg_indexes
     WHERE schemaname = 'inventory'
       AND indexname IN ('ix_stock_snapshot_location', 'ix_stock_warehouse_location',
                         'ix_stock_pallet', 'ix_stock_sku', 'ix_snapshot_vigente');
    IF v_idx <> 5 THEN
        RAISE EXCEPTION 'se esperaban 5 indices, hay %', v_idx;
    END IF;

    RAISE NOTICE '0068 OK · 5 vistas con security_invoker, 5 indices';
END $$;
