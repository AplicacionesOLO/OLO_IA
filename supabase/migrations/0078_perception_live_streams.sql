-- ══════════════════════════════════════════════════════════════════════════════
-- 0078 · Directos: analizar lo que la cámara está viendo AHORA
--
-- Toca : perception.media (kind `stream`, `sha256` nullable, `stream_url`)
--        perception.inference_jobs (`frames_total` nullable = «no se sabe»)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ UN DIRECTO NO CABÍA EN EL MODELO
--
-- 0069 modeló el medio como un ARCHIVO, y con razón: entonces el flujo era subir un
-- vídeo y analizarlo. Tres invariantes de ese diseño hacen imposible un directo, y las
-- tres son correctas para un archivo:
--
--   1. `sha256` es NOT NULL. Es lo que hace idempotente registrar el mismo vídeo dos
--      veces, y es la clave de `uq_media_hash`. Un directo NO TIENE contenido que
--      hashear: cuando empieza, los bytes no existen todavía.
--
--   2. `kind IN ('image', 'video')`. Un directo no es ninguno de los dos: no es un
--      archivo de vídeo, es una URL que va entregando fotogramas.
--
--   3. `frames_total > 0 AND frames_processed BETWEEN 0 AND frames_total`. Un directo
--      no tiene total. El operario para el vuelo cuando quiere, y hasta entonces
--      `frames_processed` crece sin techo.
--
-- La tentación era falsear el hash —un `sha256` de la URL más la hora— para que la fila
-- entrara. Eso habría metido en la columna que significa «los bytes son estos» un valor
-- que no describe ningún byte, y `uq_media_hash` habría dejado de proteger nada.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ SE CAMBIA, Y QUÉ SE CONSERVA
--
-- `sha256` pasa a nullable **solo para directos**, con un CHECK que lo ata al `kind`:
-- obligatorio en `image` y `video`, prohibido en `stream`. Así la idempotencia del
-- archivo sigue siendo un invariante y no una costumbre.
--
-- Y el índice único se vuelve PARCIAL: `WHERE sha256 IS NOT NULL`. Sin eso, dos
-- directos del mismo almacén colisionarían entre sí —en PostgreSQL los NULL no chocan
-- en un UNIQUE, pero dejarlo implícito es apostar a un detalle del motor en vez de
-- decir lo que se quiere—.
--
-- `frames_total` pasa a nullable, y NULL significa «no se sabe cuántos son». No es un
-- hueco: es la diferencia entre una barra de progreso con porcentaje y un contador que
-- sube. Un directo con `frames_total = 1` habría dibujado una barra al 100 % en el
-- primer fotograma y ahí se habría quedado.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1 · El medio puede ser un directo ──────────────────────────────────────
ALTER TABLE perception.media
    ADD COLUMN IF NOT EXISTS stream_url text;

COMMENT ON COLUMN perception.media.stream_url IS
    'De donde se leen los fotogramas en un directo: rtmp://, rtsp:// o http(s):// con HLS. Solo en kind = stream.';

ALTER TABLE perception.media DROP CONSTRAINT IF EXISTS chk_media_kind;
ALTER TABLE perception.media
    ADD CONSTRAINT chk_media_kind CHECK (kind IN ('image', 'video', 'stream'));

ALTER TABLE perception.media ALTER COLUMN sha256 DROP NOT NULL;

-- El CHECK que sustituye al NOT NULL, y que además ata la URL al tipo. Los dos sentidos
-- importan: un archivo sin hash pierde la idempotencia, y un directo CON hash afirma
-- algo sobre unos bytes que no existen.
ALTER TABLE perception.media DROP CONSTRAINT IF EXISTS chk_media_sha256;
ALTER TABLE perception.media
    ADD CONSTRAINT chk_media_identidad CHECK (
        (kind = 'stream' AND sha256 IS NULL AND stream_url IS NOT NULL)
        OR (
            kind IN ('image', 'video')
            -- `IS NOT NULL` EXPLÍCITO, y no es redundante con el patrón.
            --
            -- En SQL un CHECK solo rechaza cuando evalúa a FALSE; si evalúa a NULL,
            -- PASA. Con `sha256` a NULL, `sha256 ~ '^...'` da NULL, la conjunción entera
            -- da NULL, y `false OR NULL` da NULL: la fila entraba.
            --
            -- Lo pilló la verificación de abajo al probar el caso que DEBE fallar. Sin
            -- esa prueba, el NOT NULL que 0069 garantizaba se habría perdido en silencio
            -- y un vídeo sin hash habría entrado sin idempotencia.
            AND sha256 IS NOT NULL
            AND sha256 ~ '^[0-9a-f]{64}$'
            AND stream_url IS NULL
        )
    );

-- `bytes` tampoco aplica a un directo: no hay archivo cuyo tamaño medir. Se guarda 0 y
-- el CHECK lo ata al tipo, así que un 0 no se puede confundir con un archivo vacío o
-- truncado —que en `image` o `video` sigue siendo un error, como en 0069—.
--
-- 0 y no NULL porque `bytes` es NOT NULL y volverlo nullable obligaría a tocar el
-- contrato de la API y el DTO del frontend, donde el tamaño de un archivo SÍ es
-- obligatorio. El CHECK es lo que da el significado.
ALTER TABLE perception.media DROP CONSTRAINT IF EXISTS chk_media_bytes;
ALTER TABLE perception.media
    ADD CONSTRAINT chk_media_bytes CHECK (
        (kind = 'stream' AND bytes = 0) OR (kind <> 'stream' AND bytes > 0)
    );

-- Un directo tampoco tiene bytes en Storage, así que el CHECK que exigía bucket y ruta
-- juntos se mantiene tal cual: los dos siguen siendo NULL, que ya era válido.

-- El único, ahora PARCIAL. Ver la cabecera.
--
-- La RESTRICCIÓN primero y el índice después, y en ese orden: `uq_media_hash` se creó
-- como `CONSTRAINT UNIQUE`, así que su índice le pertenece y PostgreSQL rechaza
-- borrarlo por separado —«cannot drop index ... because constraint ... requires it»—.
-- El `DROP INDEX` de después solo cubre el caso de que en algún entorno se hubiera
-- creado como índice suelto.
ALTER TABLE perception.media DROP CONSTRAINT IF EXISTS uq_media_hash;
DROP INDEX IF EXISTS perception.uq_media_hash;
CREATE UNIQUE INDEX uq_media_hash
    ON perception.media (tenant_id, warehouse_id, sha256)
    WHERE sha256 IS NOT NULL;

-- Y los directos SÍ se distinguen entre sí, por su URL y mientras estén vivos. Dos
-- sesiones simultáneas sobre la misma cámara serían dos workers leyendo el mismo
-- stream y duplicando cada detección.
CREATE UNIQUE INDEX uq_media_stream_vivo
    ON perception.media (tenant_id, warehouse_id, stream_url)
    WHERE kind = 'stream' AND deleted_at IS NULL;


-- ── 2 · Un trabajo puede no saber cuántos fotogramas son ───────────────────
ALTER TABLE perception.inference_jobs ALTER COLUMN frames_total DROP NOT NULL;

ALTER TABLE perception.inference_jobs DROP CONSTRAINT IF EXISTS chk_job_frames;
ALTER TABLE perception.inference_jobs
    ADD CONSTRAINT chk_job_frames CHECK (
        -- NULL = directo: se cuenta lo procesado y no hay porcentaje que calcular.
        (frames_total IS NULL AND frames_processed >= 0)
        -- Conocido = archivo: sigue siendo imposible procesar más de los que hay.
        OR (frames_total > 0 AND frames_processed BETWEEN 0 AND frames_total)
    );

COMMENT ON COLUMN perception.inference_jobs.frames_total IS
    'Cuantos fotogramas se van a analizar. NULL en un directo: no se sabe, y la pantalla cuenta en vez de calcular un porcentaje.';


-- ── Verificación ────────────────────────────────────────────────────────────
--
-- Se PRUEBAN los dos sentidos de cada regla nueva, con filas de usar y tirar. Un CHECK
-- que solo se comprueba por el lado que debe pasar no demuestra que rechace nada.
DO $$
DECLARE
    v_tenant uuid;
    v_wh     uuid;
    v_media  uuid;
    v_ok     int := 0;
BEGIN
    SELECT id INTO v_tenant FROM core.tenants LIMIT 1;
    SELECT id INTO v_wh FROM core.warehouses WHERE tenant_id = v_tenant LIMIT 1;
    IF v_tenant IS NULL OR v_wh IS NULL THEN
        RAISE NOTICE '0078 · sin tenant o almacen: se omiten las pruebas de CHECK';
        RETURN;
    END IF;

    -- Un directo SIN hash entra.
    INSERT INTO perception.media
        (tenant_id, warehouse_id, kind, original_filename, content_type, bytes,
         sha256, stream_url, source)
    VALUES (v_tenant, v_wh, 'stream', 'camara-verificacion', 'video/x-flv', 0,
            NULL, 'rtmp://127.0.0.1:1935/verificacion-0078', 'uploaded-file')
    RETURNING id INTO v_media;
    v_ok := v_ok + 1;

    -- Un directo CON hash NO entra: afirmaria algo sobre bytes que no existen.
    BEGIN
        INSERT INTO perception.media
            (tenant_id, warehouse_id, kind, original_filename, content_type, bytes,
             sha256, stream_url, source)
        VALUES (v_tenant, v_wh, 'stream', 'x', 'video/x-flv', 0,
                repeat('a', 64), 'rtmp://127.0.0.1:1935/otro', 'uploaded-file');
        RAISE EXCEPTION 'un directo con sha256 deberia rechazarse';
    EXCEPTION WHEN check_violation THEN
        v_ok := v_ok + 1;
    END;

    -- Un archivo SIN hash tampoco: perderia la idempotencia que 0069 garantiza.
    BEGIN
        INSERT INTO perception.media
            (tenant_id, warehouse_id, kind, original_filename, content_type, bytes,
             sha256, source)
        VALUES (v_tenant, v_wh, 'video', 'x.mp4', 'video/mp4', 10, NULL, 'uploaded-file');
        RAISE EXCEPTION 'un video sin sha256 deberia rechazarse';
    EXCEPTION WHEN check_violation THEN
        v_ok := v_ok + 1;
    END;

    -- Y dos directos sobre la MISMA url del mismo almacen chocan: serian dos workers
    -- leyendo la misma camara y duplicando cada deteccion.
    BEGIN
        INSERT INTO perception.media
            (tenant_id, warehouse_id, kind, original_filename, content_type, bytes,
             sha256, stream_url, source)
        VALUES (v_tenant, v_wh, 'stream', 'duplicado', 'video/x-flv', 0,
                NULL, 'rtmp://127.0.0.1:1935/verificacion-0078', 'uploaded-file');
        RAISE EXCEPTION 'dos directos sobre la misma url deberian chocar';
    EXCEPTION WHEN unique_violation THEN
        v_ok := v_ok + 1;
    END;

    DELETE FROM perception.media WHERE id = v_media;

    IF v_ok <> 4 THEN
        RAISE EXCEPTION 'solo % de 4 comprobaciones pasaron', v_ok;
    END IF;

    RAISE NOTICE
        '0078 OK · directos admitidos, y las 3 reglas rechazan lo que deben (4/4)';
END $$;
