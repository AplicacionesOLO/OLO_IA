-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK 0063_core_clients.sql
--
-- Deshace: elimina core.clients y sus 4 permisos.
--
-- ⚠ ABORTA SI HAY CLIENTES REGISTRADOS.
--
--   Un cliente es un dato maestro: representa un contrato real con una empresa. No
--   es configuracion que se pueda regenerar. Borrarlo en silencio dejaria sin
--   referencia cualquier informe o inventario que lo mencione.
--
--   Para forzarlo:  SET LOCAL olo.confirm_destructive = 'clients';
--
-- ⚠ ABORTA SI ALGUN ROL TIENE ASIGNADO UN PERMISO clients:*
--
--   `core.role_permissions` referencia el codigo del permiso. Quitar el permiso sin
--   quitar antes la asignacion dejaria la matriz apuntando a algo inexistente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_clientes int;
    v_asign    int;
    v_confirm  text;
    r          record;
BEGIN
    SELECT count(*) INTO v_clientes FROM core.clients WHERE deleted_at IS NULL;
    SELECT count(*) INTO v_asign FROM core.role_permissions rp
     WHERE rp.permission_code LIKE 'clients:%';

    v_confirm := coalesce(current_setting('olo.confirm_destructive', true), '');

    IF v_clientes > 0 AND v_confirm <> 'clients' THEN
        RAISE NOTICE 'Hay % cliente(s) registrados:', v_clientes;
        FOR r IN SELECT code, name FROM core.clients WHERE deleted_at IS NULL ORDER BY code LOOP
            RAISE NOTICE '  % | %', r.code, r.name;
        END LOOP;
        RAISE EXCEPTION
            'ABORTADO: son datos maestros, no configuracion regenerable. Si de verdad '
            'quieres perderlos: SET LOCAL olo.confirm_destructive = ''clients'';';
    END IF;

    IF v_asign > 0 THEN
        RAISE EXCEPTION
            'ABORTADO: % rol(es) tienen asignado un permiso clients:*. Quitalos de '
            'core.role_permissions primero o la matriz quedaria apuntando a un permiso '
            'inexistente.', v_asign;
    END IF;

    IF v_clientes > 0 THEN
        RAISE WARNING 'Se destruyen % cliente(s) por confirmacion explicita', v_clientes;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_client_updated_at ON core.clients;
DROP TABLE IF EXISTS core.clients;
DELETE FROM core.permissions WHERE module = 'clients';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='core' AND table_name='clients') THEN
        RAISE EXCEPTION 'FALLO: core.clients sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM core.permissions WHERE module='clients') THEN
        RAISE EXCEPTION 'FALLO: quedan permisos clients:*';
    END IF;
    RAISE NOTICE 'OK rollback 0063: core.clients eliminada, % permisos restantes',
        (SELECT count(*) FROM core.permissions);
END $$;
