-- ═══════════════════════════════════════════════════════════════════════════
-- 0023_ai_permission_catalog.sql
-- Crea     : ninguna tabla. Inserta 23 filas en core.permissions.
-- Depende de: 0022 (columna scope y su guarda)
-- Riesgo   : bajo
--
-- Todos con scope='platform' e is_privileged=true. NO se mapean a ningún rol, a
-- propósito: se conceden por estar en platform.owners, no por tener un rol. Y el
-- trigger de 0022 impide que alguien los mapee.
--
-- CUATRO DE ESTOS NOMBRES YA LOS PIDE EL FRONTEND. Los items de navegación que
-- hoy aparecen marcados «fase 1» piden `ai_models:read`, `inference:read`,
-- `datasets:*` y `training:*`. Al registrarlos pasan a «pendiente» sin tocar UI.
--
-- Los 23 códigos cumplen los dos CHECK que ya tiene la tabla:
--   chk_perm_code   → code = module || ':' || action
--   chk_perm_format → ^[a-z_]+:[a-z_]+$
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO core.permissions (code, module, action, description, is_privileged, scope)
VALUES
    -- Proyectos de entrenamiento
    ('ai_projects:read',      'ai_projects',      'read',     'Ver proyectos de entrenamiento',                 true, 'platform'),
    ('ai_projects:write',     'ai_projects',      'write',    'Crear y editar proyectos de entrenamiento',      true, 'platform'),
    ('ai_projects:delete',    'ai_projects',      'delete',   'Archivar proyectos de entrenamiento',            true, 'platform'),

    -- Clases del modelo
    ('ai_classes:read',       'ai_classes',       'read',     'Ver clases del modelo',                          true, 'platform'),
    ('ai_classes:write',      'ai_classes',       'write',    'Crear, editar y desactivar clases',              true, 'platform'),

    -- Dataset
    ('datasets:read',         'datasets',         'read',     'Ver imagenes y versiones de dataset',            true, 'platform'),
    ('datasets:write',        'datasets',         'write',    'Subir imagenes y congelar versiones de dataset', true, 'platform'),
    ('datasets:import',       'datasets',         'import',   'Importar datasets externos',                     true, 'platform'),

    -- Anotaciones
    ('annotations:read',      'annotations',      'read',     'Ver anotaciones',                                true, 'platform'),
    ('annotations:write',     'annotations',      'write',    'Crear y editar anotaciones',                     true, 'platform'),
    ('annotations:validate',  'annotations',      'validate', 'Validar anotaciones de otros',                   true, 'platform'),

    -- Entrenamiento
    ('training:read',         'training',         'read',     'Ver entrenamientos y su progreso',               true, 'platform'),
    ('training:launch',       'training',         'launch',   'Lanzar entrenamientos',                          true, 'platform'),
    ('training:cancel',       'training',         'cancel',   'Solicitar la cancelacion de un entrenamiento',   true, 'platform'),

    -- Modelos
    ('ai_models:read',        'ai_models',        'read',     'Ver versiones de modelo y sus metricas',         true, 'platform'),
    ('ai_models:publish',     'ai_models',        'publish',  'Publicar una version como modelo activo',        true, 'platform'),
    ('ai_models:rollback',    'ai_models',        'rollback', 'Revertir al modelo activo anterior',             true, 'platform'),
    ('ai_models:compare',     'ai_models',        'compare',  'Comparar versiones de modelo',                   true, 'platform'),

    -- Inferencia de prueba
    ('inference:read',        'inference',        'read',     'Ver resultados de pruebas de inferencia',        true, 'platform'),
    ('inference:run',         'inference',        'run',      'Ejecutar inferencia de prueba',                  true, 'platform'),

    -- Gestion de los propios Platform Owners
    ('platform_owners:read',  'platform_owners',  'read',     'Ver los Platform Owners',                        true, 'platform'),
    ('platform_owners:grant', 'platform_owners',  'grant',    'Conceder el privilegio de Platform Owner',       true, 'platform'),
    ('platform_owners:revoke','platform_owners',  'revoke',   'Revocar el privilegio de Platform Owner',        true, 'platform')
ON CONFLICT (code) DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_platform  int;
    v_tenant    int;
    v_mapeados  int;
    v_modulos   text;
BEGIN
    SELECT count(1) FILTER (WHERE scope = 'platform'),
           count(1) FILTER (WHERE scope = 'tenant')
      INTO v_platform, v_tenant
      FROM core.permissions;

    IF v_platform <> 23 THEN
        RAISE EXCEPTION 'se esperaban 23 permisos de plataforma, hay %', v_platform;
    END IF;
    IF v_tenant <> 30 THEN
        RAISE EXCEPTION 'los 30 permisos de tenant no deben cambiar, hay %', v_tenant;
    END IF;

    -- Ninguno debe estar mapeado a un rol. Si lo estuviera, el trigger de 0022
    -- no habría funcionado o alguien lo insertó antes de crearlo.
    SELECT count(1) INTO v_mapeados
      FROM core.role_permissions rp
      JOIN core.permissions p ON p.code = rp.permission_code
     WHERE p.scope = 'platform';

    IF v_mapeados > 0 THEN
        RAISE EXCEPTION
            '% permisos de plataforma están mapeados a roles de tenant', v_mapeados;
    END IF;

    SELECT string_agg(DISTINCT module, ', ' ORDER BY module) INTO v_modulos
      FROM core.permissions WHERE scope = 'platform';

    RAISE NOTICE 'OK 0023: 23 permisos de plataforma en 8 modulos (%), 0 mapeados a roles', v_modulos;
END
$$;
