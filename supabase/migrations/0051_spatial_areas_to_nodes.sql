-- ═══════════════════════════════════════════════════════════════════════════
-- 0051_spatial_areas_to_nodes.sql
-- Convierte: spatial.areas → spatial.nodes · repunta spatial.locations
-- ELIMINA  : spatial.areas
-- Depende de: 0048 (traslado), 0049 (sites), 0050 (nodes)
-- Riesgo   : ALTO · transforma datos y borra una tabla
--
-- Es la migración que cumple la Opción A: al terminar esta fase existe UN SOLO
-- modelo espacial. `spatial.areas` no sobrevive con un plan de retirada, porque los
-- planes de retirada se posponen y el importador poblará el árbol con 347 áreas en
-- el bloque siguiente — en ese momento habría dos tablas describiendo áreas de
-- almacenamiento, ambas con RLS, y nadie sabría cuál manda.
--
-- ⚠ EL NODO REUTILIZA EL UUID DEL ÁREA. No es un detalle de comodidad: hace que
--   `locations.area_id` se copie VERBATIM a `locations.node_id`, que ninguna
--   referencia externa al identificador se rompa, y que el rollback pueda
--   reconstruir el área desde el nodo sin tabla de correspondencia.
--
-- MAPEO DE VOCABULARIO. `core.areas.type` resultó ser FUNCIONAL, no estructural:
-- sus 7 valores —receiving, storage, picking, shipping, staging, quarantine,
-- returns— existen todos como `node_function` en el catálogo de 0050. Así que:
--       area.type   →  node_function   (la función operativa)
--       node_type   =  'storage_area'  (la estructura: contiene ubicaciones)
-- Es exactamente la separación de ADR-010 §6, aplicada al dato heredado.
--
-- LO QUE NO SE PIERDE. `spatial.nodes` no tiene `max_locations` ni `metadata`, así
-- que ambos se conservan en `raw_source` (principio 3: los valores originales se
-- guardan cuando hay ambigüedad de significado). `raw_source` lleva además el
-- marcador `converted_from`, que es lo que permite al rollback identificar
-- EXACTAMENTE las filas que esta migración creó.
--
-- SITIOS. Los nodos necesitan un sitio y `spatial.sites` está vacía. Se crea UNO
-- por almacén con áreas, con `is_validated = false` y `external_site_code = NULL`:
-- decisión A1, no se afirma nada sobre el espacio físico.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    -- Estado ANTES
    v_n_areas_pre int;
    v_n_locs_pre  int;
    v_fp_locs_pre text;
    v_fp_link_pre text;
    -- Estado DESPUÉS
    v_n_nodes     int;
    v_n_sites     int;
    v_n_locs_post int;
    v_fp_link_post text;
    v_huerfanas   int;
BEGIN
    SELECT count(1) INTO v_n_areas_pre FROM spatial.areas;
    SELECT count(1) INTO v_n_locs_pre  FROM spatial.locations;

    -- Huella de las ubicaciones SIN la columna que va a cambiar de nombre, para
    -- poder compararla después: `area_id` desaparece, `node_id` ocupa su lugar con
    -- el mismo valor.
    SELECT md5(coalesce(string_agg(
             l.id::text || ';' || l.code || ';' || l.type || ';' ||
             coalesce(l.level::text, '-') || ';' || l.status, '|' ORDER BY l.id), ''))
      INTO v_fp_locs_pre FROM spatial.locations l;

    -- Huella del ENLACE ubicación → área. Es la que demuestra que la jerarquía
    -- sobrevive: los mismos pares (ubicación, contenedor) antes y después.
    SELECT md5(coalesce(string_agg(l.id::text || '>' || l.area_id::text, '|'
                                   ORDER BY l.id), ''))
      INTO v_fp_link_pre FROM spatial.locations l;

    RAISE NOTICE 'ANTES  areas=% locations=% huella_locs=% huella_enlace=%',
                 v_n_areas_pre, v_n_locs_pre, v_fp_locs_pre, v_fp_link_pre;

    -- ── 1 · UN SITIO por almacén con áreas ─────────────────────────────────
    INSERT INTO spatial.sites
        (tenant_id, warehouse_id, name, code, is_validated, external_site_code, raw_source)
    SELECT DISTINCT a.tenant_id, a.warehouse_id,
           'Sitio unico (sin validar)', 'DEFAULT',
           false, NULL,
           jsonb_build_object('created_by_migration', '0051',
                              'reason', 'los nodos convertidos necesitan un sitio')
      FROM spatial.areas a
     WHERE a.deleted_at IS NULL;

    -- ── 2 · CADA ÁREA se convierte en un NODO, con su MISMO UUID ───────────
    INSERT INTO spatial.nodes
        (id, tenant_id, warehouse_id, site_id, parent_node_id,
         node_type, node_function, node_code, name, status, raw_source,
         created_at, created_by, updated_at, updated_by, version, deleted_at)
    SELECT a.id,                       -- ⚠ el MISMO identificador
           a.tenant_id, a.warehouse_id,
           s.id,
           NULL,                       -- raíz: el árbol heredado tiene un nivel
           'storage_area',             -- la ESTRUCTURA
           a.type,                     -- la FUNCIÓN: los 7 valores existen en el catálogo
           a.code, a.name,
           a.status,
           jsonb_build_object(
               'converted_from',   'spatial.areas',
               'converted_by',     '0051',
               'area_type',        a.type,
               'max_locations',    a.max_locations,
               'original_metadata', a.metadata
           ),
           a.created_at, a.created_by, a.updated_at, a.updated_by,
           a.version, a.deleted_at
      FROM spatial.areas a
      JOIN spatial.sites s ON s.tenant_id = a.tenant_id
                          AND s.warehouse_id = a.warehouse_id
                          AND s.code = 'DEFAULT';

    -- ── 3 · REPUNTAR spatial.locations: area_id → node_id ──────────────────
    EXECUTE 'ALTER TABLE spatial.locations ADD COLUMN node_id uuid';
    EXECUTE 'UPDATE spatial.locations SET node_id = area_id';

    -- El índice único y el de área citan `area_id`: hay que sustituirlos antes de
    -- poder borrar la columna.
    EXECUTE 'DROP INDEX spatial.uq_loc_code';
    EXECUTE 'DROP INDEX spatial.idx_loc_area';
    EXECUTE 'ALTER TABLE spatial.locations DROP CONSTRAINT fk_loc_area';
    EXECUTE 'ALTER TABLE spatial.locations DROP COLUMN area_id';

    EXECUTE 'ALTER TABLE spatial.locations ALTER COLUMN node_id SET NOT NULL';
    EXECUTE 'CREATE UNIQUE INDEX uq_loc_code ON spatial.locations '
            '(tenant_id, node_id, code) WHERE deleted_at IS NULL';
    EXECUTE 'CREATE INDEX idx_loc_node ON spatial.locations (tenant_id, node_id)';

    -- La FK TRIPLE se reconstruye contra `nodes`: una ubicación no puede colgar de
    -- un nodo de otro almacén ni de otro tenant. Misma garantía que tenía con áreas.
    EXECUTE 'ALTER TABLE spatial.locations ADD CONSTRAINT fk_loc_node '
            'FOREIGN KEY (tenant_id, warehouse_id, node_id) '
            'REFERENCES spatial.nodes (tenant_id, warehouse_id, id)';

    EXECUTE $c$COMMENT ON CONSTRAINT fk_loc_node ON spatial.locations IS
        'FK TRIPLE: impide que una ubicacion cuelgue de un nodo de otro almacen o de otro tenant. Sustituye a fk_loc_area en 0051.'$c$;

    -- ── 4 · spatial.areas DESAPARECE ───────────────────────────────────────
    EXECUTE 'DROP TABLE spatial.areas';

    -- ── 5 · VERIFICACIÓN ───────────────────────────────────────────────────
    SELECT count(1) INTO v_n_nodes FROM spatial.nodes
     WHERE raw_source ->> 'converted_from' = 'spatial.areas';
    SELECT count(1) INTO v_n_sites FROM spatial.sites
     WHERE raw_source ->> 'created_by_migration' = '0051';
    SELECT count(1) INTO v_n_locs_post FROM spatial.locations;

    IF v_n_nodes <> v_n_areas_pre THEN
        RAISE EXCEPTION 'se convirtieron % areas en nodos, habia %',
                        v_n_nodes, v_n_areas_pre;
    END IF;
    IF v_n_locs_post <> v_n_locs_pre THEN
        RAISE EXCEPTION 'las ubicaciones cambiaron de numero: % -> %',
                        v_n_locs_pre, v_n_locs_post;
    END IF;

    -- El enlace debe ser IDÉNTICO: mismo par (ubicación, contenedor), porque el
    -- nodo heredó el UUID del área.
    SELECT md5(coalesce(string_agg(l.id::text || '>' || l.node_id::text, '|'
                                   ORDER BY l.id), ''))
      INTO v_fp_link_post FROM spatial.locations l;
    IF v_fp_link_post <> v_fp_link_pre THEN
        RAISE EXCEPTION
            'la huella del enlace cambio: % -> %. El nodo deberia haber heredado el '
            'UUID del area', v_fp_link_pre, v_fp_link_post;
    END IF;

    -- Ninguna ubicación puede haber quedado sin nodo.
    SELECT count(1) INTO v_huerfanas FROM spatial.locations l
     WHERE NOT EXISTS (SELECT 1 FROM spatial.nodes n WHERE n.id = l.node_id);
    IF v_huerfanas <> 0 THEN
        RAISE EXCEPTION '% ubicacion(es) apuntan a un nodo inexistente', v_huerfanas;
    END IF;

    -- `spatial.areas` ya no existe.
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'spatial' AND c.relname = 'areas') THEN
        RAISE EXCEPTION 'spatial.areas sigue existiendo';
    END IF;

    -- Y la función heredada se mapeó: ninguna conversión sin node_function.
    IF EXISTS (SELECT 1 FROM spatial.nodes
                WHERE raw_source ->> 'converted_from' = 'spatial.areas'
                  AND node_function IS NULL) THEN
        RAISE EXCEPTION 'algun nodo convertido quedo sin node_function';
    END IF;

    RAISE NOTICE
        'DESPUES % nodo(s) convertido(s) · % sitio(s) creado(s) · % ubicacion(es) '
        'repuntadas · huella del enlace IDENTICA · spatial.areas eliminada · '
        'UN SOLO modelo espacial',
        v_n_nodes, v_n_sites, v_n_locs_post;
END
$$;


COMMENT ON TABLE spatial.locations IS
    'Ubicaciones fisicas. UNICA fuente de verdad espacial. Cuelgan de spatial.nodes (0051), no de una tabla de areas. La OCUPACION no vive aqui: es del snapshot de wms (SPA-11).';
