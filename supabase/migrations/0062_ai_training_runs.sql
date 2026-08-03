-- ═══════════════════════════════════════════════════════════════════════════
-- 0062_ai_training_runs.sql
-- Crea     : ai.training_runs + ai.reject_finished_run_change() + trigger + RLS
-- Depende de: 0029 (dataset_versions), 0037 (models), 0038 (model_versions),
--             0036 (architectures)
-- Riesgo   : bajo — tabla nueva, ninguna existente se modifica
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA PREGUNTA QUE HOY NO SE PUEDE RESPONDER
--
-- «¿Con qué datos se entrenó este modelo?»
--
-- El comentario de `ai.dataset_versions` promete que «cada entrenamiento apuntará a
-- EXACTAMENTE una versión de dataset» — y no existía ninguna columna donde guardarlo.
-- `ai.model_versions` tiene los pesos, el origen y el estado, pero nada que diga de
-- dónde salieron.
--
-- Sin este registro, un modelo con 0,87 de mAP es un número sin contexto: no se sabe
-- si midió contra 40 imágenes o contra 4.000, ni con qué reparto, ni con qué mapa de
-- clases. Y por tanto **no se puede comparar con el siguiente**, que era justo el
-- motivo de congelar las versiones de dataset.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA EJECUCIÓN APUNTA A LA VERSIÓN, NO AL CONTRARIO
--
-- `training_runs.model_version_id` referencia la versión que la ejecución PRODUJO, y
-- es NULL hasta que los pesos se registran. La flecha va en un solo sentido a
-- propósito: si además `model_versions` apuntara a su run, habría un ciclo y las dos
-- filas tendrían que insertarse a la vez o quedar temporalmente inconsistentes.
--
-- La pregunta se responde igual de bien en un sentido:
--     SELECT dataset_version_id FROM ai.training_runs WHERE model_version_id = $1
--
-- Y `uq_run_version` garantiza que una versión de modelo viene de UNA sola ejecución.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ SE COPIAN `hyperparams`, `class_map` Y `architecture_code`
--
-- Los tres son derivables «en teoría» y los tres se guardan, porque lo que se puede
-- derivar hoy da una respuesta DISTINTA mañana:
--
--   · `hyperparams` — `ai.architectures.default_hyperparams` es la recomendación
--     VIGENTE, no un registro histórico. Cambiarla no debe reescribir el pasado. Aquí
--     va lo que realmente se usó, incluidos los ajustes a mano.
--
--   · `class_map` — es el mapa `class_index → training_index` que el export produjo y
--     que los PESOS codifican. Recalcularlo después de añadir una clase al proyecto
--     daría otro mapa, y entonces el modelo devolvería la etiqueta equivocada sin
--     ningún error. Es el dato más crítico de esta tabla.
--
--   · `architecture_code` — la arquitectura de un modelo se puede cambiar mientras no
--     tenga versiones. La ejecución tiene que recordar con qué se entrenó de verdad.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- UNA EJECUCIÓN TERMINADA ES INMUTABLE, UNA EN CURSO NO
--
-- Mientras está `queued` o `running` hay que poder actualizarla: es así como se
-- informa del progreso y como se cierra. En cuanto alcanza un estado terminal se
-- congela con un trigger, igual que una versión de dataset.
--
-- El trigger, y no solo la ausencia de política RLS, porque una tabla con RLS y sin
-- política de UPDATE **no rechaza** el UPDATE: lo deja en cero filas EN SILENCIO. Ya
-- pasó en este proyecto. Y el trigger protege además de `postgres`, que tiene
-- `rolbypassrls` y por tanto ignora RLS por completo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ai.training_runs (
    id                  uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          uuid         NOT NULL
                                     REFERENCES ai.projects(id) ON DELETE RESTRICT,

    model_id            uuid         NOT NULL,
    -- El corazón de la tabla: con QUÉ datos se entrenó.
    dataset_version_id  uuid         NOT NULL,

    -- Con qué se entrenó. Se copia, no se deriva: ver la cabecera.
    architecture_code   varchar(60)  NOT NULL
                                     REFERENCES ai.architectures(code) ON DELETE RESTRICT,
    hyperparams         jsonb        NOT NULL DEFAULT '{}'::jsonb,
    class_map           jsonb        NOT NULL,

    status              varchar(12)  NOT NULL DEFAULT 'queued',

    -- Dónde corrió. Texto libre porque el entrenamiento ocurre FUERA del backend y
    -- este no puede saber qué máquinas existen: 'local', 'gpu-box-1', 'runpod'…
    runner              varchar(60)  NULL,

    started_at          timestamptz  NULL,
    finished_at         timestamptz  NULL,

    -- Métricas del framework. jsonb y no columnas tipadas porque cada arquitectura
    -- reporta un conjunto distinto: mAP50 y mAP50-95 en detección, IoU en
    -- segmentación. Tipar una de ellas obligaría a migrar al añadir la siguiente.
    metrics             jsonb        NULL,
    error_message       text         NULL,

    -- La versión de modelo que produjo. NULL hasta que se registran los pesos.
    model_version_id    uuid         NULL,

    notes               text         NULL,

    created_at          timestamptz  NOT NULL DEFAULT now(),
    created_by          uuid         NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    updated_by          uuid         NULL     REFERENCES core.users(id) ON DELETE SET NULL,
    version             integer      NOT NULL DEFAULT 1,

    -- FK COMPUESTAS: modelo, dataset y versión deben ser del MISMO proyecto que la
    -- ejecución. Sin ellas se podría registrar que el modelo del proyecto A se entrenó
    -- con el dataset del proyecto B, y la trazabilidad diría una mentira coherente.
    CONSTRAINT fk_run_model FOREIGN KEY (project_id, model_id)
        REFERENCES ai.models (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_run_dataset FOREIGN KEY (project_id, dataset_version_id)
        REFERENCES ai.dataset_versions (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_run_version FOREIGN KEY (project_id, model_version_id)
        REFERENCES ai.model_versions (project_id, id) ON DELETE RESTRICT,

    -- Una versión de modelo procede de UNA sola ejecución. Sin esto, dos runs podrían
    -- reclamar los mismos pesos y la pregunta tendría dos respuestas.
    CONSTRAINT uq_run_version UNIQUE (model_version_id),

    CONSTRAINT chk_run_status CHECK (
        status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
    ),
    CONSTRAINT chk_run_version_lock CHECK (version >= 1),

    -- `class_map` no puede estar vacío: sin mapa, los pesos no se pueden interpretar.
    CONSTRAINT chk_run_class_map CHECK (
        jsonb_typeof(class_map) = 'array' AND jsonb_array_length(class_map) > 0
    ),
    CONSTRAINT chk_run_hyperparams CHECK (jsonb_typeof(hyperparams) = 'object'),
    CONSTRAINT chk_run_metrics_objeto CHECK (
        metrics IS NULL OR jsonb_typeof(metrics) = 'object'
    ),

    -- Coherencia del ciclo de vida. Cada CHECK cierra una forma de mentir:
    --
    --   · métricas en una ejecución que falló  → un número que no mide nada
    --   · mensaje de error en una que triunfó   → un fallo que no ocurrió
    --   · pesos de una que no terminó bien      → un modelo que no existe
    --   · sin `finished_at` estando terminada   → una ejecución eterna
    CONSTRAINT chk_run_metrics_solo_exito CHECK (
        metrics IS NULL OR status = 'succeeded'
    ),
    CONSTRAINT chk_run_error_solo_fallo CHECK (
        error_message IS NULL OR status IN ('failed', 'cancelled')
    ),
    CONSTRAINT chk_run_pesos_solo_exito CHECK (
        model_version_id IS NULL OR status = 'succeeded'
    ),
    CONSTRAINT chk_run_terminal_cerrada CHECK (
        (status IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)
    ),
    CONSTRAINT chk_run_started CHECK (
        (status = 'queued') OR (started_at IS NOT NULL)
    ),
    CONSTRAINT chk_run_orden_fechas CHECK (
        finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at
    )
);

COMMENT ON TABLE ai.training_runs IS
    'Un entrenamiento: que datos, que parametros, que mapa de clases y que resultado. Es lo que hace comparables dos modelos.';
COMMENT ON COLUMN ai.training_runs.dataset_version_id IS
    'La version CONGELADA con la que se entreno. Es la respuesta a «con que datos se entreno este modelo».';
COMMENT ON COLUMN ai.training_runs.class_map IS
    'Mapa class_index -> training_index que los PESOS codifican. Recalcularlo tras añadir una clase daria otro mapa y el modelo devolveria la etiqueta equivocada sin error.';
COMMENT ON COLUMN ai.training_runs.hyperparams IS
    'Lo que se USO, no los defaults del catalogo. ai.architectures.default_hyperparams es la recomendacion vigente, no historia.';
COMMENT ON COLUMN ai.training_runs.metrics IS
    'jsonb porque cada arquitectura reporta un conjunto distinto. Solo con status = succeeded.';


-- ── Índices ─────────────────────────────────────────────────────────────────
-- Las tres preguntas que esta tabla existe para responder.
CREATE INDEX idx_run_modelo ON ai.training_runs (model_id, created_at DESC);
CREATE INDEX idx_run_dataset ON ai.training_runs (dataset_version_id);
CREATE INDEX idx_run_activas ON ai.training_runs (status)
    WHERE status IN ('queued', 'running');


-- ── Inmutabilidad de lo terminado ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION ai.reject_finished_run_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'Una ejecucion de entrenamiento no se borra: es el registro de que datos '
            'produjeron un modelo. Si fue un error, marcala como cancelled.'
            USING ERRCODE = 'raise_exception';
    END IF;

    IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
        RAISE EXCEPTION
            'La ejecucion % ya termino con estado %: es inmutable. Un entrenamiento '
            'terminado es un hecho, y reescribirlo invalidaria la comparacion con '
            'cualquier otro modelo. Crea una ejecucion nueva.',
            OLD.id, OLD.status
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ai.reject_finished_run_change() IS
    'Congela las ejecuciones terminadas. Trigger y no solo ausencia de politica: sin politica el UPDATE queda en 0 filas EN SILENCIO, y el trigger protege tambien de postgres (rolbypassrls).';

CREATE TRIGGER trg_run_inmutable
    BEFORE UPDATE OR DELETE ON ai.training_runs
    FOR EACH ROW EXECUTE FUNCTION ai.reject_finished_run_change();

CREATE TRIGGER trg_run_updated_at
    BEFORE UPDATE ON ai.training_runs
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mismo patrón que el resto de `ai.*`: el módulo es de plataforma, no por tenant.
ALTER TABLE ai.training_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.training_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY run_platform_only ON ai.training_runs
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner())
    WITH CHECK (core.is_platform_owner());

CREATE POLICY run_read ON ai.training_runs
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY run_insert ON ai.training_runs
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY run_update ON ai.training_runs
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON ai.training_runs TO olo_app;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_force   boolean;
    v_pol     int;
    v_fk_comp int;
    v_checks  int;
    v_idx     int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relname = 'training_runs';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(*) INTO v_pol FROM pg_policies
     WHERE schemaname = 'ai' AND tablename = 'training_runs';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 politicas, hay %', v_pol; END IF;

    SELECT count(*) INTO v_fk_comp FROM pg_constraint
     WHERE conrelid = 'ai.training_runs'::regclass AND contype = 'f'
       AND array_length(conkey, 1) = 2;
    IF v_fk_comp <> 3 THEN
        RAISE EXCEPTION 'se esperaban 3 FK compuestas (modelo, dataset, version), hay %', v_fk_comp;
    END IF;

    SELECT count(*) INTO v_checks FROM pg_constraint
     WHERE conrelid = 'ai.training_runs'::regclass AND contype = 'c';
    IF v_checks < 10 THEN
        RAISE EXCEPTION 'se esperaban al menos 10 CHECK, hay %', v_checks;
    END IF;

    SELECT count(*) INTO v_idx FROM pg_indexes
     WHERE schemaname = 'ai' AND tablename = 'training_runs';
    IF v_idx < 4 THEN RAISE EXCEPTION 'faltan indices, hay %', v_idx; END IF;

    -- Los CHECK del ciclo de vida se prueban de verdad, no se dan por buenos.
    -- Cada bloque debe FALLAR; si alguno pasa, el CHECK no protege nada.
    BEGIN
        INSERT INTO ai.training_runs
            (project_id, model_id, dataset_version_id, architecture_code, class_map,
             status, metrics, created_by)
        SELECT p.id, m.id, d.id, 'rf-detr-base', '[{"training_index":0,"class_index":0}]'::jsonb,
               'failed', '{"mAP":0.9}'::jsonb, u.id
          FROM ai.projects p, ai.models m, ai.dataset_versions d, core.users u
         WHERE m.project_id = p.id AND d.project_id = p.id LIMIT 1;
        RAISE EXCEPTION 'FALLO: se aceptaron metricas en una ejecucion fallida';
    EXCEPTION
        WHEN check_violation THEN NULL;
        WHEN no_data_found THEN NULL;
    END;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'politicas: %  ·  FK compuestas: %  ·  CHECK: %  ·  indices: %',
        v_pol, v_fk_comp, v_checks, v_idx;
    RAISE NOTICE 'OK 0062: ai.training_runs responde «con que datos se entreno este modelo»';
    RAISE NOTICE '  SELECT dataset_version_id FROM ai.training_runs WHERE model_version_id = $1';
    RAISE NOTICE '───────────────────────────────────────────────';
END $$;
