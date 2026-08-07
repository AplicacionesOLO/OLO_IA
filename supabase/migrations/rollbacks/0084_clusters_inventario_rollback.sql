-- Rollback de 0084 · clusters de inventario.
--
-- ⚠ Borra las zonas que haya definido una persona. No es dato derivado: nadie puede
--   reconstruir «esto es la zona de picking» desde el catálogo, porque esa agrupación
--   no está en ninguna otra parte. Si hay alguna definida, expórtalas antes:
--
--     \copy (SELECT c.name, m.prefix, m.rack_id FROM inventory.clusters c
--            LEFT JOIN inventory.cluster_members m ON m.cluster_id = c.id)
--       TO 'zonas.csv' CSV HEADER
--
-- El catálogo espacial NO se toca: un cluster es una etiqueta encima, y quitarla deja
-- el almacén exactamente como estaba.

DO $$
DECLARE
    v_zonas int;
BEGIN
    IF to_regclass('inventory.clusters') IS NULL THEN
        RAISE NOTICE 'No existe: nada que revertir.';
        RETURN;
    END IF;
    SELECT count(*) INTO v_zonas FROM inventory.clusters;
    IF v_zonas > 0 THEN
        RAISE EXCEPTION
            'Hay % zona(s) definidas a mano. Nadie puede reconstruirlas desde el '
            'catalogo: exportalas antes (ver la cabecera) y vuelve a ejecutar.', v_zonas;
    END IF;
END $$;

DROP VIEW IF EXISTS inventory.v_cluster_occupancy;
DROP TABLE IF EXISTS inventory.cluster_members;
DROP TABLE IF EXISTS inventory.clusters;

DELETE FROM core.role_permissions WHERE permission_code = 'inventory:zones';
DELETE FROM core.permissions      WHERE code            = 'inventory:zones';

DO $$
BEGIN
    IF to_regclass('inventory.clusters') IS NOT NULL THEN
        RAISE EXCEPTION 'La tabla de clusters sigue ahi';
    END IF;
    RAISE NOTICE 'OK · 0084 revertida';
END $$;
