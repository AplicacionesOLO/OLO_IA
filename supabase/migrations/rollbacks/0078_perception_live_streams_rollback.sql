-- Rollback de 0078. Vuelve al modelo de solo-archivo.
--
-- ⚠ FALLA SI HAY DIRECTOS REGISTRADOS, y es lo correcto: restaurar el NOT NULL sobre
-- `sha256` con filas que lo tienen a NULL es imposible, y borrarlas en silencio se
-- llevaria por delante sesiones y sus detecciones. Si de verdad se quiere volver atras,
-- primero hay que decidir que se hace con ellas.
DO $$
DECLARE v integer;
BEGIN
    SELECT count(*) INTO v FROM perception.media WHERE kind = 'stream';
    IF v > 0 THEN
        RAISE EXCEPTION
            'hay % medios de tipo stream: decide que hacer con ellos antes de revertir', v;
    END IF;
END $$;

DROP INDEX IF EXISTS perception.uq_media_stream_vivo;
DROP INDEX IF EXISTS perception.uq_media_hash;

ALTER TABLE perception.media DROP CONSTRAINT IF EXISTS chk_media_identidad;
ALTER TABLE perception.media ALTER COLUMN sha256 SET NOT NULL;
ALTER TABLE perception.media
    ADD CONSTRAINT chk_media_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE perception.media
    ADD CONSTRAINT uq_media_hash UNIQUE (tenant_id, warehouse_id, sha256);

ALTER TABLE perception.media DROP CONSTRAINT IF EXISTS chk_media_bytes;
ALTER TABLE perception.media ADD CONSTRAINT chk_media_bytes CHECK (bytes > 0);

ALTER TABLE perception.media DROP CONSTRAINT IF EXISTS chk_media_kind;
ALTER TABLE perception.media
    ADD CONSTRAINT chk_media_kind CHECK (kind IN ('image', 'video'));
ALTER TABLE perception.media DROP COLUMN IF EXISTS stream_url;

UPDATE perception.inference_jobs SET frames_total = 1 WHERE frames_total IS NULL;
ALTER TABLE perception.inference_jobs ALTER COLUMN frames_total SET NOT NULL;
ALTER TABLE perception.inference_jobs DROP CONSTRAINT IF EXISTS chk_job_frames;
ALTER TABLE perception.inference_jobs
    ADD CONSTRAINT chk_job_frames CHECK (
        frames_total > 0 AND frames_processed BETWEEN 0 AND frames_total
    );
