-- ═══════════════════════════════════════════════════════════════════════════
-- 0041_ai_permission_catalog_extension.sql
-- Crea     : ninguna tabla. Inserta 4 filas en core.permissions.
-- Depende de: 0022 (columna scope y su guarda), 0023 (los 23 primeros)
-- Riesgo   : bajo
--
-- El catálogo de 0023 se escribió pensando en versiones de modelo, cuando `modelo`
-- y `versión` eran lo mismo. Con `ai.models` como entidad separada faltan cuatro:
--
--   ai_models:write         crear y editar el modelo LÓGICO
--   ai_models:import        registrar pesos preentrenados o importados
--   ai_architectures:read   ver el catálogo de capacidades
--   ai_architectures:write  añadir o desactivar arquitecturas
--
-- `import` va aparte de `write` a propósito: registrar pesos que vienen de fuera
-- es una operación de confianza distinta de crear un modelo lógico. Quien importa
-- unos pesos introduce código ejecutable de terceros en la plataforma; quien crea
-- un modelo solo declara una intención. Conviene poder concederlas por separado
-- cuando haya varios owners con responsabilidades distintas.
--
-- Total tras esta migración: 27 permisos de plataforma, 30 de tenant.
-- Ninguno mapeado a rol: el trigger de 0022 lo impide.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO core.permissions (code, module, action, description, is_privileged, scope)
VALUES
    ('ai_models:write',        'ai_models',        'write',
     'Crear y editar modelos logicos',                            true, 'platform'),
    ('ai_models:import',       'ai_models',        'import',
     'Registrar pesos preentrenados o importados de terceros',     true, 'platform'),
    ('ai_architectures:read',  'ai_architectures', 'read',
     'Ver el catalogo de frameworks y arquitecturas',              true, 'platform'),
    ('ai_architectures:write', 'ai_architectures', 'write',
     'Anadir o desactivar arquitecturas del catalogo',             true, 'platform')
ON CONFLICT (code) DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_platform int;
    v_tenant   int;
    v_mapeados int;
    v_modulos  text;
    v_rechazado boolean := false;
    v_rol      uuid;
BEGIN
    SELECT count(1) FILTER (WHERE scope = 'platform'),
           count(1) FILTER (WHERE scope = 'tenant')
      INTO v_platform, v_tenant
      FROM core.permissions;

    IF v_platform <> 27 THEN
        RAISE EXCEPTION 'se esperaban 27 permisos de plataforma, hay %', v_platform;
    END IF;
    IF v_tenant <> 30 THEN
        RAISE EXCEPTION 'los 30 permisos de tenant no deben cambiar, hay %', v_tenant;
    END IF;

    SELECT count(1) INTO v_mapeados
      FROM core.role_permissions rp
      JOIN core.permissions p ON p.code = rp.permission_code
     WHERE p.scope = 'platform';
    IF v_mapeados > 0 THEN
        RAISE EXCEPTION '% permisos de plataforma estan mapeados a roles', v_mapeados;
    END IF;

    -- La guarda de 0022 debe seguir mordiendo con los códigos nuevos.
    SELECT id INTO v_rol FROM core.roles WHERE name = 'tenant_admin' AND is_system;
    BEGIN
        INSERT INTO core.role_permissions (role_id, permission_code)
        VALUES (v_rol, 'ai_models:import');
    EXCEPTION WHEN insufficient_privilege THEN
        v_rechazado := true;
    END;
    IF NOT v_rechazado THEN
        RAISE EXCEPTION
            'la guarda de 0022 NO rechazo ai_models:import en un rol de tenant';
    END IF;

    SELECT string_agg(DISTINCT module, ', ' ORDER BY module) INTO v_modulos
      FROM core.permissions WHERE scope = 'platform';

    RAISE NOTICE
        'OK 0041: 27 permisos de plataforma en 9 modulos (%), 30 de tenant intactos, 0 mapeados, guarda de 0022 verificada',
        v_modulos;
END
$$;
