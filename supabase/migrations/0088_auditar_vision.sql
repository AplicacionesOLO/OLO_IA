-- ═══════════════════════════════════════════════════════════════════════════════
-- 0088 · AUDITAR VISIÓN — y no auditar la telemetría del worker
--
-- ── EL HUECO, DESTAPADO POR UN INCIDENTE REAL ─────────────────────────────────
--
-- El 10 de agosto de 2026 se borró una inspección de 70,5 MB desde la aplicación en
-- producción. El registro de auditoría **no tenía ni una entrada**: `perception` quedó
-- fuera de las 27 tablas vigiladas por 0085.
--
-- Reconstruir qué había pasado exigió leer los logs de Render, que caducan. O sea que
-- el módulo que existe para responder «quién borró qué» no pudo responderlo, y la
-- respuesta se sacó de un sitio que mañana no estará.
--
-- Fue un error de criterio al elegir la lista: entraron las decisiones de inventario,
-- espacial e IA, y se quedaron fuera las de Visión. Una inspección borrada libera
-- Storage y destruye detecciones: es exactamente una decisión.
--
-- ── PERO AUDITAR `inference_jobs` A LO BRUTO SERIA PEOR ───────────────────────
--
-- El worker suma progreso cada **5 segundos** (`LOTE_S` en `tools/inferir.py`): un
-- análisis en directo de una hora son ~720 UPDATE de `frames_processed`,
-- `detection_count` y `elapsed_ms`. Auditarlos daría 720 entradas por inspección que
-- dicen «el contador subió», y enterrarían el borrado que sí importa — el mismo error
-- que 0085 evitó dejando fuera las 41.055 filas de stock.
--
-- Así que se amplía la regla que ya existía: un UPDATE que solo movió CONTABILIDAD no
-- es un evento, y la telemetría de progreso es contabilidad. Un cambio de `status` sí
-- lo es, y entonces la entrada sale con todo el diff, contadores incluidos.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · La telemetría deja de contar como cambio ──────────────────────────────
--
-- Se reescribe la función entera —no hay forma de parchearla— y es la de 0086 salvo la
-- lista de columnas ignoradas. Sus decisiones siguen valiendo: `session_user` y no
-- `current_user`, el contexto de sesión protegido, `app.is_test` para la suite, y el
-- resto sin red porque si falla se quiere saber.
CREATE OR REPLACE FUNCTION audit.registrar() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_antes    jsonb;
    v_despues  jsonb;
    v_cambios  text[];
    v_tenant   uuid;
    v_usuario  uuid;
    v_auth     uuid;
    v_prueba   boolean := false;
    --  Lo que NO es una decisión de nadie:
    --    · contabilidad de fila      updated_at, updated_by, version
    --    · telemetría del worker     frames_processed, detection_count, elapsed_ms
    --
    --  La lista es común a todas las tablas vigiladas y no pasa nada: una tabla que no
    --  tenga esas columnas nunca las verá en su diff.
    v_ruido text[] := ARRAY[
        'updated_at', 'updated_by', 'version',
        'frames_processed', 'detection_count', 'elapsed_ms'
    ];
BEGIN
    BEGIN
        v_usuario := core.current_user_id();
        v_auth    := core.current_auth_id();
        v_tenant  := core.current_tenant_id();
    EXCEPTION WHEN OTHERS THEN
        v_usuario := NULL;
        v_auth    := NULL;
        v_tenant  := NULL;
    END;

    v_prueba := coalesce(
        nullif(current_setting('app.is_test', true), '') IN ('on', 'true', '1'),
        false
    );

    IF TG_OP <> 'INSERT' THEN
        v_antes := audit.limpiar(to_jsonb(OLD));
    END IF;
    IF TG_OP <> 'DELETE' THEN
        v_despues := audit.limpiar(to_jsonb(NEW));
    END IF;

    v_tenant := coalesce(
        (coalesce(v_despues, v_antes) ->> 'tenant_id')::uuid,
        v_tenant
    );

    IF TG_OP = 'UPDATE' THEN
        v_cambios := ARRAY(
            SELECT key FROM jsonb_each(v_despues)
             WHERE v_antes -> key IS DISTINCT FROM value
             ORDER BY key
        );
        --  `<@` es «contenido en»: si TODO lo que cambió es ruido, no hay evento. Un
        --  `status` en el conjunto rompe la contención y la entrada sale entera.
        IF v_cambios IS NULL OR v_cambios <@ v_ruido THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO audit.entries (
        tenant_id, schema_name, table_name, row_id, operation,
        actor_user_id, actor_auth_id, db_role, changed, before, after, is_test
    ) VALUES (
        v_tenant,
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        coalesce(v_despues, v_antes) ->> 'id',
        TG_OP,
        v_usuario,
        v_auth,
        session_user,
        v_cambios,
        v_antes,
        v_despues,
        v_prueba
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;


-- ── 2 · Las dos tablas de Visión que sí son decisiones ────────────────────────
--
--   inference_jobs   crear, encolar, cancelar, archivar y borrar una inspección
--   media            registrar o borrar el material. Es lo que ocupa el Storage, y
--                    saber cuándo desaparecieron 70 MB es media respuesta
--
-- `detections` NO entra, y es el mismo criterio de 0085: un vuelo deja 8.000 y son el
-- RESULTADO del análisis, no una decisión. Lo que se revisa a mano queda en
-- `review_status`, y si hay que auditar eso se hará aparte y a propósito.
SELECT audit.vigilar('perception.inference_jobs');
SELECT audit.vigilar('perception.media');


-- ── 3 · Verificación ──────────────────────────────────────────────────────────
DO $$
DECLARE
    v_job    uuid;
    v_medio  uuid;
    v_wh     uuid;
    v_tenant uuid;
    v_antes  bigint;
    v_n      bigint;
    v_camb   text[];
BEGIN
    -- Vigiladas, y `detections` fuera.
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE t.tgname = 'trg_auditar' AND n.nspname = 'perception'
           AND c.relname = 'inference_jobs'
    ) THEN
        RAISE EXCEPTION 'inference_jobs no quedo vigilada';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE t.tgname = 'trg_auditar' AND n.nspname = 'perception'
           AND c.relname LIKE 'detections%'
    ) THEN
        RAISE EXCEPTION 'las detecciones quedaron vigiladas: un vuelo son 8.000 filas';
    END IF;

    SELECT n.tenant_id, n.warehouse_id INTO v_tenant, v_wh
      FROM spatial.nodes n
     WHERE n.node_type = 'rack' AND n.deleted_at IS NULL
     ORDER BY n.created_at LIMIT 1;

    INSERT INTO perception.media
        (tenant_id, warehouse_id, kind, original_filename, content_type, bytes, source,
         sha256)
    VALUES (v_tenant, v_wh, 'video', 'zzz-0088.mp4', 'video/mp4', 999, 'uploaded-file',
            repeat('0', 62) || '88')
    RETURNING id INTO v_medio;

    -- El alta del medio se registra: es lo que empieza a ocupar Storage.
    SELECT count(*) INTO v_n FROM audit.entries
     WHERE table_name = 'media' AND row_id = v_medio::text AND operation = 'INSERT';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'el alta del medio no se registro (% entradas)', v_n;
    END IF;

    INSERT INTO perception.inference_jobs
        (tenant_id, warehouse_id, media_id, name, status, pipeline,
         confidence_threshold)
    VALUES (v_tenant, v_wh, v_medio, 'ZZZ auditoria 0088', 'uploaded',
            'object-detection', 0.5)
    RETURNING id INTO v_job;

    SELECT count(*) INTO v_n FROM audit.entries
     WHERE table_name = 'inference_jobs' AND row_id = v_job::text;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'el alta de la inspeccion no se registro (% entradas)', v_n;
    END IF;

    -- ── LA TELEMETRIA NO DEJA RASTRO ─────────────────────────────────────────
    --
    -- Es la mitad importante de esta migracion: sin esto, un directo de una hora
    -- mete ~720 entradas que dicen «el contador subio».
    --  `frames_total` se pone primero: `chk_job_frames` exige que `frames_processed`
    --  no lo pase, y sin total el UPDATE de progreso fallaria por una razon que no
    --  tiene nada que ver con lo que se esta comprobando.
    UPDATE perception.inference_jobs SET frames_total = 900 WHERE id = v_job;

    SELECT count(*) INTO v_antes FROM audit.entries WHERE row_id = v_job::text;
    UPDATE perception.inference_jobs
       SET frames_processed = frames_processed + 30,
           detection_count = detection_count + 4,
           elapsed_ms = elapsed_ms + 5000
     WHERE id = v_job;
    SELECT count(*) INTO v_n FROM audit.entries WHERE row_id = v_job::text;
    IF v_n <> v_antes THEN
        RAISE EXCEPTION 'el progreso del worker dejo entrada: el registro se inunda';
    END IF;

    -- ── PERO UN CAMBIO DE ESTADO SI ──────────────────────────────────────────
    UPDATE perception.inference_jobs
       SET status = 'queued', queued_at = now(), frames_processed = frames_processed + 10
     WHERE id = v_job;
    SELECT changed INTO v_camb FROM audit.entries
     WHERE row_id = v_job::text AND operation = 'UPDATE' ORDER BY id DESC LIMIT 1;
    IF v_camb IS NULL OR NOT ('status' = ANY (v_camb)) THEN
        RAISE EXCEPTION 'el cambio de estado no se registro: %', v_camb;
    END IF;
    --  Y con el diff COMPLETO: al haber una decision, los contadores acompañan.
    IF NOT ('frames_processed' = ANY (v_camb)) THEN
        RAISE EXCEPTION 'el diff perdio los contadores al haber una decision: %', v_camb;
    END IF;

    -- ── Y EL BORRADO, QUE ES LO QUE FALTO EL 10 DE AGOSTO ────────────────────
    DELETE FROM perception.inference_jobs WHERE id = v_job;
    SELECT count(*) INTO v_n FROM audit.entries
     WHERE table_name = 'inference_jobs' AND row_id = v_job::text
       AND operation = 'DELETE';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'el borrado de la inspeccion NO se registro';
    END IF;

    DELETE FROM perception.media WHERE id = v_medio;
    SELECT count(*) INTO v_n FROM audit.entries
     WHERE table_name = 'media' AND row_id = v_medio::text AND operation = 'DELETE';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'el borrado del medio NO se registro';
    END IF;

    -- Se limpia lo de la verificación.
    DELETE FROM audit.entries
     WHERE row_id IN (v_job::text, v_medio::text);

    RAISE NOTICE 'OK · Vision auditada · el progreso del worker NO deja rastro · el '
                 'cambio de estado y el borrado SI';
END $$;
