-- ═══════════════════════════════════════════════════════════════════════════
-- 0112_usage_metering.sql
-- Crea      : el permiso usage:read
-- Depende de: 0013 (permisos y roles)
-- Riesgo     : bajo -- un permiso nuevo de solo lectura, cero cambios de esquema.
--
-- ── EL PROBLEMA QUE RESUELVE ─────────────────────────────────────────────────
--
-- Es la base de la #4 (cuotas por tenant) y la #10 (facturacion): ninguna de
-- las dos puede existir sin saber PRIMERO cuanto consume cada tenant. No hace
-- falta una tabla nueva -- `perception.detections`, `perception.
-- inference_jobs` y `core.fleet_devices` ya tienen `tenant_id` y marca de
-- tiempo, y RLS ya los acota por tenant en cualquier consulta. `usage:read`
-- es SOLO el permiso para leer esos recuentos agregados -- ver
-- `UsageService.resumen` en el backend.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES
    ('usage:read', 'usage', 'read',
     'Ver cuanto consume el tenant -- detecciones, trabajos y dispositivos, '
     'base de cuotas y facturacion', false)
ON CONFLICT (code) DO NOTHING;

-- El mismo reparto que drones:read (0110): todo rol menos viewer -- ver el
-- consumo es informacion operativa, no una accion privilegiada.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'usage:read'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator', 'auditor')
ON CONFLICT DO NOTHING;

-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM core.permissions WHERE code = 'usage:read') THEN
        RAISE EXCEPTION 'usage:read no se creo';
    END IF;

    SELECT count(*) INTO v_n FROM core.role_permissions WHERE permission_code = 'usage:read';
    IF v_n <> 4 THEN
        RAISE EXCEPTION 'usage:read deberia estar en 4 roles, esta en %', v_n;
    END IF;
END
$$;
