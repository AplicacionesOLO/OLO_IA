-- ═══════════════════════════════════════════════════════════════════════════
-- 0036_ai_architectures.sql
-- Crea     : ai.architectures + políticas RLS + 16 filas
-- Depende de: 0035 (frameworks), 0031 (los 3 dominios)
-- Riesgo   : bajo
--
-- ESTA TABLA ES LA AGNOSTICIDAD. No es una lista de nombres: es una declaración
-- de CAPACIDADES que otras piezas consultan en lugar de decidir con condicionales.
--
--   · el formulario de entrenamiento se GENERA desde `hyperparam_schema`, así que
--     añadir RT-DETR no toca la interfaz;
--   · el trigger de ai.models RECHAZA combinaciones imposibles antes de reservar
--     una GPU: un modelo `ocr` sobre `yolo11n` no llega a existir;
--   · el worker despacha por el `adapter` del framework, no por arquitectura;
--   · `approx_weights_mb` alimenta la política de retención sin tener que medir
--     los ficheros.
--
-- ⚠ SIEMBRA DELIBERADAMENTE DESIGUAL, y conviene que quede escrito por qué.
--
--   `yolo11*` y `yolov8*` llevan `default_hyperparams` y `hyperparam_schema`
--   completos: es el primer modelo que vamos a integrar y sus parámetros están
--   verificados.
--
--   Para `rtdetr`, `sam2`, `grounding-dino`, `florence-2` y `clip` se siembra
--   SOLO lo que se puede afirmar: framework, tareas, tipos de entrada, si
--   entrenan y extensión de pesos. Su `hyperparam_schema` queda `{}` y se rellena
--   cuando esa arquitectura se integre de verdad, en su bloque.
--
--   Sembrar números sin verificar sería PEOR que dejarlo vacío: parecerían
--   configuración válida y nadie los revisaría antes de lanzar un entrenamiento.
--   Un `{}` obliga a mirarlo; un valor plausible y equivocado, no.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ai.architectures (
    code                        varchar(60)  PRIMARY KEY,
    framework_code              varchar(30)  NOT NULL
                                             REFERENCES ai.frameworks(code) ON DELETE RESTRICT,
    display_name                varchar(80)  NOT NULL,
    family                      varchar(40)  NOT NULL,

    -- Capacidades. Los tres arrays quedan validados por los dominios de 0031,
    -- sin repetir las listas: se verificó que el CHECK de un DOMAIN se aplica a
    -- los elementos de un array.
    supported_tasks             ai.task[]            NOT NULL,
    supported_input_types       ai.input_type[]      NOT NULL,
    supported_annotation_kinds  ai.annotation_kind[] NOT NULL DEFAULT '{}',

    requires_training           boolean      NOT NULL,
    requires_annotations        boolean      NOT NULL,

    weights_extension           varchar(20)  NULL,
    default_hyperparams         jsonb        NOT NULL DEFAULT '{}',
    hyperparam_schema           jsonb        NOT NULL DEFAULT '{}',
    min_images_recommended      integer      NULL,
    approx_weights_mb           integer      NULL,
    is_active                   boolean      NOT NULL DEFAULT true,
    notes                       text         NULL,

    created_at                  timestamptz  NOT NULL DEFAULT now(),
    created_by                  uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at                  timestamptz  NOT NULL DEFAULT now(),
    updated_by                  uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,

    CONSTRAINT chk_arch_code   CHECK (code ~ '^[a-z0-9][a-z0-9._-]*$'),
    CONSTRAINT chk_arch_tasks  CHECK (cardinality(supported_tasks) > 0),
    CONSTRAINT chk_arch_inputs CHECK (cardinality(supported_input_types) > 0),

    -- Coherencia entre las dos banderas y los tipos de anotación:
    -- si necesita anotaciones debe decir CUÁLES, y si no las necesita no declara
    -- ninguna. Sin esto se podría registrar una arquitectura supervisada sin
    -- indicar qué consume, y el exportador no sabría qué generar.
    CONSTRAINT chk_arch_anotaciones CHECK (
        requires_annotations = (cardinality(supported_annotation_kinds) > 0)
    ),
    -- Entrenar sin anotaciones no tiene sentido para ninguna tarea supervisada.
    CONSTRAINT chk_arch_entrena CHECK (NOT requires_training OR requires_annotations),

    CONSTRAINT chk_arch_hp_objeto CHECK (
        jsonb_typeof(default_hyperparams) = 'object'
        AND jsonb_typeof(hyperparam_schema) = 'object'
    ),
    CONSTRAINT chk_arch_pesos CHECK (approx_weights_mb IS NULL OR approx_weights_mb > 0)
);

COMMENT ON TABLE ai.architectures IS
    'Catalogo de CAPACIDADES por arquitectura. Es lo que hace la plataforma agnostica: lo que varia esta en datos, no en condicionales.';
COMMENT ON COLUMN ai.architectures.supported_annotation_kinds IS
    'Tipos de anotacion que CONSUME para entrenar, no los que produce. Vacio en arquitecturas zero-shot.';
COMMENT ON COLUMN ai.architectures.hyperparam_schema IS
    'Descripcion de los parametros aceptados. El formulario de entrenamiento se genera de aqui. Vacio = pendiente de verificar.';
COMMENT ON COLUMN ai.architectures.weights_extension IS
    'NULL en arquitecturas custom: lo declara cada modelo en ai.models.config.';

CREATE INDEX idx_arch_familia ON ai.architectures (family) WHERE is_active;
CREATE INDEX idx_arch_framework ON ai.architectures (framework_code);

CREATE TRIGGER trg_arch_updated_at
    BEFORE UPDATE ON ai.architectures
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE ai.architectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.architectures FORCE ROW LEVEL SECURITY;

CREATE POLICY arch_platform_only ON ai.architectures
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
CREATE POLICY arch_read ON ai.architectures
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY arch_insert ON ai.architectures
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY arch_update ON ai.architectures
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Siembra: VERIFICADA (yolo11 y yolov8) ──────────────────────────────────
--
-- Parámetros por defecto de Ultralytics, comprobados: epochs 100, batch 16,
-- imgsz 640, lr0 0.01, patience 100, optimizer auto.
INSERT INTO ai.architectures (
    code, framework_code, display_name, family,
    supported_tasks, supported_input_types, supported_annotation_kinds,
    requires_training, requires_annotations, weights_extension,
    default_hyperparams, hyperparam_schema,
    min_images_recommended, approx_weights_mb, notes
)
SELECT
    v.code, 'ultralytics', v.display_name, v.family,
    ARRAY['detect','segment','classify','pose']::ai.task[],
    ARRAY['image','video','frames']::ai.input_type[],
    ARRAY['bbox','polygon','keypoints','image_label']::ai.annotation_kind[],
    true, true, '.pt',
    '{"epochs": 100, "batch": 16, "imgsz": 640, "lr0": 0.01,
      "patience": 100, "optimizer": "auto"}'::jsonb,
    '{"epochs":    {"type":"integer","min":1,"max":1000,"default":100},
      "batch":     {"type":"integer","min":1,"max":256,"default":16},
      "imgsz":     {"type":"enum","values":[320,416,512,640,768,896,1024,1280],"default":640},
      "lr0":       {"type":"number","min":0.000001,"max":0.5,"default":0.01},
      "patience":  {"type":"integer","min":0,"max":500,"default":100},
      "optimizer": {"type":"enum","values":["auto","SGD","Adam","AdamW"],"default":"auto"}}'::jsonb,
    v.min_img, v.mb, 'Parametros verificados contra los defaults de Ultralytics.'
FROM (VALUES
    ('yolo11n', 'YOLO11 nano',   'yolo11', 100,   6),
    ('yolo11s', 'YOLO11 small',  'yolo11', 150,  19),
    ('yolo11m', 'YOLO11 medium', 'yolo11', 300,  40),
    ('yolo11l', 'YOLO11 large',  'yolo11', 500,  50),
    ('yolo11x', 'YOLO11 xlarge', 'yolo11', 800, 110),
    ('yolov8n', 'YOLOv8 nano',   'yolov8', 100,   6),
    ('yolov8s', 'YOLOv8 small',  'yolov8', 150,  22),
    ('yolov8m', 'YOLOv8 medium', 'yolov8', 300,  52),
    ('yolov8l', 'YOLOv8 large',  'yolov8', 500,  87),
    ('yolov8x', 'YOLOv8 xlarge', 'yolov8', 800, 136)
) AS v(code, display_name, family, min_img, mb)
ON CONFLICT (code) DO NOTHING;


-- ── Siembra: CAPACIDADES SOLO, hyperparam_schema pendiente ─────────────────
INSERT INTO ai.architectures (
    code, framework_code, display_name, family,
    supported_tasks, supported_input_types, supported_annotation_kinds,
    requires_training, requires_annotations, weights_extension,
    min_images_recommended, approx_weights_mb, notes
) VALUES
    ('rtdetr-l', 'ultralytics', 'RT-DETR large', 'rtdetr',
     ARRAY['detect']::ai.task[],
     ARRAY['image','video','frames']::ai.input_type[],
     ARRAY['bbox']::ai.annotation_kind[],
     true, true, '.pt', 300, 66,
     'PENDIENTE: hyperparam_schema sin verificar. Se completa al integrar RT-DETR.'),

    ('sam2-b', 'pytorch', 'SAM 2 base', 'sam2',
     ARRAY['segment']::ai.task[],
     ARRAY['image','video','frames']::ai.input_type[],
     '{}'::ai.annotation_kind[],
     false, false, '.pt', NULL, 162,
     'Zero-shot con prompt. No entrena: el prompt va en ai.models.config. hyperparam_schema pendiente.'),

    ('grounding-dino-t', 'pytorch', 'Grounding DINO tiny', 'grounding_dino',
     ARRAY['detect']::ai.task[],
     ARRAY['image','frames']::ai.input_type[],
     '{}'::ai.annotation_kind[],
     false, false, '.pth', NULL, 694,
     'Deteccion guiada por texto. Las clases de texto van en ai.models.config. hyperparam_schema pendiente.'),

    ('florence-2-base', 'pytorch', 'Florence-2 base', 'florence',
     ARRAY['detect','ocr','classify']::ai.task[],
     ARRAY['image','frames']::ai.input_type[],
     '{}'::ai.annotation_kind[],
     false, false, '.safetensors', NULL, 920,
     'Multimodal, varias tareas segun el prompt. hyperparam_schema pendiente.'),

    ('clip-vit-b32', 'pytorch', 'CLIP ViT-B/32', 'clip',
     ARRAY['embed','classify']::ai.task[],
     ARRAY['image','frames']::ai.input_type[],
     '{}'::ai.annotation_kind[],
     false, false, '.safetensors', NULL, 605,
     'Embeddings y clasificacion zero-shot. hyperparam_schema pendiente.'),

    ('custom', 'custom', 'Arquitectura propia', 'custom',
     ARRAY['detect','segment','classify','ocr','track','pose','count','regress','embed']::ai.task[],
     ARRAY['image','video','frames','point_cloud','depth','thermal','fusion']::ai.input_type[],
     ARRAY['bbox','polygon','keypoints','image_label','text_region','count']::ai.annotation_kind[],
     true, true, NULL, NULL, NULL,
     'Comodin para modelos propios. Cada modelo declara sus detalles en config.')
ON CONFLICT (code) DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_total     int;
    v_verificadas int;
    v_pendientes  int;
    v_zero_shot   int;
    v_pol       int;
    v_rechazado boolean := false;
BEGIN
    SELECT count(1) INTO v_total FROM ai.architectures;
    IF v_total <> 16 THEN RAISE EXCEPTION 'se esperaban 16 arquitecturas, hay %', v_total; END IF;

    SELECT count(1) INTO v_verificadas FROM ai.architectures
     WHERE hyperparam_schema <> '{}'::jsonb;
    IF v_verificadas <> 10 THEN
        RAISE EXCEPTION
            'solo yolo11* y yolov8* deben llevar hyperparam_schema, hay %', v_verificadas;
    END IF;

    SELECT count(1) INTO v_pendientes FROM ai.architectures
     WHERE hyperparam_schema = '{}'::jsonb;
    SELECT count(1) INTO v_zero_shot FROM ai.architectures
     WHERE NOT requires_training;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'ai' AND tablename = 'architectures';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    -- Prueba viva de que el dominio valida los ELEMENTOS del array. Es la
    -- propiedad de la que depende que las capacidades sean fiables.
    BEGIN
        INSERT INTO ai.architectures (
            code, framework_code, display_name, family,
            supported_tasks, supported_input_types, supported_annotation_kinds,
            requires_training, requires_annotations
        ) VALUES (
            'prueba-invalida', 'custom', 'Prueba', 'prueba',
            ARRAY['detect','tarea_inexistente']::ai.task[],
            ARRAY['image']::ai.input_type[], '{}'::ai.annotation_kind[],
            false, false
        );
    EXCEPTION WHEN check_violation THEN
        v_rechazado := true;
    END;
    IF NOT v_rechazado THEN
        RAISE EXCEPTION 'el dominio ai.task NO rechazo una tarea inexistente en el array';
    END IF;

    RAISE NOTICE
        'OK 0036: 16 arquitecturas (% con hiperparametros verificados, % pendientes, % zero-shot), 4 politicas, dominio validado en vivo',
        v_verificadas, v_pendientes, v_zero_shot;
END
$$;
