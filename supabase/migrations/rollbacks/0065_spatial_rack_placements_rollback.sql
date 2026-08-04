-- ═══════════════════════════════════════════════════════════════════════════
--  ROLLBACK de 0065 · colocación de los racks
--
--  ⚠ DESTRUYE TRABAJO HUMANO, y no es una frase de aviso genérica.
--
--  La colocación de los racks es el único dato del sistema que ninguna
--  importación puede regenerar: el DWG del almacén no contiene los códigos del
--  WMS. Volver a ejecutar el importador NO recupera esto; hay que volver a
--  colocar 347 racks a mano sobre el plano.
--
--  Por eso el rollback EXPORTA antes de borrar. El JSON queda en un NOTICE del
--  log de la migración, que es el único sitio al que este script puede escribir.
--  Cópialo antes de seguir.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_placements integer;
    v_layouts    integer;
    v_json       text;
BEGIN
    SELECT count(*) INTO v_placements FROM spatial.rack_placements;
    SELECT count(*) INTO v_layouts    FROM spatial.warehouse_layouts;

    IF v_placements > 0 THEN
        SELECT jsonb_pretty(jsonb_agg(to_jsonb(p) ORDER BY p.id))::text
          INTO v_json
          FROM spatial.rack_placements p;
        RAISE NOTICE 'RESPALDO de % colocaciones antes de borrar:', v_placements;
        RAISE NOTICE '%', v_json;
    END IF;

    RAISE NOTICE 'Se van a eliminar % colocaciones y % layouts.', v_placements, v_layouts;
END $$;

DROP VIEW  IF EXISTS spatial.v_rack_placements;
DROP TABLE IF EXISTS spatial.rack_placements;
DROP TABLE IF EXISTS spatial.warehouse_layouts;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'spatial'
           AND table_name IN ('rack_placements', 'warehouse_layouts')
    ) THEN
        RAISE EXCEPTION 'El rollback no elimino las tablas';
    END IF;
    RAISE NOTICE 'Rollback 0065 OK';
END $$;

