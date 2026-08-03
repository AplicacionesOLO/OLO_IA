-- ═══════════════════════════════════════════════════════════════════════════
-- 0061_vision_stack_rfdetr.sql
-- Crea     : framework `rfdetr` + 4 arquitecturas RF-DETR
-- Modifica : desactiva las 11 arquitecturas de `ultralytics`
-- Depende de: 0035 (ai_frameworks), 0036 (ai_architectures)
-- Riesgo   : bajo — solo datos de catálogo, ninguna estructura
-- Decide en: docs/adr/ADR-014-vision-stack.md
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ SE RETIRAN LAS ARQUITECTURAS DE ULTRALYTICS
--
-- YOLO11 y YOLOv8 son **AGPL-3.0**. Su cláusula §13 obliga a entregar el código
-- fuente de la obra COMPLETA a cualquier usuario que interactúe con el software a
-- través de una red. OLO_IA es un SaaS multi-tenant: cada tenant es un usuario
-- remoto, así que la obligación alcanzaría al backend, al frontend y a la lógica de
-- reconciliación — al producto entero.
--
-- Ultralytics sostiene además que la AGPL alcanza a los PESOS entrenados con su
-- código. Es discutible jurídicamente, pero es su posición declarada.
--
-- Dejarlas activas en el catálogo significa que un operador puede elegirlas sin
-- saberlo, entrenar tres semanas y descubrir el problema cuando ya hay un cliente.
--
-- ⚠ SE DESACTIVAN, NO SE BORRAN. Dos motivos:
--
--   1. `yolo11l` está referenciada por 2 modelos existentes. `ai.models` tiene FK a
--      `ai.architectures`, así que un DELETE fallaría — y el error dedicado
--      `ArchitectureInUseError` existe precisamente para ese caso.
--   2. Un catálogo de referencia no se reescribe: si un modelo histórico apuntó a
--      `yolo11l`, esa fila tiene que seguir resolviendo para poder interpretarlo.
--
-- `is_active = false` es la vía correcta: desaparece de la selección de modelos
-- nuevos y sigue resolviendo para los antiguos.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA TRAMPA QUE ESTA MIGRACIÓN TAMBIÉN CIERRA
--
-- `rtdetr-l` estaba registrada con `framework_code = 'ultralytics'`. Es la RT-DETR
-- EMPAQUETADA por Ultralytics, y por tanto AGPL — no la implementación original de
-- sus autores, que es Apache 2.0.
--
-- Misma arquitectura, licencia distinta según el repositorio de origen. Es
-- exactamente el tipo de detalle que no se ve en una tabla de comparación.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ LOS HIPERPARÁMETROS SON PROVISIONALES Y ESTÁN MARCADOS COMO TALES
--
-- Los valores de `default_hyperparams` se verifican contra el paquete `rfdetr`
-- instalado ANTES del primer entrenamiento real. No se copian de una tabla
-- comparativa: un `lr` inventado produce un entrenamiento que no converge y horas
-- perdidas buscando la causa en otro sitio.
--
-- El campo `notes` de cada fila lo dice, para que quien lo lea en la UI lo sepa.
--
-- RF-DETR usa `resolution` y NO `imgsz`, y debe ser DIVISIBLE POR 56 (arquitectura
-- de transformador con parches). Un valor no divisible falla al construir el modelo.
-- ═══════════════════════════════════════════════════════════════════════════

-- `admin_sql.py` ya ejecuta el archivo completo dentro de UNA transaccion, asi que
-- un BEGIN explicito produce «there is already a transaction in progress» y un
-- COMMIT la cerraria antes de la verificacion.

-- ── 1 · El framework ────────────────────────────────────────────────────────
--
-- Aparte de `pytorch` aunque RF-DETR corra sobre PyTorch: el `adapter` identifica
-- QUIÉN sabe cargar y entrenar el modelo, y el paquete `rfdetr` tiene su propia API
-- (`RFDETRBase().train(...)`). Meterlo bajo `pytorch` obligaría al adaptador genérico
-- de torch a conocer las particularidades de cada familia.
INSERT INTO ai.frameworks (code, display_name, adapter, is_active, notes)
VALUES (
    'rfdetr',
    'RF-DETR',
    'rfdetr',
    true,
    'Apache 2.0 en codigo Y pesos. Mantenido por Roboflow. Sin NMS, exporta limpio '
    || 'a ONNX. Elegido como detector de produccion en ADR-014.'
)
ON CONFLICT (code) DO UPDATE
   SET display_name = EXCLUDED.display_name,
       adapter      = EXCLUDED.adapter,
       is_active    = true,
       notes        = EXCLUDED.notes;


-- ── 2 · Las arquitecturas ───────────────────────────────────────────────────
--
-- Solo `detect`. RF-DETR es un detector: no hace segmentación, ni clasificación, ni
-- pose. Declarar tareas que no soporta permitiría crear un modelo que falla al
-- entrenar, y el trigger `validate_model_against_architecture` no podría avisar.
--
-- `requires_annotations = true` porque `requires_training = true`: lo impone
-- `chk_arch_entrena`. Y `chk_arch_anotaciones` exige que el array de tipos de
-- anotación no esté vacío si se requieren — de ahí `{bbox}`.
INSERT INTO ai.architectures (
    code, framework_code, display_name, family,
    supported_tasks, supported_input_types, supported_annotation_kinds,
    requires_training, requires_annotations, weights_extension,
    default_hyperparams, hyperparam_schema,
    min_images_recommended, approx_weights_mb, is_active, notes
)
VALUES
    (
        'rf-detr-nano', 'rfdetr', 'RF-DETR Nano', 'rf-detr',
        ARRAY['detect']::ai.task[],
        ARRAY['image','video','frames']::ai.input_type[],
        ARRAY['bbox']::ai.annotation_kind[],
        true, true, '.pth',
        '{"epochs": 50, "batch_size": 8, "lr": 0.0001, "resolution": 560}'::jsonb,
        '{"epochs": {"type": "integer", "min": 1, "max": 1000, "default": 50},
          "batch_size": {"type": "integer", "min": 1, "max": 64, "default": 8},
          "lr": {"type": "number", "min": 0.000001, "max": 0.01, "default": 0.0001},
          "resolution": {"type": "enum", "values": [392, 448, 504, 560, 616, 672, 728, 784, 840, 896, 952, 1008],
                         "default": 560}}'::jsonb,
        100, 30, true,
        'Apache 2.0. Para el borde y el dron. HIPERPARAMETROS PROVISIONALES: verificar '
        || 'contra el paquete rfdetr instalado antes del primer entrenamiento. '
        || '`resolution` debe ser divisible por 56.'
    ),
    (
        'rf-detr-small', 'rfdetr', 'RF-DETR Small', 'rf-detr',
        ARRAY['detect']::ai.task[],
        ARRAY['image','video','frames']::ai.input_type[],
        ARRAY['bbox']::ai.annotation_kind[],
        true, true, '.pth',
        '{"epochs": 50, "batch_size": 8, "lr": 0.0001, "resolution": 560}'::jsonb,
        '{"epochs": {"type": "integer", "min": 1, "max": 1000, "default": 50},
          "batch_size": {"type": "integer", "min": 1, "max": 64, "default": 8},
          "lr": {"type": "number", "min": 0.000001, "max": 0.01, "default": 0.0001},
          "resolution": {"type": "enum", "values": [392, 448, 504, 560, 616, 672, 728, 784, 840, 896, 952, 1008],
                         "default": 560}}'::jsonb,
        150, 60, true,
        'Apache 2.0. HIPERPARAMETROS PROVISIONALES: verificar contra el paquete rfdetr '
        || 'instalado. `resolution` divisible por 56.'
    ),
    (
        'rf-detr-base', 'rfdetr', 'RF-DETR Base', 'rf-detr',
        ARRAY['detect']::ai.task[],
        ARRAY['image','video','frames']::ai.input_type[],
        ARRAY['bbox']::ai.annotation_kind[],
        true, true, '.pth',
        '{"epochs": 50, "batch_size": 4, "lr": 0.0001, "resolution": 728}'::jsonb,
        '{"epochs": {"type": "integer", "min": 1, "max": 1000, "default": 50},
          "batch_size": {"type": "integer", "min": 1, "max": 64, "default": 4},
          "lr": {"type": "number", "min": 0.000001, "max": 0.01, "default": 0.0001},
          "resolution": {"type": "enum", "values": [392, 448, 504, 560, 616, 672, 728, 784, 840, 896, 952, 1008],
                         "default": 728}}'::jsonb,
        300, 120, true,
        'Apache 2.0. Punto de partida recomendado para produccion en nube. '
        || 'HIPERPARAMETROS PROVISIONALES: verificar contra el paquete rfdetr instalado. '
        || 'Resolucion alta importa para leer QR pequenos. `resolution` divisible por 56.'
    ),
    (
        'rf-detr-large', 'rfdetr', 'RF-DETR Large', 'rf-detr',
        ARRAY['detect']::ai.task[],
        ARRAY['image','video','frames']::ai.input_type[],
        ARRAY['bbox']::ai.annotation_kind[],
        true, true, '.pth',
        '{"epochs": 50, "batch_size": 2, "lr": 0.0001, "resolution": 728}'::jsonb,
        '{"epochs": {"type": "integer", "min": 1, "max": 1000, "default": 50},
          "batch_size": {"type": "integer", "min": 1, "max": 32, "default": 2},
          "lr": {"type": "number", "min": 0.000001, "max": 0.01, "default": 0.0001},
          "resolution": {"type": "enum", "values": [392, 448, 504, 560, 616, 672, 728, 784, 840, 896, 952, 1008],
                         "default": 728}}'::jsonb,
        500, 250, true,
        'Apache 2.0. Para reverificar detecciones dudosas, no para el flujo masivo. '
        || 'HIPERPARAMETROS PROVISIONALES: verificar contra el paquete rfdetr instalado. '
        || '`resolution` divisible por 56.'
    )
ON CONFLICT (code) DO UPDATE
   SET framework_code             = EXCLUDED.framework_code,
       display_name               = EXCLUDED.display_name,
       family                     = EXCLUDED.family,
       supported_tasks            = EXCLUDED.supported_tasks,
       supported_input_types      = EXCLUDED.supported_input_types,
       supported_annotation_kinds = EXCLUDED.supported_annotation_kinds,
       default_hyperparams        = EXCLUDED.default_hyperparams,
       hyperparam_schema          = EXCLUDED.hyperparam_schema,
       min_images_recommended     = EXCLUDED.min_images_recommended,
       approx_weights_mb          = EXCLUDED.approx_weights_mb,
       is_active                  = true,
       notes                      = EXCLUDED.notes;


-- ── 3 · Retirada de las arquitecturas AGPL ──────────────────────────────────
UPDATE ai.architectures
   SET is_active  = false,
       updated_at = now(),
       notes      = coalesce(notes || ' ', '')
                    || '[RETIRADA 0061] AGPL-3.0: incompatible con un SaaS de codigo '
                    || 'cerrado. Ver ADR-014. Sustituida por la familia rf-detr.'
 WHERE framework_code = 'ultralytics'
   AND is_active;

-- El framework tambien, para que no aparezca como opcion.
UPDATE ai.frameworks
   SET is_active = false,
       notes     = coalesce(notes || ' ', '')
                   || '[RETIRADO 0061] AGPL-3.0. Ver ADR-014.'
 WHERE code = 'ultralytics'
   AND is_active;


-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_rfdetr   int;
    v_agpl_act int;
    v_fw       int;
    v_huerfano int;
    r          record;
BEGIN
    SELECT count(*) INTO v_rfdetr FROM ai.architectures
     WHERE framework_code = 'rfdetr' AND is_active;
    IF v_rfdetr <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 arquitecturas rf-detr activas, hay %', v_rfdetr;
    END IF;

    SELECT count(*) INTO v_agpl_act FROM ai.architectures
     WHERE framework_code = 'ultralytics' AND is_active;
    IF v_agpl_act <> 0 THEN
        RAISE EXCEPTION 'quedan % arquitecturas de ultralytics activas', v_agpl_act;
    END IF;

    SELECT count(*) INTO v_fw FROM ai.frameworks WHERE code = 'ultralytics' AND is_active;
    IF v_fw <> 0 THEN
        RAISE EXCEPTION 'el framework ultralytics sigue activo';
    END IF;

    -- Ninguna arquitectura de rf-detr puede declarar una tarea que no soporta: si
    -- alguna dijera `segment`, se podria crear un modelo que falla al entrenar y el
    -- trigger de validacion no lo veria venir.
    IF EXISTS (
        SELECT 1 FROM ai.architectures
         WHERE framework_code = 'rfdetr'
           AND NOT (supported_tasks = ARRAY['detect']::ai.task[])
    ) THEN
        RAISE EXCEPTION 'una arquitectura rf-detr declara tareas distintas de detect';
    END IF;

    -- Modelos que quedan apuntando a una arquitectura desactivada. NO es un error
    -- —desactivar existe justamente para eso— pero hay que decirlo en voz alta.
    SELECT count(*) INTO v_huerfano
      FROM ai.models m JOIN ai.architectures a ON a.code = m.architecture_code
     WHERE m.deleted_at IS NULL AND NOT a.is_active;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'arquitecturas rf-detr activas: %', v_rfdetr;
    FOR r IN SELECT code, min_images_recommended, approx_weights_mb
              FROM ai.architectures WHERE framework_code = 'rfdetr' ORDER BY approx_weights_mb LOOP
        RAISE NOTICE '  % | min_img=% | ~%MB', rpad(r.code,16), r.min_images_recommended, r.approx_weights_mb;
    END LOOP;
    RAISE NOTICE 'arquitecturas AGPL desactivadas: %',
        (SELECT count(*) FROM ai.architectures WHERE framework_code='ultralytics');

    IF v_huerfano > 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '⚠ % modelo(s) siguen apuntando a una arquitectura desactivada:', v_huerfano;
        FOR r IN SELECT m.name, m.task, m.architecture_code, p.slug AS proyecto
                  FROM ai.models m
                  JOIN ai.architectures a ON a.code = m.architecture_code
                  JOIN ai.projects p ON p.id = m.project_id
                 WHERE m.deleted_at IS NULL AND NOT a.is_active LOOP
            RAISE NOTICE '    % | task=% | arq=% | proyecto=%',
                rpad(r.name,14), rpad(r.task,8), rpad(r.architecture_code,10), r.proyecto;
        END LOOP;
        RAISE NOTICE '  No se repuntan automaticamente: cambiar la arquitectura de un';
        RAISE NOTICE '  modelo cambia su contrato, y RF-DETR no soporta `segment`.';
        RAISE NOTICE '  Es una decision del operador.';
    END IF;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'OK 0061: rf-detr disponible, ultralytics retirado, catalogo coherente';
END $$;
