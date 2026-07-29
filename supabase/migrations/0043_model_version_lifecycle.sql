-- ═══════════════════════════════════════════════════════════════════════════
-- 0043_model_version_lifecycle.sql
-- Altera   : ai.model_versions (7 estados, 3 marcas nuevas, índice parcial),
--            ai.models (DROP current_version_id)
-- Crea     : ai.validate_version_transition() + trigger
-- Depende de: 0038, 0042
-- Riesgo   : medio
--
-- POR QUÉ. `status ∈ {candidate, active, archived, rejected}` hacía que `active`
-- significara cuatro cosas a la vez —válida, seleccionada, publicada, disponible
-- para producción— y no permitía distinguir «existe pero no sabemos si sirve» de
-- «la evaluamos y no sirve».
--
-- MATRIZ DE TRANSICIONES
--
--   registered  → validating · archived
--   validating  → validated · failed
--   validated   → published · validating · archived
--   published   → deprecated
--   deprecated  → published · archived          ← publicar de nuevo ES el rollback
--   failed      → validating · archived          ← reintento explícito
--   archived    → (terminal)
--
-- `deprecated → published` es lo que hace que el rollback use la MISMA operación
-- que publicar, con los papeles cambiados. No hay un camino de código distinto
-- que pueda estar roto justo el día que hace falta revertir.
--
-- `failed → validating` es el reintento que pediste. La transición queda definida
-- aquí; el endpoint que la ejecuta es de un bloque posterior y deberá escribir en
-- platform.privileged_operation_log.
--
-- ⚠ `current_version_id` DESAPARECE, no se protege.
--
--   El índice parcial garantiza 0 o 1 versión `published` por modelo, así que el
--   puntero era 100 % derivable. Mantenerlo exigía dos triggers en direcciones
--   opuestas y aun así dejaba una ventana intratransaccional de discrepancia.
--   Eliminarlo convierte tres invariantes en INEXPRESABLES: no hay puntero que
--   pueda apuntar a una versión no publicada, de otro modelo, o `failed`.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_filas int;
BEGIN
    SELECT count(1) INTO v_filas FROM ai.model_versions;
    IF v_filas > 0 THEN
        RAISE EXCEPTION
            'ai.model_versions tiene % filas con el vocabulario antiguo. Traduce '
            'candidate->registered, active->published, rejected->failed antes de aplicar.',
            v_filas;
    END IF;
END
$$;

-- ── 1 · Marcas del hito MÁS RECIENTE ───────────────────────────────────────
--
-- ⚠ SON EL HITO MÁS RECIENTE, NO UN HISTORIAL. Es una distinción que hay que
--   dejar escrita porque el caso que la fuerza es el rollback.
--
--   Una versión puede publicarse, degradarse y volver a publicarse. Con un solo
--   par (published_at, deprecated_at) no caben dos periodos en producción: dos
--   columnas no pueden representar una serie temporal.
--
--   Resolución: al republicar se actualiza `published_at` y se LIMPIA
--   `deprecated_at`. Las columnas responden «¿desde cuándo está publicada?» y
--   «¿cuándo dejó de estarlo?», que es lo que se consulta a diario.
--
--   El historial completo de publicaciones y degradaciones vive en
--   `platform.privileged_operation_log`, que es append-only y guarda before_state
--   y after_state de cada operación privilegiada. Existe exactamente para esto, así
--   que duplicar aquí una serie temporal sería mantener dos verdades.
ALTER TABLE ai.model_versions
    ADD COLUMN validated_at   timestamptz NULL,
    ADD COLUMN deprecated_at  timestamptz NULL,
    ADD COLUMN archived_at    timestamptz NULL,
    ADD COLUMN failure_reason text        NULL;

COMMENT ON COLUMN ai.model_versions.validated_at IS
    'Cuando supero la evaluacion mas reciente. Se conserva al publicar y al degradar.';
COMMENT ON COLUMN ai.model_versions.deprecated_at IS
    'Cuando dejo de ser la publicada. Se LIMPIA al republicar: el historial de ciclos esta en platform.privileged_operation_log.';
COMMENT ON COLUMN ai.model_versions.failure_reason IS
    'Obligatorio en failed: sin motivo, un fallo no es depurable.';


-- ── 2 · El vocabulario nuevo ───────────────────────────────────────────────
ALTER TABLE ai.model_versions DROP CONSTRAINT chk_mv_status;
ALTER TABLE ai.model_versions ALTER COLUMN status SET DEFAULT 'registered';

ALTER TABLE ai.model_versions ADD CONSTRAINT chk_mv_status CHECK (status IN (
    'registered',   -- pesos presentes, nada afirmado sobre su calidad
    'validating',   -- evaluacion en curso
    'validated',    -- evaluacion superada: ELEGIBLE para publicar
    'published',    -- la que produce observaciones en produccion
    'deprecated',   -- tuvo su turno, sustituida; sigue descargable y auditable
    'archived',     -- retirada del uso, se conserva por trazabilidad
    'failed'        -- la evaluacion fallo o los pesos no cargan
));

COMMENT ON COLUMN ai.model_versions.status IS
    'Ciclo: registered->validating->validated->published->deprecated->archived. validating->failed->validating (reintento). deprecated->published es el rollback.';


-- ── 3 · Invariantes de marcas de tiempo ────────────────────────────────────
--
-- Todas son condiciones DENTRO de la fila, así que un CHECK basta y no hace falta
-- trigger. Los CHECK son «al menos»: una versión deprecated conserva su
-- validated_at y su published_at, y eso se exige explícitamente.
ALTER TABLE ai.model_versions DROP CONSTRAINT chk_mv_activo_publicado;

ALTER TABLE ai.model_versions ADD CONSTRAINT chk_mv_marcas CHECK (
    CASE status
        WHEN 'registered' THEN validated_at IS NULL AND published_at IS NULL
                           AND deprecated_at IS NULL AND archived_at IS NULL
        WHEN 'validating' THEN published_at IS NULL AND deprecated_at IS NULL
                           AND archived_at IS NULL
        WHEN 'validated'  THEN validated_at IS NOT NULL AND published_at IS NULL
                           AND deprecated_at IS NULL AND archived_at IS NULL
        WHEN 'published'  THEN validated_at IS NOT NULL AND published_at IS NOT NULL
                           AND published_by IS NOT NULL
                           AND deprecated_at IS NULL AND archived_at IS NULL
        WHEN 'deprecated' THEN published_at IS NOT NULL AND deprecated_at IS NOT NULL
                           AND archived_at IS NULL
        WHEN 'archived'   THEN archived_at IS NOT NULL
        WHEN 'failed'     THEN failure_reason IS NOT NULL
                           AND published_at IS NULL AND archived_at IS NULL
        ELSE false
    END
);

-- Orden cronológico: no se puede degradar antes de publicar.
ALTER TABLE ai.model_versions ADD CONSTRAINT chk_mv_cronologia CHECK (
    (published_at  IS NULL OR validated_at  IS NULL OR published_at  >= validated_at)
    AND (deprecated_at IS NULL OR published_at IS NULL OR deprecated_at >= published_at)
);

ALTER TABLE ai.model_versions ADD CONSTRAINT chk_mv_motivo_no_vacio CHECK (
    failure_reason IS NULL OR length(btrim(failure_reason)) >= 3
);


-- ── 4 · Una sola publicada por modelo ──────────────────────────────────────
--
-- Este índice es el mecanismo entero de la publicación y del rollback. Dos
-- publicaciones concurrentes y una recibe violación de unicidad, que la API
-- traduce a 409. Ninguna carrera puede dejar dos publicadas.
--
-- Y fuerza que degradar la anterior sea EXPLÍCITO: publicar sin degradar no cabe.
DROP INDEX IF EXISTS ai.uq_mv_activo;

CREATE UNIQUE INDEX uq_mv_publicada ON ai.model_versions (model_id)
    WHERE status = 'published' AND deleted_at IS NULL;

COMMENT ON INDEX ai.uq_mv_publicada IS
    'Como maximo UNA version published por modelo. Sustituye a current_version_id: la verdad esta aqui, no en un puntero.';

CREATE INDEX idx_mv_estado ON ai.model_versions (model_id, status)
    WHERE deleted_at IS NULL;


-- ── 5 · El puntero desaparece ──────────────────────────────────────────────
ALTER TABLE ai.models DROP CONSTRAINT IF EXISTS fk_model_current_version;
ALTER TABLE ai.models DROP COLUMN current_version_id;

COMMENT ON TABLE ai.models IS
    'Modelo LOGICO. La version publicada NO se guarda aqui: se resuelve con SELECT id FROM ai.model_versions WHERE model_id = ? AND status = ''published'', una sonda al indice unico.';


-- ── 6 · Transiciones válidas ───────────────────────────────────────────────
--
-- Un CHECK no puede expresarlo: depende del valor ANTERIOR de la fila.
CREATE OR REPLACE FUNCTION ai.validate_version_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_permitidas text[];
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;   -- editar notas o metricas no es una transicion
    END IF;

    v_permitidas := CASE OLD.status
        WHEN 'registered' THEN ARRAY['validating', 'archived']
        WHEN 'validating' THEN ARRAY['validated', 'failed']
        WHEN 'validated'  THEN ARRAY['published', 'validating', 'archived']
        WHEN 'published'  THEN ARRAY['deprecated']
        -- Volver a publicar una degradada ES el rollback: misma operacion.
        WHEN 'deprecated' THEN ARRAY['published', 'archived']
        -- Reintento explicito tras un fallo.
        WHEN 'failed'     THEN ARRAY['validating', 'archived']
        WHEN 'archived'   THEN ARRAY[]::text[]   -- terminal
        ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY (v_permitidas)) THEN
        RAISE EXCEPTION
            'Transicion no valida: % -> %. Desde "%" solo se puede pasar a: %.',
            OLD.status, NEW.status, OLD.status,
            CASE WHEN cardinality(v_permitidas) = 0
                 THEN 'ningun estado, es terminal'
                 ELSE array_to_string(v_permitidas, ', ') END
            USING ERRCODE = 'P0001', DETAIL = 'AI_VERSION_TRANSITION_INVALID';
    END IF;

    RETURN NEW;
END
$$;

COMMENT ON FUNCTION ai.validate_version_transition() IS
    'Matriz de transiciones. Un CHECK no puede: depende del valor anterior de la fila.';

CREATE TRIGGER trg_mv_transicion
    BEFORE UPDATE OF status ON ai.model_versions
    FOR EACH ROW
    EXECUTE FUNCTION ai.validate_version_transition();


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_owner uuid;
    v_proj  uuid;
    v_model uuid;
    v_asset uuid;
    v_v1 uuid; v_v2 uuid; v_v3 uuid;
    v_ok  int := 0;
    v_det text;
    v_pub uuid;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'models'
           AND column_name = 'current_version_id'
    ) THEN
        RAISE EXCEPTION 'ai.models.current_version_id sigue existiendo';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'ai' AND indexname = 'uq_mv_publicada'
    ) THEN
        RAISE EXCEPTION 'falta el indice uq_mv_publicada';
    END IF;

    SELECT id INTO v_owner FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;
    IF v_owner IS NULL THEN
        RAISE NOTICE 'AVISO: sin usuario owner, se omiten las pruebas vivas';
        RETURN;
    END IF;

    INSERT INTO ai.projects (name, slug, created_by)
    VALUES ('Verif 0043', 'verif-0043', v_owner) RETURNING id INTO v_proj;
    INSERT INTO ai.assets (project_id, kind, bucket, object_path, original_filename,
                           content_type, bytes, sha256, created_by)
    VALUES (v_proj,'weights','ai-weights','v43/w.pt','w.pt','application/octet-stream',
            1024, repeat('7',64), v_owner) RETURNING id INTO v_asset;
    INSERT INTO ai.models (project_id, name, slug, architecture_code,
                           task, input_type, requires_training, created_by)
    VALUES (v_proj,'Verif','verif-43','yolo11n','detect','image',true,v_owner)
    RETURNING id INTO v_model;

    -- Nace `registered` por defecto
    INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                   weights_asset_id, source_reference, created_by)
    VALUES (v_proj, v_model, 1, 'imported', v_asset, 'importado para verificar 0043', v_owner) RETURNING id INTO v_v1;
    IF (SELECT status FROM ai.model_versions WHERE id = v_v1) <> 'registered' THEN
        RAISE EXCEPTION 'una version nueva debe nacer registered';
    END IF;
    v_ok := v_ok + 1;

    -- registered → published DIRECTO: rechazado. Hay que validar antes.
    BEGIN
        UPDATE ai.model_versions
           SET status='published', validated_at=now(), published_at=now(), published_by=v_owner
         WHERE id = v_v1;
        RAISE EXCEPTION 'se permitio publicar sin validar';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF v_det <> 'AI_VERSION_TRANSITION_INVALID' THEN
            RAISE EXCEPTION 'DETAIL inesperado: %', v_det;
        END IF;
        v_ok := v_ok + 1;
    END;

    -- El camino correcto
    UPDATE ai.model_versions SET status='validating' WHERE id = v_v1;
    UPDATE ai.model_versions SET status='validated', validated_at=now() WHERE id = v_v1;
    UPDATE ai.model_versions
       SET status='published', published_at=now(), published_by=v_owner WHERE id = v_v1;
    v_ok := v_ok + 1;

    -- Segunda versión, lista para publicar
    INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                   weights_asset_id, source_reference, created_by)
    VALUES (v_proj, v_model, 2, 'imported', v_asset, 'segunda version de verificacion', v_owner) RETURNING id INTO v_v2;
    UPDATE ai.model_versions SET status='validating' WHERE id = v_v2;
    UPDATE ai.model_versions SET status='validated', validated_at=now() WHERE id = v_v2;

    -- Publicar SIN degradar: el indice lo impide
    BEGIN
        UPDATE ai.model_versions
           SET status='published', published_at=now(), published_by=v_owner WHERE id = v_v2;
        RAISE EXCEPTION 'se permitieron DOS versiones published del mismo modelo';
    EXCEPTION WHEN unique_violation THEN
        v_ok := v_ok + 1;
    END;

    -- Publicar CON degradado explícito, en la misma transaccion
    UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id = v_v1;
    UPDATE ai.model_versions
       SET status='published', published_at=now(), published_by=v_owner WHERE id = v_v2;
    v_ok := v_ok + 1;

    -- ROLLBACK: misma operacion, papeles cambiados. Republicar LIMPIA
    -- deprecated_at, porque las marcas son del hito mas reciente y no un historial.
    UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id = v_v2;
    UPDATE ai.model_versions
       SET status='published', published_at=now(), published_by=v_owner,
           deprecated_at=NULL
     WHERE id = v_v1;
    SELECT id INTO v_pub FROM ai.model_versions
     WHERE model_id = v_model AND status = 'published';
    IF v_pub <> v_v1 THEN RAISE EXCEPTION 'el rollback no restauro la v1'; END IF;
    v_ok := v_ok + 1;

    -- Y republicar SIN limpiar deprecated_at debe fallar: es la garantia de que la
    -- operacion de publicacion no puede dejar marcas contradictorias.
    UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id = v_v1;
    BEGIN
        UPDATE ai.model_versions
           SET status='published', published_at=now(), published_by=v_owner
         WHERE id = v_v1;
        RAISE EXCEPTION 'se permitio publicar conservando deprecated_at';
    EXCEPTION WHEN check_violation THEN
        v_ok := v_ok + 1;
    END;
    UPDATE ai.model_versions
       SET status='published', published_at=now(), published_by=v_owner, deprecated_at=NULL
     WHERE id = v_v1;

    -- published → archived: rechazado (hay que degradar primero)
    BEGIN
        UPDATE ai.model_versions SET status='archived', archived_at=now() WHERE id = v_v1;
        RAISE EXCEPTION 'se permitio archivar una version publicada';
    EXCEPTION WHEN raise_exception THEN
        v_ok := v_ok + 1;
    END;

    -- Una TERCERA version para el ciclo de fallo y reintento: v_v1 esta publicada y
    -- v_v2 degradada, y `deprecated -> validating` no existe a proposito —
    -- reevaluar una version antigua es trabajo de ai.evaluations, no un cambio de
    -- estado.
    INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                   weights_asset_id, source_reference, created_by)
    VALUES (v_proj, v_model, 3, 'imported', v_asset, 'tercera para probar fallo', v_owner)
    RETURNING id INTO v_v3;

    -- failed exige motivo
    UPDATE ai.model_versions SET status='validating' WHERE id = v_v3;
    BEGIN
        UPDATE ai.model_versions SET status='failed' WHERE id = v_v3;
        RAISE EXCEPTION 'se acepto failed sin failure_reason';
    EXCEPTION WHEN check_violation THEN
        v_ok := v_ok + 1;
    END;
    UPDATE ai.model_versions SET status='failed', failure_reason='mAP por debajo del minimo'
     WHERE id = v_v3;

    -- Reintento explicito: failed -> validating
    UPDATE ai.model_versions SET status='validating' WHERE id = v_v3;
    v_ok := v_ok + 1;

    -- archived es terminal
    UPDATE ai.model_versions SET status='validated', validated_at=now() WHERE id = v_v3;
    UPDATE ai.model_versions SET status='archived', archived_at=now() WHERE id = v_v3;
    BEGIN
        UPDATE ai.model_versions SET status='validating' WHERE id = v_v3;
        RAISE EXCEPTION 'archived debe ser terminal';
    EXCEPTION WHEN raise_exception THEN
        v_ok := v_ok + 1;
    END;

    -- deprecated -> validating NO existe: se comprueba explicitamente para que el
    -- dia que alguien lo anada, esta prueba lo discuta.
    BEGIN
        UPDATE ai.model_versions SET status='validating' WHERE id = v_v2;
        RAISE EXCEPTION 'deprecated -> validating no deberia existir';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
        IF v_det <> 'AI_VERSION_TRANSITION_INVALID' THEN
            RAISE EXCEPTION 'DETAIL inesperado: %', v_det;
        END IF;
        v_ok := v_ok + 1;
    END;

    -- Limpieza
    DELETE FROM ai.model_versions WHERE project_id = v_proj;
    DELETE FROM ai.models         WHERE project_id = v_proj;
    DELETE FROM ai.assets         WHERE project_id = v_proj;
    DELETE FROM ai.projects       WHERE id = v_proj;

    IF v_ok <> 12 THEN RAISE EXCEPTION 'solo % de 12 comprobaciones pasaron', v_ok; END IF;

    RAISE NOTICE
        'OK 0043: 7 estados, current_version_id eliminado, indice uq_mv_publicada, y 12 comprobaciones en vivo: nace registered, no se publica sin validar, no hay dos publicadas, degradado explicito, rollback simetrico que limpia deprecated_at, failed con motivo y reintento, archived terminal, deprecated no vuelve a validating';
END
$$;
