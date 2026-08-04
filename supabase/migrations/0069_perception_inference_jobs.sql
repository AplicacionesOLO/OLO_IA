-- ══════════════════════════════════════════════════════════════════════════════
-- 0069 · Percepción: trabajos de inferencia y sus detecciones
--
-- Es la PRIMERA tabla del esquema `perception`, que 0032 creó vacío a propósito y
-- con un aviso en la cabecera. Este es el archivo que ese aviso esperaba, así que
-- empieza contestándolo punto por punto.
--
-- ── 1 · RÉGIMEN: TENANT, NO PLATFORM OWNER ──────────────────────────────────
--
-- Lo que 0032 pedía comprobar antes de copiar la política de al lado. Aquí NO se
-- copia:
--
--     `ai`         → USING (core.is_platform_owner())     ← la plataforma entrena
--     `perception` → RESTRICTIVE tenant + warehouse_scope  ← el cliente inspecciona
--
-- Un dron volando en el almacén del tenant X graba la mercancía del tenant X.
-- Con la política de `ai` ningún usuario del tenant vería sus propios trabajos; y
-- relajarla para arreglarlo enseñaría a un cliente los vídeos de otro.
--
-- ── 2 · NOMBRES: «inference job» y «detection», no «session» ni «observation» ─
--
-- 0032 hablaba en prosa de «sesiones de inferencia» y de `perception.observations`.
-- TERMINOLOGY.md, que es la autoridad, dice otra cosa y por buenas razones:
--
--     Session          → período de actividad autenticada de un USUARIO
--     Inference Job    → ejecución de un modelo sobre entradas → detecciones
--     Detection        → resultado unitario: clase + bbox + confianza
--
-- Llamar «session» a esto colisionaría con la sesión de login. Y llamar
-- «observations» a las detecciones daría al sistema DOS observaciones distintas:
-- estas y las de `spatial.rack_observations` (0067), que son otra cosa —el hecho
-- resuelto «la fuente vio el rack R»—. Esa ambigüedad es exactamente la que
-- TERMINOLOGY.md existe para evitar.
--
-- La relación entre las dos, que es la que da valor al módulo:
--
--     perception.detections        →  lo que el modelo CREE que ha visto
--                                     (bbox, confianza, texto leído, sin resolver)
--                          ↓ promoción, si el texto casa con un código de rack
--     spatial.rack_observations    →  el hecho resuelto, con FK al nodo
--                          ↓ 0067 × 0065
--     la RUTA en metros sobre el plano
--
-- Una detección que no casa NO se descarta: queda `unmatched`, que es el estado
-- que 0032 declaró sin caducidad porque señala una discrepancia real.
--
-- ── 3 · PARTICIONADO Y CLAVE PRIMARIA: COMO 0032 LAS DEJÓ DECIDIDAS ─────────
--
-- PK `(observed_at, id)` y RANGE mensual sobre `observed_at`. No es una concesión:
-- toda consulta de este módulo es «qué se detectó en esta ventana», y DEC-06 ya
-- midió que PostgreSQL exige la columna de partición en TODA restricción única.
--
-- Se implementa YA y no «cuando haga falta»: convertir después una tabla normal en
-- particionada obliga a reescribirla, y el momento de hacerlo es cuando está vacía.
--
-- Se crean particiones explícitas hasta 2027 MÁS una DEFAULT. La DEFAULT es la red
-- que 0032 pidió —una fila cuya fecha caiga fuera de toda partición fallaría al
-- insertar, y perder una detección es perder evidencia—. Pero no puede ser la
-- única: con filas en la DEFAULT, PostgreSQL RECHAZA adjuntar después la partición
-- que las cubriría, así que un módulo que viviera solo de la DEFAULT se pintaría a
-- sí mismo en una esquina.
--
-- ── 4 · LO QUE NO ESTÁ, Y POR QUÉ ───────────────────────────────────────────
--
-- · NO hay tabla de lotes, aunque 0032 la mencionaba. Un lote es la unidad con la
--   que un worker reporta progreso, y no hay worker: la tabla no tendría quien la
--   escribiera y `frames_processed` en el trabajo dice hoy lo mismo con una fila.
--   Cuando exista el worker será una tabla y no una columna que haya que migrar.
--
-- · NO hay inferencia. Aquí no corre ningún modelo: hay un registro de trabajos y
--   un extremo por el que un worker deja resultados. Un trabajo creado hoy se
--   queda en `queued` porque no hay nadie que lo recoja, y la pantalla lo DICE.
--   Un `running` que nadie mueve sería una barra de progreso que no progresa.
--
-- · NO hay almacenamiento de medios. `bucket`/`object_path` se guardan para cuando
--   exista la subida; hoy pueden ser NULL y entonces el medio solo se conoce por
--   sus metadatos. `sha256` sí es obligatorio: es lo que hace idempotente registrar
--   dos veces el mismo vídeo.
--
-- ── 5 · TRES PERMISOS, POR LA MISMA RAZÓN QUE 0067 ──────────────────────────
--
--     perception:read     ver trabajos y detecciones          todos los roles
--     perception:write    crear, cancelar y revisar           admin/manager/operario
--     perception:ingest   dejar resultados y mover el estado  admin/manager
--
-- Un worker que deja detecciones no debe poder crear trabajos, ni cancelarlos, ni
-- revisar los de otro; y un operario que crea trabajos no debe poder fabricar
-- detecciones a mano y hacerlas pasar por salida del modelo. Con un solo permiso
-- de escritura las dos cosas serían la misma capacidad.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1 · Permisos ───────────────────────────────────────────────────────────
INSERT INTO core.permissions (code, module, action, description, is_privileged)
VALUES
    ('perception:read',   'perception', 'read',
     'Consultar trabajos de inferencia y sus detecciones', false),
    ('perception:write',  'perception', 'write',
     'Crear y cancelar trabajos de inferencia, y revisar sus detecciones', false),
    ('perception:ingest', 'perception', 'ingest',
     'Depositar resultados de inferencia y mover el estado de un trabajo (workers)',
     false)
ON CONFLICT (code) DO NOTHING;

-- Leer: todos los roles que ya ven el almacén. Un auditor que no puede mirar lo
-- que el modelo decidió no puede auditar una decisión tomada con el modelo.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'perception:read'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator',
                  'auditor', 'viewer')
ON CONFLICT DO NOTHING;

-- Escribir: quien opera. `viewer` y `auditor` fuera, igual que en 0067: un auditor
-- que puede revisar detecciones puede fabricar la evidencia que audita.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'perception:write'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager', 'warehouse_operator')
ON CONFLICT DO NOTHING;

-- Ingerir: sin el operario. Es la credencial de una MÁQUINA, y darle también la
-- del pasillo significaría que el móvil de cualquiera puede declarar que el modelo
-- vio algo que el modelo no vio.
INSERT INTO core.role_permissions (role_id, permission_code)
SELECT r.id, 'perception:ingest'
  FROM core.roles r
 WHERE r.name IN ('tenant_admin', 'warehouse_manager')
ON CONFLICT DO NOTHING;


-- ── 2 · Medios ─────────────────────────────────────────────────────────────
-- El vídeo o la imagen que se analiza. Tabla aparte del trabajo, y no columnas
-- dentro de él, porque un mismo vídeo se analiza VARIAS veces: con otro modelo,
-- con otro umbral, o simplemente otra vez cuando el primero falló. Con los
-- metadatos dentro del trabajo, cada reintento duplicaría el tamaño, el hash y las
-- dimensiones, y dos filas discreparían en cuanto alguien corrigiera una.
CREATE TABLE perception.media (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES core.tenants (id),
    warehouse_id      uuid NOT NULL,

    kind              varchar(10) NOT NULL,
    original_filename text NOT NULL,
    content_type      varchar(100) NOT NULL,
    bytes             bigint NOT NULL,

    /**
     * Hash del contenido. Obligatorio, y es la única cosa de aquí que no se puede
     * dejar para después.
     *
     * Es lo que hace idempotente registrar el mismo vídeo dos veces: sin él, un
     * operador con la conexión inestable acaba con cuatro copias del mismo vuelo y
     * cuatro trabajos que dicen cosas parecidas sobre el mismo material.
     */
    sha256            char(64) NOT NULL,

    /**
     * Dónde están los bytes. NULL mientras no exista la subida.
     *
     * Nulos a propósito y no una cadena vacía: «no hay almacenamiento todavía» y
     * «está guardado en la ruta ''» son cosas distintas, y la segunda es un error
     * que se descubriría al intentar abrirlo.
     */
    bucket            varchar(100),
    object_path       text,

    width             integer,
    height            integer,
    /** Solo vídeo. NULL en una imagen: una imagen no dura cero, no dura. */
    duration_ms       integer,
    total_frames      integer,

    /**
     * De dónde salió: un archivo que subió alguien, o material de demostración.
     *
     * Se guarda porque una detección sobre material de demo NO es evidencia sobre
     * el almacén, y mezclar las dos en la misma lista es la forma más rápida de que
     * alguien tome una decisión operativa mirando un vídeo de ejemplo.
     */
    source            varchar(20) NOT NULL DEFAULT 'uploaded-file',

    metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid REFERENCES core.users (id) ON DELETE SET NULL,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid REFERENCES core.users (id) ON DELETE SET NULL,
    deleted_at        timestamptz,

    CONSTRAINT fk_media_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id) ON DELETE CASCADE,
    -- Para que los trabajos puedan tener FK compuesta contra el medio y no puedan
    -- analizar el medio de otro tenant.
    CONSTRAINT uq_media_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_media_hash UNIQUE (tenant_id, warehouse_id, sha256),
    CONSTRAINT chk_media_kind CHECK (kind IN ('image', 'video')),
    CONSTRAINT chk_media_source CHECK (source IN ('uploaded-file', 'demo')),
    CONSTRAINT chk_media_bytes CHECK (bytes > 0),
    CONSTRAINT chk_media_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_media_dims CHECK (
        (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
    ),
    -- Una imagen no tiene duración ni fotogramas. Permitirlo dejaría entrar
    -- «imagen de 30 segundos», que luego alguien reproduce.
    CONSTRAINT chk_media_video_only CHECK (
        kind = 'video' OR (duration_ms IS NULL AND total_frames IS NULL)
    ),
    CONSTRAINT chk_media_duracion CHECK (duration_ms IS NULL OR duration_ms > 0),
    CONSTRAINT chk_media_frames CHECK (total_frames IS NULL OR total_frames > 0),
    -- Los bytes van juntos o no van: una ruta sin bucket no se puede abrir.
    CONSTRAINT chk_media_almacen CHECK (
        (bucket IS NULL AND object_path IS NULL)
        OR (bucket IS NOT NULL AND object_path IS NOT NULL)
    ),
    CONSTRAINT chk_media_metadata CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE perception.media IS
    'Video o imagen a analizar. Tabla aparte del trabajo porque un mismo medio se analiza varias veces. `sha256` hace idempotente registrarlo dos veces.';
COMMENT ON COLUMN perception.media.bucket IS
    'NULL mientras no exista la subida de archivos. Nulo, no cadena vacia: «sin almacenamiento» y «guardado en la ruta vacia» son cosas distintas.';


-- ── 3 · Trabajos de inferencia ─────────────────────────────────────────────
CREATE TABLE perception.inference_jobs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES core.tenants (id),
    warehouse_id          uuid NOT NULL,
    media_id              uuid NOT NULL,

    name                  varchar(200) NOT NULL,
    status                varchar(20) NOT NULL DEFAULT 'draft',

    /** Qué HACE el worker, no solo qué modelo carga. */
    pipeline              varchar(30) NOT NULL,

    /**
     * Qué modelo corrió. Nulo hasta que haya alguno publicado.
     *
     * La FK apunta a `ai.model_versions`, que es de régimen PLATFORM OWNER: el
     * tenant NO puede leer esa fila —las FK no pasan por RLS, así que la referencia
     * funciona igual—. Por eso `model_label` guarda una COPIA del nombre y la
     * versión en el momento de correr.
     *
     * No es desnormalización por comodidad: es procedencia. El modelo se renombra,
     * se archiva o se despublica, y el trabajo tiene que seguir diciendo qué corrió
     * de verdad. Un JOIN daría el nombre de HOY, que no es el que produjo estas
     * detecciones.
     */
    model_version_id      uuid REFERENCES ai.model_versions (id) ON DELETE SET NULL,
    model_label           varchar(200),

    confidence_threshold  double precision NOT NULL DEFAULT 0.5,
    /** Fotogramas por segundo a analizar. Solo tiene sentido en vídeo. */
    frame_sampling_rate   double precision,
    save_detected_frames  boolean NOT NULL DEFAULT true,
    notes                 text,

    frames_processed      integer NOT NULL DEFAULT 0,
    frames_total          integer NOT NULL DEFAULT 1,
    detection_count       integer NOT NULL DEFAULT 0,
    elapsed_ms            integer NOT NULL DEFAULT 0,

    /**
     * Por qué falló. Obligatorio cuando el estado es `failed`, y prohibido cuando
     * no lo es.
     *
     * Un trabajo fallido sin motivo es la peor pantalla posible: dice que algo fue
     * mal y no deja hacer nada al respecto. Y un motivo en un trabajo que terminó
     * bien es un resto de un fallo anterior que alguien leerá como actual.
     */
    error_message         text,

    queued_at             timestamptz,
    started_at            timestamptz,
    completed_at          timestamptz,

    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid REFERENCES core.users (id) ON DELETE SET NULL,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    updated_by            uuid REFERENCES core.users (id) ON DELETE SET NULL,

    CONSTRAINT fk_job_media
        FOREIGN KEY (tenant_id, media_id)
        REFERENCES perception.media (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_job_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_job_tenant_id UNIQUE (tenant_id, id),
    -- El MISMO vocabulario que la máquina de estados del frontend. Si divergen, la
    -- pantalla dibuja una línea de progreso con una etapa que la base rechaza.
    CONSTRAINT chk_job_status CHECK (status IN (
        'draft', 'uploading', 'uploaded', 'queued', 'running',
        'completed', 'failed', 'cancelled'
    )),
    CONSTRAINT chk_job_pipeline CHECK (pipeline IN (
        'object-detection', 'ocr', 'detection-ocr'
    )),
    CONSTRAINT chk_job_umbral CHECK (confidence_threshold BETWEEN 0 AND 1),
    CONSTRAINT chk_job_muestreo CHECK (
        frame_sampling_rate IS NULL OR frame_sampling_rate > 0
    ),
    CONSTRAINT chk_job_frames CHECK (
        frames_total > 0 AND frames_processed BETWEEN 0 AND frames_total
    ),
    CONSTRAINT chk_job_conteos CHECK (detection_count >= 0 AND elapsed_ms >= 0),
    CONSTRAINT chk_job_error CHECK (
        (status = 'failed' AND error_message IS NOT NULL)
        OR (status <> 'failed' AND error_message IS NULL)
    ),
    -- Un trabajo terminado tiene hora de fin, y uno que no ha terminado no la
    -- tiene. Sin esto, `completed_at` puede quedarse de un intento anterior y la
    -- pantalla diría «completado hace 3 días» de algo que está corriendo.
    CONSTRAINT chk_job_fin CHECK (
        (status IN ('completed', 'failed', 'cancelled')) = (completed_at IS NOT NULL)
    ),
    CONSTRAINT chk_job_orden_tiempos CHECK (
        (started_at IS NULL OR queued_at IS NULL OR started_at >= queued_at)
        AND (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
    )
);

COMMENT ON TABLE perception.inference_jobs IS
    'Ejecucion de un modelo sobre un medio. Sin worker registrado un trabajo se queda en `queued`: no hay quien lo recoja, y la pantalla lo dice.';
COMMENT ON COLUMN perception.inference_jobs.model_label IS
    'Copia del nombre y version del modelo AL CORRER. Procedencia, no desnormalizacion: un JOIN daria el nombre de hoy, no el que produjo estas detecciones.';


-- ── 4 · Historial de estados ───────────────────────────────────────────────
-- El frontend ya tenía `statusHistory`, pero lo CONSTRUÍA en el navegador al crear
-- el trabajo. Un historial reconstruido no es un historial: dice lo que el código
-- cree que pasó, no lo que pasó. Aquí cada transición es una fila, escrita por el
-- disparador de la sección 6, así que existe aunque nadie la pida.
CREATE TABLE perception.job_events (
    id           bigserial PRIMARY KEY,
    tenant_id    uuid NOT NULL REFERENCES core.tenants (id),
    job_id       uuid NOT NULL,

    from_status  varchar(20),
    to_status    varchar(20) NOT NULL,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    reason       text,
    actor_id     uuid REFERENCES core.users (id) ON DELETE SET NULL,

    CONSTRAINT fk_event_job
        FOREIGN KEY (tenant_id, job_id)
        REFERENCES perception.inference_jobs (tenant_id, id) ON DELETE CASCADE,
    -- `from_status` nulo solo en el nacimiento del trabajo.
    CONSTRAINT chk_event_origen CHECK (
        from_status IS NULL OR from_status <> to_status
    )
);

COMMENT ON TABLE perception.job_events IS
    'Una fila por transicion de estado, escrita por disparador. El frontend construia este historial en el navegador: reconstruido no es historial.';


-- ── 5 · Detecciones ────────────────────────────────────────────────────────
-- La tabla grande. Un dron a 5 fps con ~20 detecciones por fotograma produce ~100
-- filas/s: 8,6 M al día por dron. De ahí el particionado que 0032 dejó decidido.
CREATE TABLE perception.detections (
    id                 uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES core.tenants (id),
    warehouse_id       uuid NOT NULL,
    job_id             uuid NOT NULL,

    /**
     * CUÁNDO se captó el fotograma. Es la clave de partición, y no es `now()`.
     *
     * Misma razón que en 0067: un dron sin cobertura sube el vuelo entero al
     * aterrizar. Con la hora de llegada, las 8.000 detecciones de un vuelo de 20
     * minutos caerían en el mismo segundo, la ventana temporal no serviría para
     * nada y todas irían a la misma partición.
     */
    observed_at        timestamptz NOT NULL,
    ingested_at        timestamptz NOT NULL DEFAULT now(),

    frame_number       integer NOT NULL DEFAULT 0,
    frame_ms           integer,
    /** Ruta del fotograma guardado, si se guardó. Para volver a mirarlo. */
    frame_ref          text,

    /**
     * La clase, por NOMBRE y no solo por id.
     *
     * `ai_class_id` apunta al catálogo de la plataforma, que el tenant no puede
     * leer; y las clases se renombran. El nombre que produjo esta detección es
     * parte de la detección, igual que `model_label` en el trabajo.
     */
    class_name         varchar(100) NOT NULL,
    ai_class_id        uuid REFERENCES ai.classes (id) ON DELETE SET NULL,
    class_color        char(7),
    confidence         double precision NOT NULL,

    /**
     * El recuadro, en PÍXELES del fotograma o NORMALIZADO 0..1.
     *
     * El formato viaja con los números porque los dos existen —YOLO da
     * normalizado, muchos visores esperan píxeles— y un recuadro sin su formato es
     * un recuadro que alguien va a dibujar mal exactamente una vez.
     */
    bbox_x             double precision NOT NULL,
    bbox_y             double precision NOT NULL,
    bbox_width         double precision NOT NULL,
    bbox_height        double precision NOT NULL,
    bbox_format        varchar(12) NOT NULL DEFAULT 'normalized',

    /**
     * El texto LEÍDO, cuando el pipeline incluye OCR. Aquí está el puente.
     *
     * Si dice «RCL104» y ese código existe como rack del almacén, esta detección se
     * promueve a `spatial.rack_observations` y de ahí sale la ruta sobre el plano.
     * Si no casa, la detección se queda y el estado lo dice.
     */
    text_value         varchar(200),

    /**
     * Estado del ciclo de vida, tal como 0032 lo definió, y con su retención:
     *
     *   unmatched   no casa con nada conocido    SIN CADUCIDAD mientras siga así
     *   matched     casó y se promovió           12 meses
     *   discarded   falso positivo, revisado     90 días
     *   superseded  corregida por otra fila      90 días
     *
     * `unmatched` no caduca porque es la que señala una discrepancia real: un
     * código que el modelo lee y el catálogo no conoce es un problema abierto, y
     * borrarlo destruiría la evidencia del problema.
     */
    state              varchar(12) NOT NULL DEFAULT 'unmatched',

    /** El rack al que se resolvió, si se resolvió. */
    rack_node_id       uuid,

    /**
     * Revisión humana. `pending` mientras nadie la ha mirado.
     *
     * Se guarda en la detección y las CORRECCIONES crean una fila nueva: la
     * original queda `superseded` y apunta a su sustituta. Sobrescribir el recuadro
     * borraría lo que el modelo dijo, que es justo el dato con el que se mide si el
     * modelo está mejorando.
     */
    review_status      varchar(12) NOT NULL DEFAULT 'pending',
    reviewed_at        timestamptz,
    reviewed_by        uuid REFERENCES core.users (id) ON DELETE SET NULL,
    review_comment     text,

    /**
     * A qué detección sustituye esta. Compuesto porque la clave de la tabla lo es:
     * la columna de partición tiene que estar en toda referencia única, así que la
     * FK lleva también el instante. Una corrección es del MISMO fotograma, así que
     * el instante es el mismo y no hay nada que adivinar.
     */
    supersedes_observed_at timestamptz,
    supersedes_id          uuid,

    /**
     * Si la detección la creó una PERSONA y no el modelo.
     *
     * Es el falso negativo: algo que estaba y el modelo no vio. Marcarlo importa
     * porque una detección añadida a mano con confianza 1 sería, midiendo, la
     * predicción más segura del sistema.
     */
    is_manual          boolean NOT NULL DEFAULT false,

    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid REFERENCES core.users (id) ON DELETE SET NULL,

    -- PK con la columna de partición delante: DEC-06 midió que PostgreSQL exige la
    -- columna de partición en toda restricción única, y además «qué se detectó en
    -- esta ventana» es la consulta real de este módulo.
    CONSTRAINT pk_detections PRIMARY KEY (observed_at, id),

    CONSTRAINT fk_det_job
        FOREIGN KEY (tenant_id, job_id)
        REFERENCES perception.inference_jobs (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_det_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES core.warehouses (tenant_id, id) ON DELETE CASCADE,
    -- La MISMA FK compuesta de 0065 y 0067: hace inexpresable resolver una
    -- detección al rack de otro almacén.
    CONSTRAINT fk_det_rack
        FOREIGN KEY (tenant_id, warehouse_id, rack_node_id)
        REFERENCES spatial.nodes (tenant_id, warehouse_id, id) ON DELETE SET NULL,

    CONSTRAINT chk_det_confidence CHECK (confidence BETWEEN 0 AND 1),
    CONSTRAINT chk_det_bbox_format CHECK (bbox_format IN ('pixels', 'normalized')),
    CONSTRAINT chk_det_bbox_positivo CHECK (bbox_width > 0 AND bbox_height > 0),
    -- Normalizado significa 0..1. Un 1,4 «normalizado» se dibuja fuera de la imagen
    -- y nadie lo nota hasta que ve el recuadro colgando.
    CONSTRAINT chk_det_bbox_normalizado CHECK (
        bbox_format <> 'normalized'
        OR (bbox_x BETWEEN 0 AND 1 AND bbox_y BETWEEN 0 AND 1
            AND bbox_x + bbox_width <= 1.0001 AND bbox_y + bbox_height <= 1.0001)
    ),
    CONSTRAINT chk_det_state CHECK (
        state IN ('unmatched', 'matched', 'discarded', 'superseded')
    ),
    CONSTRAINT chk_det_review CHECK (
        review_status IN ('pending', 'accepted', 'rejected', 'corrected')
    ),
    -- `matched` exige el rack, y sin rack no puede estar `matched`: es lo que hace
    -- que «casó» signifique algo comprobable en lugar de una etiqueta.
    CONSTRAINT chk_det_matched CHECK ((state = 'matched') = (rack_node_id IS NOT NULL)),
    CONSTRAINT chk_det_revisado CHECK (
        (review_status = 'pending') = (reviewed_at IS NULL)
    ),
    CONSTRAINT chk_det_supersedes CHECK (
        (supersedes_observed_at IS NULL) = (supersedes_id IS NULL)
    ),
    CONSTRAINT chk_det_frame CHECK (
        frame_number >= 0 AND (frame_ms IS NULL OR frame_ms >= 0)
    ),
    -- Una detección manual no es una predicción: no puede traer confianza del
    -- modelo. Se admite 1 —«esto está aquí, lo he visto yo»— y nada entre medias,
    -- porque una persona no tiene 0,73 de confianza.
    CONSTRAINT chk_det_manual_confianza CHECK (
        NOT is_manual OR confidence = 1
    )
) PARTITION BY RANGE (observed_at);

COMMENT ON TABLE perception.detections IS
    'Lo que el modelo cree que ha visto. Particionada por mes sobre observed_at (0032/DEC-06). Una deteccion que casa con un codigo de rack se promueve a spatial.rack_observations.';
COMMENT ON COLUMN perception.detections.state IS
    'unmatched (sin caducidad: senala una discrepancia abierta) · matched (12 meses) · discarded (90 dias) · superseded (90 dias). Retencion de 0032.';
COMMENT ON COLUMN perception.detections.text_value IS
    'El texto LEIDO por OCR. Si casa con un codigo de rack del almacen, esta deteccion se promueve a observacion y de ahi sale la ruta.';


-- La FK a sí misma va aparte: la tabla tiene que existir antes de poder
-- referenciarla, y en una particionada la referencia es a la PK compuesta.
ALTER TABLE perception.detections
    ADD CONSTRAINT fk_det_supersedes
    FOREIGN KEY (supersedes_observed_at, supersedes_id)
    REFERENCES perception.detections (observed_at, id) ON DELETE SET NULL;


-- ── 6 · Particiones ────────────────────────────────────────────────────────
-- Mensuales desde 2026-01 hasta 2027-12, más una DEFAULT como red.
--
-- Dos años por delante y no «la del mes que viene»: crear la partición es
-- responsabilidad de una tarea que hoy no existe, y sin margen el módulo dejaría de
-- aceptar detecciones un día 1 sin que nada lo avisara. Con la DEFAULT no se
-- pierde ninguna, pero una fila en la DEFAULT IMPIDE adjuntar después la partición
-- que la cubriría, así que la red no puede ser el plan.
DO $$
DECLARE
    v_mes   date := date '2026-01-01';
    v_fin   date := date '2028-01-01';
    v_nombre text;
BEGIN
    WHILE v_mes < v_fin LOOP
        v_nombre := format('detections_%s', to_char(v_mes, 'YYYY_MM'));
        EXECUTE format(
            'CREATE TABLE perception.%I PARTITION OF perception.detections '
            'FOR VALUES FROM (%L) TO (%L)',
            v_nombre, v_mes, v_mes + interval '1 month'
        );
        v_mes := (v_mes + interval '1 month')::date;
    END LOOP;
END $$;

CREATE TABLE perception.detections_default
    PARTITION OF perception.detections DEFAULT;

COMMENT ON TABLE perception.detections_default IS
    'Red de 0032: una fila cuya fecha no cubra ninguna particion fallaria al insertar, y perder una deteccion es perder evidencia. Vigilar que este VACIA: filas aqui impiden adjuntar la particion que las cubriria.';


-- ── 7 · Índices ────────────────────────────────────────────────────────────
-- En una tabla particionada, el índice del padre se propaga a cada partición.
CREATE INDEX ix_det_job_frame
    ON perception.detections (job_id, frame_number);

-- La consulta del módulo: qué se detectó en este almacén en esta ventana.
CREATE INDEX ix_det_warehouse_tiempo
    ON perception.detections (warehouse_id, observed_at DESC);

-- Las que hay que resolver. Parcial a propósito: `unmatched` es una minoría del
-- volumen y el índice completo sería casi todo el histórico ya resuelto.
CREATE INDEX ix_det_pendientes
    ON perception.detections (warehouse_id, observed_at DESC)
    WHERE state = 'unmatched';

-- Por texto leído: es como se resuelve un código a un rack, y como se contesta
-- «¿alguien ha leído alguna vez este código?».
CREATE INDEX ix_det_texto
    ON perception.detections (warehouse_id, text_value)
    WHERE text_value IS NOT NULL;

CREATE INDEX ix_job_warehouse_creado
    ON perception.inference_jobs (warehouse_id, created_at DESC);
CREATE INDEX ix_job_status
    ON perception.inference_jobs (status, created_at DESC);
CREATE INDEX ix_event_job
    ON perception.job_events (job_id, occurred_at);
CREATE INDEX ix_media_warehouse
    ON perception.media (warehouse_id, created_at DESC)
    WHERE deleted_at IS NULL;


-- ── 8 · La máquina de estados, en la base ──────────────────────────────────
-- El frontend ya la tenía en `stateMachine.ts`, con su tabla de transiciones y su
-- `assertJobStatusTransition`. Estaba bien y no bastaba: una comprobación en el
-- cliente es una convención, y cualquier otra cosa que escriba en la tabla —un
-- worker, un script de reparación, una consulta a mano— puede dejar un trabajo en
-- `completed` sin haber pasado por `running`.
--
-- Aquí es un invariante. La tabla de transiciones es LA MISMA, deliberadamente
-- duplicada: si divergen, esta gana y la pantalla se lleva un error del servidor en
-- lugar de escribir un estado imposible.
CREATE OR REPLACE FUNCTION perception.check_job_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = perception, core, pg_catalog
AS $$
DECLARE
    v_validos text[];
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    v_validos := CASE OLD.status
        WHEN 'draft'     THEN ARRAY['uploading', 'cancelled']
        WHEN 'uploading' THEN ARRAY['uploaded', 'failed', 'cancelled']
        WHEN 'uploaded'  THEN ARRAY['queued', 'cancelled']
        WHEN 'queued'    THEN ARRAY['running', 'failed', 'cancelled']
        WHEN 'running'   THEN ARRAY['completed', 'failed', 'cancelled']
        -- `completed` y `cancelled` son terminales. `failed` vuelve a la cola: un
        -- fallo transitorio —el worker se cayó— se reintenta, y eso NO es lo mismo
        -- que poder resucitar un trabajo cancelado a mano.
        WHEN 'failed'    THEN ARRAY['queued', 'cancelled']
        ELSE ARRAY[]::text[]
    END;

    IF NOT (NEW.status = ANY (v_validos)) THEN
        RAISE EXCEPTION
            'transicion de estado invalida en el trabajo %: % -> % (validas desde %: %)',
            OLD.id, OLD.status, NEW.status, OLD.status,
            COALESCE(array_to_string(v_validos, ', '), 'ninguna, es terminal')
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END $$;

COMMENT ON FUNCTION perception.check_job_transition() IS
    'Misma tabla de transiciones que stateMachine.ts del frontend. Duplicada a proposito: en el cliente es una convencion, aqui es un invariante.';

CREATE TRIGGER trg_job_transicion
    BEFORE UPDATE OF status ON perception.inference_jobs
    FOR EACH ROW EXECUTE FUNCTION perception.check_job_transition();


-- Y el historial, escrito por el mismo camino: si la transición pasa el control,
-- queda registrada. Que el registro dependa de que alguien se acuerde de insertar
-- la fila es como se consigue un historial con huecos.
CREATE OR REPLACE FUNCTION perception.log_job_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = perception, core, pg_catalog
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO perception.job_events (tenant_id, job_id, from_status, to_status, actor_id)
        VALUES (NEW.tenant_id, NEW.id, NULL, NEW.status, NEW.created_by);
        RETURN NEW;
    END IF;

    IF NEW.status <> OLD.status THEN
        INSERT INTO perception.job_events
            (tenant_id, job_id, from_status, to_status, reason, actor_id)
        VALUES (NEW.tenant_id, NEW.id, OLD.status, NEW.status,
                NEW.error_message, NEW.updated_by);
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_job_evento_alta
    AFTER INSERT ON perception.inference_jobs
    FOR EACH ROW EXECUTE FUNCTION perception.log_job_event();

CREATE TRIGGER trg_job_evento_cambio
    AFTER UPDATE OF status ON perception.inference_jobs
    FOR EACH ROW EXECUTE FUNCTION perception.log_job_event();

CREATE TRIGGER trg_media_updated_at
    BEFORE UPDATE ON perception.media
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
CREATE TRIGGER trg_job_updated_at
    BEFORE UPDATE ON perception.inference_jobs
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── 9 · RLS ────────────────────────────────────────────────────────────────
-- El régimen TENANT que 0032 pedía. RESTRICTIVE para el aislamiento —no se puede
-- desactivar añadiendo otra policy— y PERMISSIVE para el alcance por almacén.
ALTER TABLE perception.media           ENABLE ROW LEVEL SECURITY;
ALTER TABLE perception.inference_jobs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE perception.job_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE perception.detections      ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON perception.media
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY warehouse_scope ON perception.media
    FOR ALL
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

CREATE POLICY tenant_isolation ON perception.inference_jobs
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY warehouse_scope ON perception.inference_jobs
    FOR ALL
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

CREATE POLICY tenant_isolation ON perception.detections
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY warehouse_scope ON perception.detections
    FOR ALL
    USING (core.can_access_warehouse(warehouse_id))
    WITH CHECK (core.can_access_warehouse(warehouse_id));

-- El historial no tiene `warehouse_id` y no es un olvido: pertenece al trabajo, y
-- el alcance por almacén ya lo aplica el trabajo. Duplicar la columna aquí crearía
-- la posibilidad de que un evento diga un almacén distinto que su trabajo.
CREATE POLICY tenant_isolation ON perception.job_events
    AS RESTRICTIVE FOR ALL
    USING (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());
CREATE POLICY job_scope ON perception.job_events
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM perception.inference_jobs j
         WHERE j.tenant_id = job_events.tenant_id
           AND j.id = job_events.job_id
           AND core.can_access_warehouse(j.warehouse_id)
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM perception.inference_jobs j
         WHERE j.tenant_id = job_events.tenant_id
           AND j.id = job_events.job_id
           AND core.can_access_warehouse(j.warehouse_id)
    ));

GRANT SELECT, INSERT, UPDATE, DELETE ON perception.media          TO olo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON perception.inference_jobs TO olo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON perception.detections     TO olo_app;
-- El historial NO se actualiza ni se borra: una transición ocurrió. Poder
-- reescribirla convertiría el historial en una opinión.
GRANT SELECT, INSERT                 ON perception.job_events     TO olo_app;
GRANT USAGE, SELECT ON SEQUENCE perception.job_events_id_seq      TO olo_app;


-- ── 10 · Vistas ────────────────────────────────────────────────────────────
-- El trabajo con lo que la pantalla necesita y no está en su fila: el medio, el
-- historial contado, y si hay alguien capaz de procesarlo.
CREATE VIEW perception.v_inference_jobs AS
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
       m.id                AS media_id,
       m.kind              AS media_kind,
       m.original_filename AS media_filename,
       m.content_type      AS media_content_type,
       m.bytes             AS media_bytes,
       m.sha256            AS media_sha256,
       m.width             AS media_width,
       m.height            AS media_height,
       m.duration_ms       AS media_duration_ms,
       m.total_frames      AS media_total_frames,
       m.source            AS media_source,
       -- Si los bytes están o no. Es lo que decide si la pantalla puede REPRODUCIR
       -- el medio o solo describirlo; sin esto, el reproductor intenta abrir una
       -- ruta nula y falla delante de quien mira.
       (m.bucket IS NOT NULL AND m.object_path IS NOT NULL) AS media_available,
       (SELECT count(*) FROM perception.job_events e
         WHERE e.tenant_id = j.tenant_id AND e.job_id = j.id) AS event_count
  FROM perception.inference_jobs j
  JOIN perception.media m ON m.tenant_id = j.tenant_id AND m.id = j.media_id;

ALTER VIEW perception.v_inference_jobs SET (security_invoker = true);

COMMENT ON VIEW perception.v_inference_jobs IS
    'Trabajo + medio + numero de transiciones. `media_available` dice si los bytes existen: sin ello el reproductor abre una ruta nula delante de quien mira.';


-- Los códigos leídos que NO casan con ningún rack del almacén. Es el informe que
-- justifica que `unmatched` no caduque: cada fila es un código que el modelo lee y
-- el catálogo no conoce, o sea una discrepancia entre lo que hay en el pasillo y lo
-- que dice el WMS.
CREATE VIEW perception.v_unmatched_texts AS
SELECT d.tenant_id,
       d.warehouse_id,
       d.text_value,
       count(*)                AS lecturas,
       max(d.confidence)       AS confianza_max,
       min(d.observed_at)      AS primera,
       max(d.observed_at)      AS ultima,
       count(DISTINCT d.job_id) AS trabajos
  FROM perception.detections d
 WHERE d.state = 'unmatched'
   AND d.text_value IS NOT NULL
 GROUP BY d.tenant_id, d.warehouse_id, d.text_value;

ALTER VIEW perception.v_unmatched_texts SET (security_invoker = true);

COMMENT ON VIEW perception.v_unmatched_texts IS
    'Codigos leidos que el catalogo espacial no conoce. Cada fila es una discrepancia entre el pasillo y el WMS, y por eso `unmatched` no caduca.';

GRANT SELECT ON perception.v_inference_jobs  TO olo_app;
GRANT SELECT ON perception.v_unmatched_texts TO olo_app;


-- ── 11 · Verificación ──────────────────────────────────────────────────────
DO $$
DECLARE
    v_particiones integer;
    v_politicas   integer;
    v_permisos    integer;
BEGIN
    -- `relkind = 'r'`: sin esto se cuentan también los ÍNDICES, que en una tabla
    -- particionada se propagan a cada partición y heredan su nombre. La primera
    -- versión de esta comprobación contó 150 —25 tablas, 25 claves primarias y
    -- 4×25 índices— y falló diciendo que había demasiadas particiones.
    SELECT count(*) INTO v_particiones
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'perception'
       AND c.relkind = 'r'
       AND c.relname LIKE 'detections\_%';
    -- 24 meses (2026-01 .. 2027-12) + la DEFAULT
    IF v_particiones <> 25 THEN
        RAISE EXCEPTION 'se esperaban 25 particiones, hay %', v_particiones;
    END IF;

    SELECT count(*) INTO v_politicas
      FROM pg_policies WHERE schemaname = 'perception';
    IF v_politicas <> 8 THEN
        RAISE EXCEPTION 'se esperaban 8 politicas RLS, hay %', v_politicas;
    END IF;

    SELECT count(*) INTO v_permisos
      FROM core.permissions WHERE code LIKE 'perception:%';
    IF v_permisos <> 3 THEN
        RAISE EXCEPTION 'se esperaban 3 permisos, hay %', v_permisos;
    END IF;

    RAISE NOTICE '0069 OK · % particiones · % politicas · % permisos',
        v_particiones, v_politicas, v_permisos;
END $$;
