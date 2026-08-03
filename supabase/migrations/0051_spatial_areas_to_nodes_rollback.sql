-- ═══════════════════════════════════════════════════════════════════════════
-- 0051_spatial_areas_to_nodes_rollback.sql
-- Revierte : 0051 · recrea `spatial.areas` y devuelve `locations.node_id` a
--            `locations.area_id`
--
-- ── Por qué esta reversión es distinta de las demás ────────────────────────
--
-- 0051 no añadió: **transformó**. Convirtió cada área en un nodo REUTILIZANDO su
-- UUID, repuntó `locations.area_id` → `node_id` verbatim y eliminó
-- `spatial.areas`. Mientras solo existan nodos que fueron áreas, la vuelta es
-- exacta: el UUID no cambió, así que las ubicaciones siguen apuntando al mismo
-- identificador y basta con recrear la tabla y renombrar la columna.
--
-- ⚠ Deja de ser exacta en cuanto hay nodos que **nunca fueron áreas**. Hoy hay
--   347 `rack` y 2.701 `bay` creados por el importador. Convertirlos en áreas
--   inventaría 3.048 áreas que nunca existieron, con un `type` elegido a dedo, y
--   las 29.310 ubicaciones apuntarían a ellas. Eso no es revertir: es fabricar
--   historia.
--
--   Por eso ABORTA si existe cualquier nodo que no sea `storage_area`. Es
--   reversible sobre una base sin catálogo importado, que es exactamente el
--   estado en el que 0051 se aplicó.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_ajenos int; v_tipos text;
BEGIN
    SELECT count(1), string_agg(DISTINCT node_type, ', ' ORDER BY node_type)
      INTO v_ajenos, v_tipos
      FROM spatial.nodes WHERE node_type <> 'storage_area';

    IF v_ajenos > 0 THEN
        RAISE EXCEPTION
            'NO se puede revertir 0051: existen % nodo(s) que nunca fueron areas '
            '(tipos: %). Convertirlos en areas inventaria una estructura que no '
            'existio. Vacie el catalogo espacial primero.', v_ajenos, v_tipos;
    END IF;
END
$$;

-- ── 1 · Recrear `spatial.areas` con la forma que tenía en 0012 ─────────────
CREATE TABLE spatial.areas (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid         NOT NULL REFERENCES core.tenants(id),
    warehouse_id  uuid         NOT NULL,
    name          varchar(100) NOT NULL,
    code          varchar(20)  NOT NULL,
    type          varchar(30)  NOT NULL,
    max_locations int,
    status        varchar(20)  NOT NULL DEFAULT 'active',
    metadata      jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    uuid,
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    updated_by    uuid,
    version       int          NOT NULL DEFAULT 1,
    deleted_at    timestamptz,

    CONSTRAINT uq_area_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id),
    CONSTRAINT fk_area_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id),
    CONSTRAINT chk_area_type CHECK (type IN
        ('receiving','storage','picking','shipping','staging','quarantine','returns')),
    CONSTRAINT chk_area_status  CHECK (status IN ('active','inactive')),
    CONSTRAINT chk_area_version CHECK (version >= 1)
);

CREATE UNIQUE INDEX uq_area_code ON spatial.areas (tenant_id, warehouse_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_area_tenant ON spatial.areas (tenant_id);
CREATE INDEX idx_area_wh ON spatial.areas (tenant_id, warehouse_id);

ALTER TABLE spatial.areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial.areas FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON spatial.areas
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (tenant_id = (SELECT core.current_tenant_id()))
    WITH CHECK (tenant_id = (SELECT core.current_tenant_id()));
-- El predicado va envuelto en `(SELECT …)` desde el principio: la lección de 0060
-- se aplica también a una tabla que se recrea, no solo a las que ya existían.
CREATE POLICY warehouse_scope ON spatial.areas
    AS PERMISSIVE FOR ALL TO authenticated, olo_app
    USING (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()),
                                             '{}'::uuid[])))
    )
    WITH CHECK (
        (SELECT core.current_tenant_id() IS NOT NULL AND core.has_active_membership())
        AND ((SELECT core.has_tenant_wide_access())
             OR warehouse_id = ANY (COALESCE((SELECT core.accessible_warehouse_ids()),
                                             '{}'::uuid[])))
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.areas TO olo_app;

-- ── 2 · Repoblar desde los nodos, con el MISMO UUID ───────────────────────
-- `node_function` → `type` por la correspondencia que 0051 usó en sentido
-- contrario. Un valor sin correspondencia se queda en 'storage', que es lo que
-- 0012 admite y lo que 0051 asumió.
INSERT INTO spatial.areas
    (id, tenant_id, warehouse_id, name, code, type, status,
     created_at, created_by, updated_at, updated_by, version, deleted_at)
SELECT n.id, n.tenant_id, n.warehouse_id,
       coalesce(n.name, n.node_code), n.node_code,
       CASE n.node_function
            WHEN 'storage'    THEN 'storage'
            WHEN 'picking'    THEN 'picking'
            WHEN 'receiving'  THEN 'receiving'
            WHEN 'shipping'   THEN 'shipping'
            WHEN 'staging'    THEN 'staging'
            WHEN 'quarantine' THEN 'quarantine'
            WHEN 'returns'    THEN 'returns'
            ELSE 'storage'
       END,
       CASE WHEN n.deleted_at IS NULL THEN 'active' ELSE 'inactive' END,
       n.created_at, n.created_by, n.updated_at, n.updated_by, 1, n.deleted_at
  FROM spatial.nodes n
 WHERE n.node_type = 'storage_area';

-- ── 3 · `node_id` → `area_id`, verbatim ───────────────────────────────────
DROP INDEX IF EXISTS spatial.uq_loc_code;
DROP INDEX IF EXISTS spatial.idx_loc_node;

ALTER TABLE spatial.locations
    DROP CONSTRAINT IF EXISTS fk_loc_node,
    ALTER COLUMN node_id DROP NOT NULL;
ALTER TABLE spatial.locations RENAME COLUMN node_id TO area_id;

CREATE UNIQUE INDEX uq_loc_code ON spatial.locations (tenant_id, area_id, code)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_loc_area ON spatial.locations (tenant_id, area_id);

ALTER TABLE spatial.locations
    ADD CONSTRAINT fk_loc_area
        FOREIGN KEY (tenant_id, warehouse_id, area_id)
        REFERENCES spatial.areas (tenant_id, warehouse_id, id),
    ALTER COLUMN area_id SET NOT NULL;

-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE v_areas int; v_nodos int; v_huerfanas int; v_n int;
BEGIN
    SELECT count(1) INTO v_areas FROM spatial.areas;
    SELECT count(1) INTO v_nodos FROM spatial.nodes WHERE node_type = 'storage_area';
    IF v_areas <> v_nodos THEN
        RAISE EXCEPTION 'se recrearon % areas para % nodos storage_area', v_areas, v_nodos;
    END IF;

    -- Ninguna ubicación quedó apuntando a un identificador que no existe. Es la
    -- comprobación que demuestra que el UUID se conservó de verdad.
    SELECT count(1) INTO v_huerfanas FROM spatial.locations l
     WHERE NOT EXISTS (SELECT 1 FROM spatial.areas a WHERE a.id = l.area_id);
    IF v_huerfanas <> 0 THEN
        RAISE EXCEPTION '% ubicacion(es) apuntan a un area inexistente', v_huerfanas;
    END IF;

    SELECT count(1) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'locations'
       AND column_name = 'node_id';
    IF v_n <> 0 THEN RAISE EXCEPTION '`node_id` deberia haber desaparecido'; END IF;

    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname = 'areas'
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_n <> 1 THEN RAISE EXCEPTION 'spatial.areas sin FORCE RLS'; END IF;

    RAISE NOTICE 'OK rollback 0051: % area(s) recreada(s) con su UUID original · '
                 'area_id restaurado · 0 ubicaciones huerfanas · FORCE RLS',
                 v_areas;
END
$$;
