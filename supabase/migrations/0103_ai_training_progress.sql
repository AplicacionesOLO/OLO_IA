-- ═══════════════════════════════════════════════════════════════════════════════
-- 0103 · Progreso de una ejecucion de entrenamiento, mientras esta `running`
--
-- ── EL HUECO ──────────────────────────────────────────────────────────────────
--
-- `ai.training_runs` solo dice DOS cosas de una ejecucion en marcha: su `status` y su
-- `started_at`. Entre que arranca y que termina —horas, en un modelo real— la pantalla
-- no tiene nada que enseñar salvo esas dos cosas quietas. La ejecucion podria estar en
-- la epoca 3 de 50 o en la 48 de 50, y desde fuera se ven identicas: `running` desde
-- hace un rato. Es la misma clase de problema que `perception.inference_jobs` ya
-- resuelve con `frames_processed`/`frames_total` (0078); a `ai.training_runs` le
-- faltaba el equivalente.
--
-- ── POR QUE UNA COLUMNA APARTE Y NO `metrics` ────────────────────────────────────
--
-- `metrics` tiene su propio CHECK —`chk_run_metrics_solo_exito`— que exige que solo
-- exista si `status = 'succeeded'`: son las metricas FINALES, medidas sobre el
-- conjunto de validacion, y mezclar ahi un progreso a medio entrenar les quitaria
-- ese significado. `progress` es harina de otro costal: un vistazo de lo que el
-- runner esta haciendo AHORA, se pisa en cada actualizacion, y no sobrevive al
-- cierre con ningun valor que signifique algo —por eso no lleva CHECK de fase.
--
-- ── POR QUE NO SE BORRA AL CERRAR ────────────────────────────────────────────────
--
-- Dejar el ultimo progreso visto en una ejecucion `failed` es diagnostico: «se
-- quedo en la epoca 12 de 50» dice mas que un error generico. Borrarlo en el cierre
-- tiraria justo el dato que explica cuanto se alcanzo a avanzar.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE ai.training_runs
    ADD COLUMN progress jsonb NULL;

ALTER TABLE ai.training_runs
    ADD CONSTRAINT chk_run_progress_objeto
    CHECK (progress IS NULL OR jsonb_typeof(progress) = 'object');

COMMENT ON COLUMN ai.training_runs.progress IS
    'Ultimo vistazo del runner mientras entrena: {"phase": "...", "epoch": N, '
    '"epochs": N, "message": "..."}. Se pisa en cada actualizacion; no tiene '
    'significado propio una vez cerrada la ejecucion, solo el ultimo visto.';

DO $$
DECLARE
    v_tiene_columna boolean;
    v_acepta_objeto boolean;
    v_rechaza_no_objeto boolean := false;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'training_runs'
           AND column_name = 'progress' AND data_type = 'jsonb'
    ) INTO v_tiene_columna;
    IF NOT v_tiene_columna THEN
        RAISE EXCEPTION 'falta la columna ai.training_runs.progress (jsonb)';
    END IF;

    --  El UPDATE de prueba tiene que caer en una ejecucion `running`: una terminada es
    --  INMUTABLE —`ai.reject_finished_run_change()`— y el disparador la rechazaria por
    --  esa razon antes de que el CHECK de esta migracion llegara a probarse.
    IF NOT EXISTS (SELECT 1 FROM ai.training_runs WHERE status = 'running') THEN
        RAISE NOTICE 'no hay ninguna ejecucion running ahora mismo; se omite la prueba del CHECK';
    ELSE
        --  El CHECK acepta un objeto de verdad.
        UPDATE ai.training_runs
           SET progress = '{"phase": "entrenando", "epoch": 3, "epochs": 50}'::jsonb
         WHERE id = (SELECT id FROM ai.training_runs WHERE status = 'running' LIMIT 1);
        GET DIAGNOSTICS v_acepta_objeto = ROW_COUNT;
        IF NOT v_acepta_objeto THEN
            RAISE EXCEPTION 'el UPDATE de prueba sobre una ejecucion running no afecto ninguna fila';
        END IF;

        --  Y rechaza lo que no es un objeto —un array, por ejemplo—.
        BEGIN
            UPDATE ai.training_runs SET progress = '[1, 2, 3]'::jsonb
             WHERE id = (SELECT id FROM ai.training_runs WHERE status = 'running' LIMIT 1);
            RAISE EXCEPTION 'el CHECK admitio un array en progress: no protege nada';
        EXCEPTION
            WHEN check_violation THEN
                v_rechaza_no_objeto := true;
        END;
        IF NOT v_rechaza_no_objeto THEN
            RAISE EXCEPTION 'chk_run_progress_objeto no se disparo como se esperaba';
        END IF;

        --  Deshacer el UPDATE de prueba: esto es una comprobacion, no un dato real.
        UPDATE ai.training_runs SET progress = NULL
         WHERE progress = '{"phase": "entrenando", "epoch": 3, "epochs": 50}'::jsonb;
    END IF;

    RAISE NOTICE 'OK - ai.training_runs.progress existe, acepta un objeto jsonb y rechaza lo demas';
END $$;
