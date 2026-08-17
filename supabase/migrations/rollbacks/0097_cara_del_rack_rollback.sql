-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0097 · Se quita la cara del rack
--
-- ── LO QUE SE PIERDE ──────────────────────────────────────────────────────────
--
-- Las caras las declaró A MANO quien modela, mirando por qué lado se saca la mercancía en
-- cada rack. No sale de la importación ni se puede deducir del catálogo, así que deshacer
-- esto no se recupera de ningún sitio: habría que volver a recorrer el almacén.
--
-- Por eso se para si hay alguna declarada. Quien de verdad quiera deshacer, que las borre
-- antes a mano, y así sea una decisión y no un descubrimiento.
--
-- ── QUE PASA DESPUES ──────────────────────────────────────────────────────────
--
-- El visor vuelve a pintar las placas de huecos por LAS DOS caras largas de cada rack. Para
-- un rack suelto es el compromiso de siempre; para un rack doble vuelve a ser falso, con las
-- dos caras interiores solapadas mostrando datos contradictorios sobre un plano por el que
-- no se coge nada.
--
-- ── EL ORDEN ──────────────────────────────────────────────────────────────────
--
-- `CREATE OR REPLACE VIEW` no puede QUITAR una columna, solo añadir al final, y la columna
-- no se suelta mientras la vista la use. Así que: tirar la vista, soltar la columna, y
-- volver a crearla como la dejó 0096. El `CHECK` se va con la columna; se nombra igualmente
-- para que quede claro que no se queda suelto.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_con_cara int;
BEGIN
    SELECT count(facing) INTO v_con_cara FROM spatial.rack_placements;

    IF v_con_cara > 0 THEN
        RAISE EXCEPTION
            'hay % rack(s) con la cara declarada. La declaro a mano quien modela mirando por '
            'que lado se saca la mercancia, y no se recupera de ninguna importacion. '
            'Borralas a mano si de verdad quieres deshacer.', v_con_cara;
    END IF;
END $$;

DROP VIEW IF EXISTS spatial.v_rack_placements;

ALTER TABLE spatial.rack_placements
    DROP CONSTRAINT IF EXISTS chk_placement_facing;

ALTER TABLE spatial.rack_placements
    DROP COLUMN IF EXISTS facing;

--  La vista como la dejó 0096: lo de 0097 sin `facing`.
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
       p.updated_at,
       p.group_key
  FROM spatial.rack_placements p
  JOIN spatial.nodes n
    ON n.tenant_id = p.tenant_id
   AND n.warehouse_id = p.warehouse_id
   AND n.id = p.rack_node_id
 WHERE n.deleted_at IS NULL;

GRANT SELECT ON spatial.v_rack_placements TO olo_app, authenticated;

DO $$
DECLARE
    v_cols int;
BEGIN
    SELECT count(*) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'spatial' AND table_name = 'v_rack_placements';
    IF v_cols <> 18 THEN
        RAISE EXCEPTION 'la vista deberia volver a 18 columnas y tiene %', v_cols;
    END IF;

    RAISE NOTICE 'OK · 0097 deshecha. El visor vuelve a pintar las dos caras de cada rack.';
END $$;
