-- ═══════════════════════════════════════════════════════════════════════════
-- 0107_permiso_import_inventario.sql
-- Altera    : ninguna tabla. Concede `inventory:import` a tenant_admin.
-- Depende de: 0064 (crea el permiso), 0071 (documenta por que no se concedio)
-- Riesgo    : bajo
--
-- 0071 dejo `inventory:import` sin ningun rol A PROPOSITO, con una razon
-- explicita en su cabecera: "no tiene endpoint. El inventario se importa con
-- tools/import_inventory_snapshot.py, por fuera de la API... Concederlo
-- insinuaria que existe un camino por la API que no existe."
--
-- Esa razon ya no aplica: `POST /v1/inventory/warehouses/{id}/snapshots` corre
-- el MISMO importador transaccional e idempotente-por-sha256 que el script,
-- ahora tambien alcanzable subiendo el archivo por la web. El permiso que ya
-- existia desde 0064 por fin tiene a que aplicarse.
--
-- Solo a `tenant_admin`, mismo criterio que 0106 (`catalog:import`): sustituir
-- la foto entera del inventario de un almacen no es una tarea diaria.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT id, 'inventory:import' FROM core.roles WHERE name = 'tenant_admin' AND is_system
ON CONFLICT DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_concedido boolean;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM core.role_permissions rp
        JOIN core.roles r ON r.id = rp.role_id
        WHERE r.name = 'tenant_admin' AND rp.permission_code = 'inventory:import'
    ) INTO v_concedido;
    IF NOT v_concedido THEN
        RAISE EXCEPTION 'tenant_admin no tiene inventory:import';
    END IF;

    IF EXISTS (
        SELECT 1 FROM core.role_permissions rp
        JOIN core.roles r ON r.id = rp.role_id
        WHERE rp.permission_code = 'inventory:import' AND r.name <> 'tenant_admin'
    ) THEN
        RAISE EXCEPTION 'inventory:import se concedio a un rol distinto de tenant_admin';
    END IF;

    RAISE NOTICE 'OK 0107: inventory:import concedido solo a tenant_admin';
END
$$;
