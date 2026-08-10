-- Rollback de 0085 · auditoría.
--
-- ⚠ ESTO BORRA UN REGISTRO DE AUDITORÍA, que es la clase de dato que existe
--   precisamente para no poder borrarse. No hay forma de reconstruirlo: las filas
--   auditadas no guardan su propia historia, y las que se hayan borrado ya no están en
--   ninguna parte más.
--
--   Si hay entradas, expórtalas ANTES:
--
--     \copy (SELECT * FROM audit.entries ORDER BY id) TO 'auditoria.csv' CSV HEADER
--
-- Quitar los triggers NO toca ni una fila de las tablas auditadas: son AFTER, no
-- modifican lo que se escribe. El almacén, los permisos y los usuarios quedan igual.

DO $$
DECLARE
    v_n bigint;
BEGIN
    IF to_regclass('audit.entries') IS NULL THEN
        RAISE NOTICE 'No existe: nada que revertir.';
        RETURN;
    END IF;
    SELECT count(*) INTO v_n FROM audit.entries;
    IF v_n > 0 THEN
        RAISE EXCEPTION
            'Hay % entradas de auditoria. Un registro de auditoria no se borra sin '
            'querer: exportalo (ver la cabecera) y vuelve a ejecutar.', v_n;
    END IF;
END $$;

-- Los triggers, uno a uno y sin bucle sobre `pg_class`: si mañana alguien vigila una
-- tabla más, este rollback tiene que quedarse desactualizado de forma VISIBLE en vez de
-- barrer silenciosamente triggers que no puso 0085.
DO $$
DECLARE
    v_tabla text;
    v_vigiladas text[] := ARRAY[
        'core.users', 'core.tenant_memberships', 'core.role_assignments',
        'core.role_permissions', 'core.roles', 'core.user_warehouse_access',
        'core.permissions', 'core.tenants', 'core.companies', 'core.clients',
        'core.warehouses', 'core.tenant_countries', 'core.workers',
        'incidents.incidents', 'inventory.clusters', 'inventory.cluster_members',
        'inventory.wms_snapshots', 'spatial.sites', 'spatial.warehouse_layouts',
        'spatial.rack_placements', 'spatial.reference_frames', 'spatial.import_batches',
        'ai.projects', 'ai.models', 'ai.model_versions', 'ai.dataset_versions',
        'ai.training_runs'
    ];
BEGIN
    FOREACH v_tabla IN ARRAY v_vigiladas LOOP
        IF to_regclass(v_tabla) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_auditar ON %s', v_tabla);
        END IF;
    END LOOP;
END $$;

DROP FUNCTION IF EXISTS audit.vigilar(text);
DROP FUNCTION IF EXISTS audit.registrar();
DROP TABLE IF EXISTS audit.entries;
DROP FUNCTION IF EXISTS audit.limpiar(jsonb);

-- `audit:read` NO se borra: existía antes de 0085 —estaba en el catálogo desde el
-- principio, apuntando a un esquema vacío— y no es de esta migración.

DO $$
DECLARE
    v_triggers int;
BEGIN
    IF to_regclass('audit.entries') IS NOT NULL THEN
        RAISE EXCEPTION 'La tabla del registro sigue ahi';
    END IF;
    SELECT count(*) INTO v_triggers
      FROM pg_trigger WHERE tgname = 'trg_auditar' AND NOT tgisinternal;
    IF v_triggers > 0 THEN
        RAISE EXCEPTION 'Quedan % triggers de auditoria enganchados', v_triggers;
    END IF;
    RAISE NOTICE 'OK · 0085 revertida · las tablas auditadas intactas';
END $$;
