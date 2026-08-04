-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0069 · Percepción: trabajos de inferencia y detecciones
--
-- ⚠ DESTRUCTIVO. Borra los trabajos, sus detecciones y su historial.
--
-- Las 25 particiones se van con la tabla padre: `DROP TABLE` sobre una particionada
-- se lleva las particiones. No hay que nombrarlas una por una, y hacerlo sería peor
-- —una lista escrita a mano se queda corta en cuanto una tarea cree la del mes que
-- viene—.
--
-- El ESQUEMA NO se borra: lo creó 0032, con sus default privileges y su aviso de
-- régimen en la cabecera. Borrarlo aquí desharía una migración que no es esta.
--
-- Las observaciones ya PROMOVIDAS a `spatial.rack_observations` NO se borran, y es
-- deliberado: son de 0067 y sobreviven a su origen. Quedarán sin la detección que
-- las justificó, que es exactamente lo que pasa con cualquier evidencia cuyo
-- soporte se destruye, y por eso este rollback no se ejecuta a la ligera.
-- ══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS perception.v_unmatched_texts;
DROP VIEW IF EXISTS perception.v_inference_jobs;

-- Las tablas, en orden de dependencia. Los disparadores y las políticas RLS caen
-- con ellas.
DROP TABLE IF EXISTS perception.detections;      -- se lleva sus 25 particiones
DROP TABLE IF EXISTS perception.job_events;
DROP TABLE IF EXISTS perception.inference_jobs;
DROP TABLE IF EXISTS perception.media;

DROP FUNCTION IF EXISTS perception.log_job_event();
DROP FUNCTION IF EXISTS perception.check_job_transition();

-- Los permisos y sus asignaciones. Primero las asignaciones: `role_permissions`
-- referencia el código.
DELETE FROM core.role_permissions
 WHERE permission_code IN ('perception:read', 'perception:write', 'perception:ingest');
DELETE FROM core.permissions
 WHERE code IN ('perception:read', 'perception:write', 'perception:ingest');


DO $$
DECLARE
    v_tablas integer;
BEGIN
    SELECT count(*) INTO v_tablas
      FROM information_schema.tables
     WHERE table_schema = 'perception' AND table_type = 'BASE TABLE';
    IF v_tablas <> 0 THEN
        RAISE EXCEPTION 'quedan % tablas en perception', v_tablas;
    END IF;
    RAISE NOTICE 'rollback 0069 OK · esquema perception vacio, como lo dejo 0032';
END $$;
