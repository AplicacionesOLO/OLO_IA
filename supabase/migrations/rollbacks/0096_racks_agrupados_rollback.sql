-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0096 · Se quitan los grupos de racks
--
-- ── LO QUE SE PIERDE ──────────────────────────────────────────────────────────
--
-- Los grupos los declaró A MANO quien modela el almacén, mirando el sitio: qué dos racks
-- están de espaldas formando un rack doble. Eso no sale de ninguna importación ni se puede
-- deducir del catálogo —los códigos son consecutivos por importación, no por parejas— así
-- que deshacer esto no se recupera de ningún sitio.
--
-- Por eso se AVISA y se para si hay alguno. Quien de verdad quiera deshacer, que los borre
-- antes a mano y así sea una decisión y no un descubrimiento.
--
-- ── POR QUE SE TIRA LA VISTA EN VEZ DE REEMPLAZARLA ───────────────────────────
--
-- `CREATE OR REPLACE VIEW` no puede QUITAR una columna, solo añadir al final. Y la columna
-- tampoco se puede soltar mientras la vista la use. Así que el orden es: tirar la vista,
-- soltar la columna, y volver a crear la vista como estaba antes de 0096.
--
-- El `CHECK` y el índice parcial se van solos con la columna; se nombran igualmente para que
-- quien lea esto sepa que no se quedan sueltos.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_grupos int;
    v_racks  int;
BEGIN
    SELECT count(DISTINCT group_key), count(group_key)
      INTO v_grupos, v_racks
      FROM spatial.rack_placements
     WHERE group_key IS NOT NULL;

    IF v_grupos > 0 THEN
        RAISE EXCEPTION
            'hay % grupo(s) con % rack(s) agrupados. Los declaro a mano quien modela el '
            'almacen mirando que racks estan de espaldas, y no se recuperan de ninguna '
            'importacion. Borralos a mano si de verdad quieres deshacer.',
            v_grupos, v_racks;
    END IF;
END $$;

DROP VIEW IF EXISTS spatial.v_rack_placements;

ALTER TABLE spatial.rack_placements
    DROP CONSTRAINT IF EXISTS chk_placement_group;

DROP INDEX IF EXISTS spatial.ix_placement_group;

ALTER TABLE spatial.rack_placements
    DROP COLUMN IF EXISTS group_key;

--  La vista como estaba: lo de 0096 sin `group_key`.
CREATE VIEW spatial.v_rack_placements
WITH (security_invoker = true) AS
SELECT p.id,
       p.tenant_id,
       p.warehouse_id,
       p.layout_id,
       p.rack_node_id,
       n.node_code AS rack_code,
       n.node_type,
       n.node_function,
       p.x_m,
       p.y_m,
       p.rotation_deg,
       p.width_m,
       p.length_m,
       p.height_m,
       p.color,
       p.is_locked,
       p.updated_at
  FROM spatial.rack_placements p
  JOIN spatial.nodes n
    ON n.tenant_id = p.tenant_id
   AND n.warehouse_id = p.warehouse_id
   AND n.id = p.rack_node_id
 WHERE n.deleted_at IS NULL;

GRANT SELECT ON spatial.v_rack_placements TO olo_app, authenticated;

DO $$
DECLARE
    v_racks int;
BEGIN
    SELECT count(*) INTO v_racks FROM spatial.v_rack_placements;
    RAISE NOTICE 'OK · 0096 deshecha. Siguen % colocacion(es) y la vista vuelve a tener sus '
                 '17 columnas.', v_racks;
END $$;
