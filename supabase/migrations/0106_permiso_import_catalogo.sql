-- ═══════════════════════════════════════════════════════════════════════════
-- 0106_permiso_import_catalogo.sql
-- Crea      : el permiso `catalog:import` y su concesión a tenant_admin
-- Depende de: 0013 (permisos), 0022 (columna scope)
-- Riesgo    : bajo
--
-- Importar el catálogo espacial (racks, cuerpos, ubicaciones desde el xlsx del
-- WMS) hasta ahora solo lo podía hacer quien tuviera acceso a un terminal con
-- las credenciales de `postgres`: `tools/import_spatial_catalog.py` se conecta
-- como superusuario. El nuevo endpoint
-- `POST /spatial/warehouses/{id}/catalog-import` corre como `olo_app`, con RLS
-- activo, y necesita su propio permiso: no es `areas:write` porque reescribe
-- la estructura ENTERA del almacén (347 racks, 2.701 cuerpos, 29.310
-- ubicaciones de una tacada) y una importación equivocada es mucho más difícil
-- de deshacer que mover un rack.
--
-- `scope='tenant'`, no `platform`: cada tenant importa el catálogo de SUS
-- almacenes, sin depender de un Platform Owner -- ese acoplamiento es
-- justo lo que se quiere evitar al sacar esto de un script de terminal. Se
-- concede solo a `tenant_admin` -- ni warehouse_manager ni warehouse_operator
-- la reciben -- porque es una operación rara y estructural, no una tarea
-- diaria.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO core.permissions (code, module, action, description, is_privileged, scope)
VALUES
    ('catalog:import', 'catalog', 'import',
     'Importar el catalogo espacial completo de un almacen desde el xlsx del WMS',
     true, 'tenant')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT id, 'catalog:import' FROM core.roles WHERE name = 'tenant_admin' AND is_system
ON CONFLICT DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_existe    boolean;
    v_concedido boolean;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM core.permissions WHERE code = 'catalog:import' AND scope = 'tenant'
    ) INTO v_existe;
    IF NOT v_existe THEN
        RAISE EXCEPTION 'catalog:import no quedo creado con scope tenant';
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM core.role_permissions rp
        JOIN core.roles r ON r.id = rp.role_id
        WHERE r.name = 'tenant_admin' AND rp.permission_code = 'catalog:import'
    ) INTO v_concedido;
    IF NOT v_concedido THEN
        RAISE EXCEPTION 'tenant_admin no tiene catalog:import';
    END IF;

    IF EXISTS (
        SELECT 1 FROM core.role_permissions rp
        JOIN core.roles r ON r.id = rp.role_id
        WHERE rp.permission_code = 'catalog:import' AND r.name <> 'tenant_admin'
    ) THEN
        RAISE EXCEPTION 'catalog:import se concedio a un rol distinto de tenant_admin';
    END IF;

    RAISE NOTICE 'OK 0106: catalog:import creado (scope tenant) y concedido solo a tenant_admin';
END
$$;
