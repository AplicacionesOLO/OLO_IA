-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0064 · INVENTARIO declarado vs. observado
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ ESTO BORRA LECTURAS. Las tablas `scans`/`readings` contienen datos que NO se
--   pueden regenerar: son observaciones del almacén en un instante que ya pasó.
--   Volver a leer exige volver a volar el dron. Antes de correr esto, exporta:
--
--     COPY (SELECT * FROM inventory.readings) TO STDOUT WITH CSV HEADER;
--     COPY (SELECT * FROM inventory.wms_stock) TO STDOUT WITH CSV HEADER;
--
--   Los cortes del WMS sí se pueden volver a pedir; las lecturas no.
--
-- El esquema se borra entero con CASCADE porque las tres vistas y las cuatro
-- tablas solo dependen entre sí y de `core`/`spatial`/`ai`, nunca al revés: nada
-- fuera de `inventory` apunta hacia dentro.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_lecturas bigint := 0;
    v_stock    bigint := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'inventory') THEN
        EXECUTE 'SELECT count(*) FROM inventory.readings'  INTO v_lecturas;
        EXECUTE 'SELECT count(*) FROM inventory.wms_stock' INTO v_stock;
        RAISE NOTICE 'se van a perder % lectura(s) y % fila(s) de stock', v_lecturas, v_stock;
    END IF;
END $$;

DROP VIEW IF EXISTS inventory.v_rack_clients;
DROP VIEW IF EXISTS inventory.v_rack_layout;
DROP VIEW IF EXISTS inventory.v_misplaced;
DROP VIEW IF EXISTS inventory.v_reconciliation;

DROP TABLE IF EXISTS inventory.readings;
DROP TABLE IF EXISTS inventory.wms_stock;
DROP TABLE IF EXISTS inventory.scans;
DROP TABLE IF EXISTS inventory.wms_snapshots;

DROP SCHEMA IF EXISTS inventory CASCADE;

-- ── Permisos ────────────────────────────────────────────────────────────────
--
-- ⚠ SOLO LOS CUATRO QUE CREÓ LA 0064. `inventory:read` NO está en esta lista, y la
--   omisión es deliberada: lo creó la migración 0013, que además lo concede a los
--   cinco roles del sistema. La primera versión de este rollback lo incluía y
--   borró esas cinco concesiones —role_permissions 72 → 67, tenant_admin 30 → 29—
--   sin que nada fallara, porque borrar una concesión que existe es una operación
--   perfectamente válida. El daño solo se vio contando a mano.
--
--   Un rollback únicamente puede retirar lo que su migración introdujo.
DELETE FROM core.role_permissions
 WHERE permission_code IN (
    'inventory:import', 'scans:read', 'scans:create', 'scans:export'
 );

DELETE FROM core.permissions
 WHERE code IN (
    'inventory:import', 'scans:read', 'scans:create', 'scans:export'
 );


-- ── Verificación ────────────────────────────────────────────────────────────
DO $$
DECLARE v_esq int; v_perm int;
BEGIN
    SELECT count(*) INTO v_esq FROM pg_namespace WHERE nspname = 'inventory';
    IF v_esq <> 0 THEN
        RAISE EXCEPTION 'el esquema inventory sigue existiendo';
    END IF;

    SELECT count(*) INTO v_perm FROM core.permissions
     WHERE code IN ('inventory:import','scans:read','scans:create','scans:export');
    IF v_perm <> 0 THEN
        RAISE EXCEPTION 'quedan % permiso(s) de 0064 en el catalogo', v_perm;
    END IF;

    -- Y lo que NO era de la 0064 tiene que seguir intacto.
    SELECT count(*) INTO v_perm FROM core.permissions WHERE code = 'inventory:read';
    IF v_perm <> 1 THEN
        RAISE EXCEPTION 'este rollback borro inventory:read, que es de la 0013';
    END IF;
    SELECT count(*) INTO v_perm FROM core.role_permissions
     WHERE permission_code = 'inventory:read';
    IF v_perm <> 5 THEN
        RAISE EXCEPTION
            'este rollback se llevo concesiones de inventory:read: quedan % de 5', v_perm;
    END IF;

    RAISE NOTICE 'rollback 0064 OK · esquema y 4 permisos retirados · inventory:read intacto';
END $$;
