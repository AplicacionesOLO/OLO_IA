-- ══════════════════════════════════════════════════════════════════════════════
-- Rollback de 0073 · OLOBOT
--
-- Destruye el esquema `olobot` completo: los niveles concedidos, las conversaciones
-- y el registro de auditoría de lo que el bot escribió.
--
-- Lo que NO deshace: las escrituras que el bot llegó a ejecutar. Esas fueron
-- cambios reales en `core`, `spatial` o `wms`, hechos con los permisos del usuario y
-- confirmados por él. Borrar este esquema borra el RASTRO de esos cambios, no los
-- cambios. Si el motivo del rollback es una escritura indebida, hay que revertirla
-- por su propio módulo ANTES de correr esto, o se pierde la lista de qué revertir.
-- ══════════════════════════════════════════════════════════════════════════════

DROP SCHEMA IF EXISTS olobot CASCADE;

-- Los permisos salen de la matriz. `role_permissions` cae por su FK a
-- `core.permissions`, así que el orden importa.
DELETE FROM core.role_permissions
 WHERE permission_code IN ('olobot:use', 'olobot:write', 'olobot:admin');

DELETE FROM core.permissions WHERE module = 'olobot';

DO $$
DECLARE
    v_esquema integer;
    v_permisos integer;
BEGIN
    SELECT count(*) INTO v_esquema
      FROM information_schema.schemata WHERE schema_name = 'olobot';
    IF v_esquema <> 0 THEN
        RAISE EXCEPTION 'el esquema olobot sigue ahi';
    END IF;

    SELECT count(*) INTO v_permisos FROM core.permissions WHERE module = 'olobot';
    IF v_permisos <> 0 THEN
        RAISE EXCEPTION 'quedan % permisos de olobot en la matriz', v_permisos;
    END IF;

    RAISE NOTICE 'rollback 0073 OK · olobot retirado del esquema y de la matriz';
END $$;
