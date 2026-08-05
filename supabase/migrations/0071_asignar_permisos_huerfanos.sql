-- ══════════════════════════════════════════════════════════════════════════════
-- 0071 · Permisos que existían y no los tenía NADIE
--
-- El operador reportó que como OWNER no tiene el CRUD completo en Configuración. Al
-- medirlo apareció algo más concreto y peor que una pantalla incompleta:
--
--     POST /v1/admin/clients  →  403  «Falta el permiso clients:create»
--
-- Los cuatro permisos de `clients` existen en el catálogo desde 0013, los endpoints
-- existen en `api/v1/admin.py`, el formulario existe en `AdminForms.tsx`, la matriz de
-- permisos los pinta como filas… y estaban asignados a CERO roles.
--
-- ── POR QUE NI EL OWNER PODIA ──────────────────────────────────────────────
--
-- `require_permission` distingue por ALCANCE (`core.permissions.scope`):
--
--     scope = 'platform'  →  lo concede `platform.owners`, nunca un rol
--     scope = 'tenant'    →  se resuelve por roles, y el owner NO es una excepción
--
-- `clients:*` tiene alcance `tenant`, así que ser platform owner no ayuda: sin rol que
-- lo tenga, la comprobación deniega a todo el mundo. Es la clase de fallo que no
-- aparece leyendo el código —todas las piezas están— y solo sale llamando al endpoint.
--
-- ── QUE SE ASIGNA, Y CON QUE CRITERIO ──────────────────────────────────────
--
-- El mismo reparto que ya tiene `companies:*`, que es la entidad hermana:
--
--     leer      todos los roles que administran algo        admin, manager, auditor
--     crear     quien administra el tenant                  admin
--     editar    quien administra el tenant                  admin
--     borrar    quien administra el tenant                  admin
--
-- El `auditor` lee y no escribe, igual que en todo el resto del sistema: un auditor que
-- puede crear clientes puede fabricar la contraparte de la operación que audita.
--
-- El `viewer` queda fuera INCLUSO de la lectura. Un cliente es el dueño de la
-- mercancía: su razón social y su identificación fiscal son datos comerciales, y quien
-- solo mira el estado del almacén no necesita saber a quién se factura.
--
-- ── LO QUE NO SE TOCA, Y POR QUE ───────────────────────────────────────────
--
-- Quedan otros dos permisos de alcance `tenant` sin rol: `inventory:import` y
-- `scans:*`. NO se asignan aquí, y es deliberado:
--
--   · `inventory:import` no tiene endpoint. El inventario se importa con
--     `tools/import_inventory_snapshot.py`, por fuera de la API y con auditoría, y así
--     se decidió en el bloque de inventario. Concederlo insinuaría que existe un camino
--     por la API que no existe.
--
--   · `scans:*` es del bloque de escaneo, que no está construido. Un permiso concedido
--     para algo que no se puede hacer es ruido en la matriz.
--
-- La diferencia con `clients:*` es exactamente esa: ahí SÍ hay endpoint, formulario y
-- fila en la matriz. El permiso era lo único que faltaba.
-- ══════════════════════════════════════════════════════════════════════════════

-- Lectura: quien administra o audita.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'clients:read'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'auditor')
ON CONFLICT DO NOTHING;

-- Escritura y baja: solo quien administra el tenant.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, c.code
  FROM core.roles r
 CROSS JOIN (VALUES ('clients:create'), ('clients:update'), ('clients:delete')) AS c(code)
 WHERE r.name = 'tenant_admin'
ON CONFLICT DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_sin_rol integer;
    v_admin   integer;
BEGIN
    -- Los cuatro tienen ya algún rol.
    SELECT count(*) INTO v_sin_rol
      FROM core.permissions p
     WHERE p.code LIKE 'clients:%'
       AND NOT EXISTS (
           SELECT 1 FROM core.role_permissions rp WHERE rp.permission_code = p.code);
    IF v_sin_rol <> 0 THEN
        RAISE EXCEPTION 'quedan % permisos de clients sin ningun rol', v_sin_rol;
    END IF;

    -- Y `tenant_admin` tiene los cuatro, que es quien opera la pantalla.
    SELECT count(*) INTO v_admin
      FROM core.role_permissions rp
      JOIN core.roles r ON r.id = rp.role_id
     WHERE r.name = 'tenant_admin' AND rp.permission_code LIKE 'clients:%';
    IF v_admin <> 4 THEN
        RAISE EXCEPTION 'tenant_admin tiene % de los 4 permisos de clients', v_admin;
    END IF;

    RAISE NOTICE '0071 OK · clients:* asignados · tenant_admin con los 4';
END $$;
