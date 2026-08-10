-- ═══════════════════════════════════════════════════════════════════════════════
-- 0087 · VISIÓN — borrar lo que no sirvió, archivar lo que dejó rastro
--
-- Reportado: se sube un vídeo, se crea la inspección, el vídeo no se ve, no analiza
-- nada, no avisa de nada, y no hay forma de quitar las que salieron mal. Se acumulan
-- ocupando Storage.
--
-- Esta migración resuelve la parte de base de datos: el permiso para borrar, el estado
-- «archivada», y la consulta que dice si una inspección se puede borrar o no.
--
-- ── BORRAR Y ARCHIVAR NO SON LO MISMO, Y LA DIFERENCIA NO ES DE ESTILO ────────
--
-- Borrar libera Storage, que es el motivo de todo esto. Pero hay inspecciones de las
-- que YA cuelga trabajo humano o dato de operación, y ahí borrar destruiría algo que
-- nadie puede reconstruir:
--
--   incidencias    `incidents.incidents.source_job_id` apunta al trabajo. Alguien fue
--                  al pasillo por esto. La FK es NO ACTION, así que el borrado ya
--                  fallaría — pero con un error del motor, no con una explicación.
--   promovidas     detecciones en `matched`: se convirtieron en observaciones de rack
--                  sobre el plano. Las observaciones NO guardan el id del trabajo
--                  —`promote_to_observations` las agrupa por `source_code`—, así que
--                  borrar el trabajo dejaría observaciones huérfanas afirmando venir
--                  de una inspección que ya no existe.
--   revisadas      detecciones con `review_status` distinto de `pending`: una persona
--                  las aceptó, rechazó o corrigió. Eso es horas de trabajo.
--
-- Con cualquiera de las tres, la inspección se ARCHIVA: desaparece de la lista pero el
-- rastro se queda. Sin ninguna, se BORRA de verdad y el objeto sale de Storage.
--
-- ── ARCHIVAR NO LIBERA ESPACIO, Y HAY QUE DECIRLO ─────────────────────────────
--
-- Una inspección archivada sigue ocupando sus bytes. Es el precio de no destruir lo
-- que cuelga de ella, y la interfaz tiene que decirlo en lugar de dejar creer que
-- archivar limpia algo.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · El permiso ────────────────────────────────────────────────────────────
--
-- Propio y no reutilizando `perception:write`: escribir es registrar inspecciones y
-- revisar detecciones, que es el trabajo del operario. Borrar destruye bytes y es de
-- quien administra.
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES ('perception:delete', 'perception', 'delete',
        'Borrar inspecciones que no dejaron rastro, liberando su espacio en Storage, y '
        'archivar las que si lo dejaron', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'perception:delete'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager')
ON CONFLICT DO NOTHING;


-- ── 2 · El estado «archivada» ─────────────────────────────────────────────────
--
-- `archived_at` y no un valor más en `status`: el estado del trabajo describe su
-- PROCESO —draft, running, completed, failed— y archivar es ortogonal. Metido ahí
-- dentro, una inspección archivada perdería el dato de si llegó a completarse, que es
-- justo lo que se quiere conservar.
ALTER TABLE perception.inference_jobs
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES core.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN perception.inference_jobs.archived_at IS
    'Archivada: fuera de la lista, pero el rastro se queda. Se archiva —en vez de '
    'borrar— cuando cuelga de ella una incidencia, una deteccion promovida o una '
    'revisada. NO libera Storage. Ver 0087.';

-- El índice del uso normal: la lista sin las archivadas.
CREATE INDEX IF NOT EXISTS ix_jobs_activas
    ON perception.inference_jobs (warehouse_id, created_at DESC)
 WHERE archived_at IS NULL;


-- ── 2 bis · La vista tiene que exponerlo ──────────────────────────────────────
--
-- Sin esto, `archived_at` existe en la tabla y la API no lo ve: la lista seguiría
-- mostrando las archivadas y la pantalla no podría distinguirlas. Se recrea completa
-- —`CREATE OR REPLACE VIEW` no admite quitar ni reordenar columnas, solo añadir al
-- final— y las dos nuevas van al final justo por eso.
CREATE OR REPLACE VIEW perception.v_inference_jobs AS
 SELECT j.tenant_id,
    j.warehouse_id,
    j.id,
    j.name,
    j.status,
    j.pipeline,
    j.model_version_id,
    j.model_label,
    j.confidence_threshold,
    j.frame_sampling_rate,
    j.save_detected_frames,
    j.notes,
    j.frames_processed,
    j.frames_total,
    j.detection_count,
    j.elapsed_ms,
    j.error_message,
    j.queued_at,
    j.started_at,
    j.completed_at,
    j.created_at,
    j.created_by,
    m.id AS media_id,
    m.kind AS media_kind,
    m.original_filename AS media_filename,
    m.content_type AS media_content_type,
    m.bytes AS media_bytes,
    m.sha256 AS media_sha256,
    m.width AS media_width,
    m.height AS media_height,
    m.duration_ms AS media_duration_ms,
    m.total_frames AS media_total_frames,
    m.source AS media_source,
    m.stream_url AS media_stream_url,
    m.bucket IS NOT NULL AND m.object_path IS NOT NULL AS media_available,
    ( SELECT count(*) AS count
           FROM perception.job_events e
          WHERE e.tenant_id = j.tenant_id AND e.job_id = j.id) AS event_count,
    j.archived_at,
    j.archived_by
   FROM perception.inference_jobs j
     JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;


-- ── 3 · ¿Se puede borrar esta inspección? ─────────────────────────────────────
--
-- Devuelve los TRES recuentos y no un booleano. Un `false` obligaría a la interfaz a
-- decir «no se puede» sin más, y la pregunta siguiente de quien lo lee es siempre por
-- qué. Con los recuentos puede decir «tiene 3 incidencias abiertas desde ella».
--
-- Sin SECURITY DEFINER: se quiere que RLS aplique. Si quien pregunta no ve las
-- incidencias de otro almacén, tampoco debe enterarse de que existen.
CREATE OR REPLACE FUNCTION perception.enlaces_de_trabajo(p_job uuid)
RETURNS TABLE (incidencias bigint, promovidas bigint, revisadas bigint)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
    SELECT
        (SELECT count(*) FROM incidents.incidents i WHERE i.source_job_id = p_job),
        (SELECT count(*) FROM perception.detections d
          WHERE d.job_id = p_job AND d.state = 'matched'),
        (SELECT count(*) FROM perception.detections d
          WHERE d.job_id = p_job AND d.review_status <> 'pending')
$$;

COMMENT ON FUNCTION perception.enlaces_de_trabajo(uuid) IS
    'Que cuelga de una inspeccion: incidencias abiertas desde ella, detecciones '
    'promovidas a observaciones de rack, y detecciones revisadas por una persona. Con '
    'cualquiera de las tres > 0 la inspeccion se archiva en vez de borrarse.';


-- ── 4 · Verificación ──────────────────────────────────────────────────────────
DO $$
DECLARE
    v_job     uuid;
    v_medio   uuid;
    v_wh      uuid;
    v_tenant  uuid;
    v_rack    uuid;
    v_enlaces record;
    v_n       int;
BEGIN
    -- El permiso, en los dos roles y en ninguno más.
    SELECT count(*) INTO v_n
      FROM core.role_permissions rp JOIN core.roles r ON r.id = rp.role_id
     WHERE rp.permission_code = 'perception:delete';
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'perception:delete esta en % roles; se esperaban 2', v_n;
    END IF;
    IF EXISTS (
        SELECT 1 FROM core.role_permissions rp JOIN core.roles r ON r.id = rp.role_id
         WHERE rp.permission_code = 'perception:delete'
           AND r.name NOT IN ('tenant_admin', 'warehouse_manager')
    ) THEN
        RAISE EXCEPTION 'perception:delete llego a un rol que no debia';
    END IF;

    -- ── Un trabajo de usar y tirar, para comprobar la funcion ─────────────────
    --
    -- El almacen se saca DEL RACK y no de `core.warehouses` a secas: hay 39 almacenes
    -- y la mayoria son residuos de pruebas sin catalogo espacial. Cogiendo el primero
    -- por fecha salia uno sin racks, y `chk_det_matched` —que exige `rack_node_id`
    -- cuando el estado es `matched`— fallaba con el rack a NULL.
    SELECT n.tenant_id, n.warehouse_id, n.id INTO v_tenant, v_wh, v_rack
      FROM spatial.nodes n
     WHERE n.node_type = 'rack' AND n.deleted_at IS NULL
     ORDER BY n.created_at LIMIT 1;
    IF v_rack IS NULL THEN
        RAISE EXCEPTION 'no hay ningun rack en el catalogo: no se puede verificar';
    END IF;

    -- `sha256` obligatorio para `image`/`video`: `chk_media_identidad` exige que un
    -- medio con bytes tenga hash y un `stream` no lo tenga. Se usa uno inventado con
    -- la forma correcta —64 hex— porque aqui no hay archivo de verdad.
    INSERT INTO perception.media
        (tenant_id, warehouse_id, kind, original_filename, content_type, bytes, source,
         sha256)
    VALUES (v_tenant, v_wh, 'image', 'zzz-0087.png', 'image/png', 1, 'uploaded-file',
            repeat('0', 63) || '7')
    RETURNING id INTO v_medio;

    -- `completed_at` en el MISMO INSERT: `chk_job_fin` exige que los estados finales
    -- —completed, failed, cancelled— lleven fecha de fin, asi que ponerla en un UPDATE
    -- posterior falla en el insert.
    INSERT INTO perception.inference_jobs
        (tenant_id, warehouse_id, media_id, name, status, pipeline,
         confidence_threshold, completed_at)
    VALUES (v_tenant, v_wh, v_medio, 'ZZZ verificacion 0087', 'completed',
            'object-detection', 0.5, now())
    RETURNING id INTO v_job;

    -- Sin nada colgando: los tres recuentos a cero, o sea borrable.
    SELECT * INTO v_enlaces FROM perception.enlaces_de_trabajo(v_job);
    IF v_enlaces.incidencias <> 0 OR v_enlaces.promovidas <> 0
       OR v_enlaces.revisadas <> 0 THEN
        RAISE EXCEPTION 'un trabajo recien creado dice tener enlaces: %', v_enlaces;
    END IF;

    -- Una detección promovida lo hace NO borrable. Es la guarda que protege las
    -- observaciones de rack de quedarse huérfanas.
    -- Dos guardas del esquema que hay que respetar aqui:
    --   `chk_det_bbox_normalizado`  el formato por defecto es `normalized`, o sea que
    --                               las coordenadas van en [0,1], no en pixeles.
    --   `chk_det_matched`           `state = 'matched'` EXIGE `rack_node_id`, y al
    --                               contrario. Es coherente: «promovida» significa
    --                               precisamente que se ató a un rack.
    INSERT INTO perception.detections
        (tenant_id, warehouse_id, job_id, observed_at, frame_number, class_name,
         confidence, bbox_x, bbox_y, bbox_width, bbox_height, state, rack_node_id)
    VALUES (v_tenant, v_wh, v_job, now(), 1, 'pallet', 0.9, 0.1, 0.1, 0.2, 0.2,
            'matched', v_rack);

    SELECT * INTO v_enlaces FROM perception.enlaces_de_trabajo(v_job);
    IF v_enlaces.promovidas <> 1 THEN
        RAISE EXCEPTION 'una deteccion promovida no cuenta como enlace: %', v_enlaces;
    END IF;

    -- Y una revisada, igual: es trabajo de una persona.
    -- Dos guardas mas, en la misma linea:
    --   `chk_det_matched`   al dejar de estar promovida hay que soltar el rack; liga
    --                       las dos cosas en los dos sentidos.
    --   `chk_det_revisado`  `review_status <> 'pending'` EXIGE `reviewed_at`. Es
    --                       coherente: una revision sin fecha no dice cuando se hizo.
    UPDATE perception.detections
       SET state = 'unmatched', rack_node_id = NULL,
           review_status = 'accepted', reviewed_at = now()
     WHERE job_id = v_job;
    SELECT * INTO v_enlaces FROM perception.enlaces_de_trabajo(v_job);
    IF v_enlaces.revisadas <> 1 OR v_enlaces.promovidas <> 0 THEN
        RAISE EXCEPTION 'el recuento de revisadas no cuadra: %', v_enlaces;
    END IF;

    -- La vista lo expone, o la API no puede distinguir una archivada.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'perception' AND table_name = 'v_inference_jobs'
           AND column_name = 'archived_at'
    ) THEN
        RAISE EXCEPTION 'v_inference_jobs no expone archived_at';
    END IF;

    -- ── Archivar no toca nada más ────────────────────────────────────────────
    UPDATE perception.inference_jobs SET archived_at = now() WHERE id = v_job;
    SELECT count(*) INTO v_n FROM perception.detections WHERE job_id = v_job;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'archivar se llevo las detecciones';
    END IF;
    IF (SELECT status FROM perception.inference_jobs WHERE id = v_job) <> 'completed' THEN
        RAISE EXCEPTION 'archivar cambio el estado del proceso';
    END IF;

    -- ── Y borrar el trabajo SI se lleva sus detecciones (CASCADE) ────────────
    DELETE FROM perception.inference_jobs WHERE id = v_job;
    SELECT count(*) INTO v_n FROM perception.detections WHERE job_id = v_job;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'borrar el trabajo dejo % detecciones huerfanas', v_n;
    END IF;
    DELETE FROM perception.media WHERE id = v_medio;

    RAISE NOTICE 'OK · perception:delete en 2 roles · archived_at no toca el proceso · '
                 'enlaces_de_trabajo cuenta incidencias, promovidas y revisadas';
END $$;
