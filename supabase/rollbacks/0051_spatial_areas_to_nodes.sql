-- ROLLBACK de 0051_spatial_areas_to_nodes.sql
--
-- Es el rollback más elaborado del bloque, y era el precio conocido de la Opción A:
-- hay que RECREAR `spatial.areas` y repoblarla desde los nodos, no basta un
-- movimiento inverso.
--
-- Lo que lo hace posible y acotado:
--   · La DDL original está versionada en la migración 0012 y se reproduce literal.
--   · El nodo heredó el UUID del área, así que el área se reconstruye con su
--     identificador exacto y `locations.node_id` vuelve a `area_id` verbatim.
--   · `raw_source ->> 'converted_from'` identifica EXACTAMENTE las filas creadas
--     por 0051. No se borra ningún nodo que no fuera una conversión.
--
-- ⚠ Si el importador ya creó nodos que NO vienen de `spatial.areas`, este rollback
--   los deja intactos y solo revierte las conversiones. Pero entonces
--   `spatial.locations` podría apuntar a un nodo no convertible a área, y en ese
--   caso el rollback FALLA con un mensaje explícito en lugar de perder el enlace.

DO $$
DECLARE
    v_n_nodes     int;
    v_n_locs_pre  int;
    v_fp_link_pre text;
    v_fp_link_post text;
    v_no_convertibles int;
    v_n_areas     int;
BEGIN
    SELECT count(1) INTO v_n_locs_pre FROM spatial.locations;
    SELECT md5(coalesce(string_agg(l.id::text || '>' || l.node_id::text, '|'
                                   ORDER BY l.id), ''))
      INTO v_fp_link_pre FROM spatial.locations l;

    -- ── Guarda: toda ubicación debe apuntar a un nodo CONVERTIBLE ──────────
    SELECT count(1) INTO v_no_convertibles
      FROM spatial.locations l
      JOIN spatial.nodes n ON n.id = l.node_id
     WHERE n.raw_source ->> 'converted_from' IS DISTINCT FROM 'spatial.areas';
    IF v_no_convertibles > 0 THEN
        RAISE EXCEPTION
            '% ubicacion(es) cuelgan de nodos que NO vienen de spatial.areas. '
            'Revertir 0051 perderia ese enlace: hay que deshacer primero la '
            'importacion que creo esos nodos.', v_no_convertibles;
    END IF;

    -- ── 1 · Recrear spatial.areas · DDL literal de la migración 0012 ───────
    EXECUTE $ddl$
        CREATE TABLE spatial.areas (
            id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID         NOT NULL REFERENCES core.tenants(id),
            warehouse_id  UUID         NOT NULL,
            name          VARCHAR(100) NOT NULL,
            code          VARCHAR(20)  NOT NULL,
            type          VARCHAR(30)  NOT NULL,
            max_locations INT,
            status        VARCHAR(20)  NOT NULL DEFAULT 'active',
            metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            created_by    UUID,
            updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_by    UUID,
            version       INT          NOT NULL DEFAULT 1,
            deleted_at    TIMESTAMPTZ,

            CONSTRAINT uq_area_tenant_wh_id UNIQUE (tenant_id, warehouse_id, id),
            CONSTRAINT fk_area_warehouse FOREIGN KEY (tenant_id, warehouse_id)
                REFERENCES core.warehouses (tenant_id, id),

            CONSTRAINT chk_area_type CHECK (type IN
                ('receiving','storage','picking','shipping','staging','quarantine','returns')),
            CONSTRAINT chk_area_status  CHECK (status IN ('active','inactive')),
            CONSTRAINT chk_area_version CHECK (version >= 1),
            CONSTRAINT chk_area_code    CHECK (code ~ '^[A-Z0-9][A-Z0-9-]*$'),
            CONSTRAINT chk_area_maxloc  CHECK (max_locations IS NULL OR max_locations > 0),
            CONSTRAINT chk_area_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
        )
    $ddl$;

    EXECUTE 'CREATE UNIQUE INDEX uq_area_code ON spatial.areas (tenant_id, warehouse_id, code) '
            'WHERE deleted_at IS NULL';
    EXECUTE 'CREATE INDEX idx_area_tenant ON spatial.areas (tenant_id)';
    EXECUTE 'CREATE INDEX idx_area_wh     ON spatial.areas (tenant_id, warehouse_id)';

    EXECUTE 'CREATE TRIGGER set_updated_at_area BEFORE UPDATE ON spatial.areas '
            'FOR EACH ROW EXECUTE FUNCTION core.set_updated_at()';
    EXECUTE 'CREATE TRIGGER prevent_tenant_change_area BEFORE UPDATE ON spatial.areas '
            'FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change()';

    EXECUTE 'ALTER TABLE spatial.areas ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE spatial.areas FORCE  ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY tenant_isolation ON spatial.areas '
            'AS RESTRICTIVE FOR ALL TO authenticated, olo_app '
            'USING (tenant_id = core.current_tenant_id()) '
            'WITH CHECK (tenant_id = core.current_tenant_id())';
    EXECUTE 'CREATE POLICY warehouse_scope ON spatial.areas '
            'AS PERMISSIVE FOR ALL TO authenticated, olo_app '
            'USING (core.can_access_warehouse(warehouse_id)) '
            'WITH CHECK (core.can_access_warehouse(warehouse_id))';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON spatial.areas TO olo_app';

    -- ── 2 · Repoblar desde los nodos convertidos, con su UUID original ─────
    EXECUTE $ins$
        INSERT INTO spatial.areas
            (id, tenant_id, warehouse_id, name, code, type, max_locations,
             status, metadata, created_at, created_by, updated_at, updated_by,
             version, deleted_at)
        SELECT n.id, n.tenant_id, n.warehouse_id, n.name, n.node_code,
               n.raw_source ->> 'area_type',
               (n.raw_source ->> 'max_locations')::int,
               n.status,
               coalesce(n.raw_source -> 'original_metadata', '{}'::jsonb),
               n.created_at, n.created_by, n.updated_at, n.updated_by,
               n.version, n.deleted_at
          FROM spatial.nodes n
         WHERE n.raw_source ->> 'converted_from' = 'spatial.areas'
    $ins$;

    SELECT count(1) INTO v_n_areas FROM spatial.areas;

    -- ── 3 · Repuntar spatial.locations: node_id → area_id ──────────────────
    EXECUTE 'ALTER TABLE spatial.locations ADD COLUMN area_id uuid';
    EXECUTE 'UPDATE spatial.locations SET area_id = node_id';

    EXECUTE 'DROP INDEX spatial.uq_loc_code';
    EXECUTE 'DROP INDEX spatial.idx_loc_node';
    EXECUTE 'ALTER TABLE spatial.locations DROP CONSTRAINT fk_loc_node';
    EXECUTE 'ALTER TABLE spatial.locations DROP COLUMN node_id';

    EXECUTE 'ALTER TABLE spatial.locations ALTER COLUMN area_id SET NOT NULL';
    EXECUTE 'CREATE UNIQUE INDEX uq_loc_code ON spatial.locations '
            '(tenant_id, area_id, code) WHERE deleted_at IS NULL';
    EXECUTE 'CREATE INDEX idx_loc_area ON spatial.locations (tenant_id, area_id)';
    EXECUTE 'ALTER TABLE spatial.locations ADD CONSTRAINT fk_loc_area '
            'FOREIGN KEY (tenant_id, warehouse_id, area_id) '
            'REFERENCES spatial.areas (tenant_id, warehouse_id, id)';
    EXECUTE $c$COMMENT ON CONSTRAINT fk_loc_area ON spatial.locations IS
        'FK TRIPLE: impide que una ubicacion cuelgue de un area de otro almacen o de otro tenant.'$c$;

    -- ── 4 · Borrar SOLO lo que creó 0051 ───────────────────────────────────
    SELECT count(1) INTO v_n_nodes FROM spatial.nodes
     WHERE raw_source ->> 'converted_from' = 'spatial.areas';
    DELETE FROM spatial.nodes WHERE raw_source ->> 'converted_from' = 'spatial.areas';
    DELETE FROM spatial.sites WHERE raw_source ->> 'created_by_migration' = '0051';

    -- ── 5 · Verificación de restauración exacta ────────────────────────────
    IF v_n_areas <> v_n_nodes THEN
        RAISE EXCEPTION 'se recrearon % areas desde % nodos', v_n_areas, v_n_nodes;
    END IF;
    IF (SELECT count(1) FROM spatial.locations) <> v_n_locs_pre THEN
        RAISE EXCEPTION 'las ubicaciones cambiaron de numero en el rollback';
    END IF;

    SELECT md5(coalesce(string_agg(l.id::text || '>' || l.area_id::text, '|'
                                   ORDER BY l.id), ''))
      INTO v_fp_link_post FROM spatial.locations l;
    IF v_fp_link_post <> v_fp_link_pre THEN
        RAISE EXCEPTION 'la huella del enlace cambio en el rollback: % -> %',
                        v_fp_link_pre, v_fp_link_post;
    END IF;

    IF EXISTS (SELECT 1 FROM spatial.locations l
                WHERE NOT EXISTS (SELECT 1 FROM spatial.areas a WHERE a.id = l.area_id)) THEN
        RAISE EXCEPTION 'alguna ubicacion quedo sin area tras el rollback';
    END IF;

    RAISE NOTICE
        'OK rollback 0051: spatial.areas recreada con % fila(s) y su UUID original · '
        '% ubicacion(es) repuntadas a area_id · huella del enlace IDENTICA · '
        '% nodo(s) convertido(s) y sus sitios eliminados · nada mas tocado',
        v_n_areas, v_n_locs_pre, v_n_nodes;
END
$$;

COMMENT ON TABLE spatial.locations IS
    'Ubicaciones fisicas. TRASLADADA de core.locations en 0048 conservando OID y filas. Unica fuente de verdad espacial (ADR-009 D2). La OCUPACION no vive aqui: es del snapshot de wms (ADR-010 SPA-11).';
COMMENT ON TABLE spatial.areas IS
    'Areas de almacenamiento. TRASLADADA de core.areas en 0048 conservando OID y filas. Se convierte en spatial.nodes en 0051 y esta tabla se elimina: no escribas codigo nuevo contra ella.';
