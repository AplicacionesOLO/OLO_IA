-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0043_model_version_lifecycle.sql
--
-- Vuelve al vocabulario de 0038 —candidate/active/archived/rejected— y restaura
-- `current_version_id` sin FK a nada que no exista.
--
-- ⚠ Aborta si hay versiones con los estados nuevos: no hay traducción honesta de
--   `registered`, `validating`, `validated`, `deprecated` ni `failed` al
--   vocabulario antiguo, que solo distinguía cuatro casos. Traducir `validated` a
--   `candidate` perdería el hecho de que superó una evaluación.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_nuevos int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'model_versions'
           AND column_name = 'validated_at'
    ) THEN
        RAISE EXCEPTION
            'La migracion 0043 no esta aplicada (no existe validated_at). Nada que revertir.';
    END IF;

    SELECT count(1) INTO v_nuevos
      FROM ai.model_versions
     WHERE status IN ('registered','validating','validated','deprecated','failed');
    IF v_nuevos > 0 THEN
        RAISE EXCEPTION
            'Hay % versiones en estados que el vocabulario antiguo no puede expresar. '
            'Traducelas a candidate/active/archived/rejected antes de revertir.', v_nuevos;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_mv_transicion ON ai.model_versions;
DROP FUNCTION IF EXISTS ai.validate_version_transition();

DROP INDEX IF EXISTS ai.idx_mv_estado;
DROP INDEX IF EXISTS ai.uq_mv_publicada;

CREATE UNIQUE INDEX uq_mv_activo ON ai.model_versions (model_id)
    WHERE status = 'active' AND deleted_at IS NULL;

ALTER TABLE ai.model_versions DROP CONSTRAINT IF EXISTS chk_mv_motivo_no_vacio;
ALTER TABLE ai.model_versions DROP CONSTRAINT IF EXISTS chk_mv_cronologia;
ALTER TABLE ai.model_versions DROP CONSTRAINT IF EXISTS chk_mv_marcas;
ALTER TABLE ai.model_versions DROP CONSTRAINT IF EXISTS chk_mv_status;

ALTER TABLE ai.model_versions ALTER COLUMN status SET DEFAULT 'candidate';
ALTER TABLE ai.model_versions ADD CONSTRAINT chk_mv_status CHECK (
    status IN ('candidate', 'active', 'archived', 'rejected')
);
ALTER TABLE ai.model_versions ADD CONSTRAINT chk_mv_activo_publicado CHECK (
    status <> 'active' OR published_at IS NOT NULL
);

ALTER TABLE ai.model_versions
    DROP COLUMN IF EXISTS failure_reason,
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS deprecated_at,
    DROP COLUMN IF EXISTS validated_at;

-- El puntero vuelve, con su FK como en 0038.
ALTER TABLE ai.models ADD COLUMN current_version_id uuid;
ALTER TABLE ai.models
    ADD CONSTRAINT fk_model_current_version
    FOREIGN KEY (current_version_id) REFERENCES ai.model_versions(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'ai' AND table_name = 'models'
           AND column_name = 'current_version_id'
    ) THEN
        RAISE EXCEPTION 'current_version_id no se restauro';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes
                WHERE schemaname = 'ai' AND indexname = 'uq_mv_publicada') THEN
        RAISE EXCEPTION 'el indice uq_mv_publicada sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0043: vocabulario de 0038 restaurado, current_version_id de vuelta';
END
$$;
