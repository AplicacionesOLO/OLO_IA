-- Rollback de 0083 · incidencias.
--
-- ⚠ ESTO BORRA TRABAJO DE PERSONAS, no datos derivados.
--
-- Una incidencia resuelta guarda quién fue al pasillo, qué encontró y cuándo. Eso no
-- se puede reconstruir desde ninguna otra tabla: el WMS no sabe que alguien comprobó
-- un hueco. Si hay incidencias cerradas, exportarlas ANTES:
--
--     \copy (SELECT * FROM incidents.incidents) TO 'incidencias.csv' CSV HEADER
--     \copy (SELECT * FROM incidents.events)    TO 'eventos.csv'     CSV HEADER
--
-- Por eso el bloque de abajo se NIEGA a borrar si hay algo resuelto, en lugar de
-- hacerlo y avisar después.

DO $$
DECLARE
    v_cerradas int;
BEGIN
    IF to_regclass('incidents.incidents') IS NULL THEN
        RAISE NOTICE 'El esquema no existe: nada que revertir.';
        RETURN;
    END IF;
    SELECT count(*) INTO v_cerradas
      FROM incidents.incidents WHERE status IN ('resolved', 'dismissed');
    IF v_cerradas > 0 THEN
        RAISE EXCEPTION
            'Hay % incidencia(s) cerradas: son el registro de trabajo hecho en el '
            'pasillo y no se puede reconstruir desde ninguna otra tabla. Expórtalas '
            'antes (ver la cabecera de este archivo) y vuelve a ejecutar.', v_cerradas;
    END IF;
END $$;

DROP VIEW IF EXISTS incidents.v_bandeja;
DROP TABLE IF EXISTS incidents.events;
DROP TABLE IF EXISTS incidents.incidents;
DROP SCHEMA IF EXISTS incidents;

-- Los permisos también: dejarlos huérfanos daría casillas en la matriz que no
-- gobiernan nada, que es justo el defecto que se corrigió en la 0071.
DELETE FROM core.role_permissions WHERE permission_code IN ('incidents:read', 'incidents:write');
DELETE FROM core.permissions      WHERE code            IN ('incidents:read', 'incidents:write');

DO $$
BEGIN
    IF to_regclass('incidents.incidents') IS NOT NULL THEN
        RAISE EXCEPTION 'El esquema incidents sigue ahi';
    END IF;
    IF EXISTS (SELECT 1 FROM core.permissions WHERE code LIKE 'incidents:%') THEN
        RAISE EXCEPTION 'Quedan permisos de incidencias sin borrar';
    END IF;
    RAISE NOTICE 'OK · 0083 revertida';
END $$;
