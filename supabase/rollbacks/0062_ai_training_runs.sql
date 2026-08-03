-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK 0062_ai_training_runs.sql
--
-- Deshace: elimina ai.training_runs, su trigger y su función.
--
-- ⚠ ABORTA SI HAY EJECUCIONES REGISTRADAS.
--
--   Una ejecución es el ÚNICO registro de con qué datos se entrenó un modelo.
--   Borrarla deja huérfanas las versiones de modelo que produjo: los pesos siguen
--   ahí y nadie puede decir de dónde salieron, ni con qué mapa de clases
--   interpretarlos.
--
--   Eso no es «revertir una migración», es destruir trazabilidad. Así que si hay
--   filas, este rollback se niega y las enumera.
--
--   Para forzarlo hay que declararlo explícitamente:
--       SET LOCAL olo.confirm_destructive = 'training_runs';
--
--   Es el mismo patrón que usan los rollbacks 0052 y 0054.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_filas   int;
    v_con_ver int;
    v_confirm text;
    r         record;
BEGIN
    SELECT count(*) INTO v_filas FROM ai.training_runs;
    SELECT count(*) INTO v_con_ver FROM ai.training_runs WHERE model_version_id IS NOT NULL;

    v_confirm := coalesce(current_setting('olo.confirm_destructive', true), '');

    IF v_filas > 0 AND v_confirm <> 'training_runs' THEN
        RAISE NOTICE 'Hay % ejecucion(es) registradas, % con pesos asociados:', v_filas, v_con_ver;
        FOR r IN
            SELECT tr.id::text AS id, m.name AS modelo, d.version AS dsv,
                   tr.status, tr.model_version_id IS NOT NULL AS con_pesos
              FROM ai.training_runs tr
              JOIN ai.models m ON m.id = tr.model_id
              JOIN ai.dataset_versions d ON d.id = tr.dataset_version_id
             ORDER BY tr.created_at
        LOOP
            RAISE NOTICE '  % | modelo=% | dataset v% | % | pesos=%',
                left(r.id, 8), r.modelo, r.dsv, r.status, r.con_pesos;
        END LOOP;

        RAISE EXCEPTION
            'ABORTADO: borrar ai.training_runs destruiria la trazabilidad de % modelo(s) '
            'entrenado(s). Los pesos quedarian sin saber de que datos salieron. Si de '
            'verdad quieres perderlo, declara: '
            'SET LOCAL olo.confirm_destructive = ''training_runs'';',
            v_con_ver;
    END IF;

    IF v_filas > 0 THEN
        RAISE WARNING 'Se destruye la trazabilidad de % ejecucion(es) por confirmacion explicita', v_filas;
    END IF;
END $$;

-- El trigger primero: si no, el DROP TABLE dispara `reject_finished_run_change` por
-- cada fila terminada y la tabla no se puede eliminar nunca.
DROP TRIGGER IF EXISTS trg_run_inmutable ON ai.training_runs;
DROP TRIGGER IF EXISTS trg_run_updated_at ON ai.training_runs;

DROP TABLE IF EXISTS ai.training_runs;

DROP FUNCTION IF EXISTS ai.reject_finished_run_change();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'ai' AND table_name = 'training_runs'
    ) THEN
        RAISE EXCEPTION 'FALLO: ai.training_runs sigue existiendo';
    END IF;

    RAISE NOTICE 'OK rollback 0062: ai.training_runs eliminada.';
    RAISE NOTICE 'La pregunta «con que datos se entreno este modelo» vuelve a no tener respuesta.';
END $$;
