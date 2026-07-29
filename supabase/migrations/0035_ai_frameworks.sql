-- ═══════════════════════════════════════════════════════════════════════════
-- 0035_ai_frameworks.sql
-- Crea     : ai.frameworks + políticas RLS + 6 filas
-- Depende de: 0031 (schema ai), 0010 (core.users), 0005 (core.set_updated_at)
-- Riesgo   : bajo
--
-- ⚠ `adapter` ES LA COLUMNA QUE SOSTIENE LA AGNOSTICIDAD.
--
--   El worker despacha por FRAMEWORK, no por arquitectura. Los adaptadores son
--   pocos y estables —ultralytics, torch, onnx—; las arquitecturas son muchas y
--   crecen cada mes. Sin esta columna el worker acabaría con un `elif` por
--   arquitectura, que es exactamente la refactorización que este bloque evita.
--
--   Añadir YOLO12 o Qwen-VL no debe tocar el worker: es una fila en
--   ai.architectures apuntando a un adaptador que ya existe.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ai.frameworks (
    code          varchar(30)  PRIMARY KEY,
    display_name  varchar(60)  NOT NULL,
    adapter       varchar(40)  NOT NULL,
    is_active     boolean      NOT NULL DEFAULT true,
    notes         text         NULL,

    created_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    updated_by    uuid         NULL REFERENCES core.users(id) ON DELETE SET NULL,

    CONSTRAINT chk_fw_code    CHECK (code ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT chk_fw_adapter CHECK (adapter ~ '^[a-z][a-z0-9_.]*$')
);

COMMENT ON TABLE ai.frameworks IS
    'Frameworks de entrenamiento e inferencia. Catalogo de datos: anadir uno es una fila, no un despliegue.';
COMMENT ON COLUMN ai.frameworks.adapter IS
    'Modulo del worker que sabe invocar este framework. El worker despacha por AQUI, nunca por arquitectura.';

CREATE TRIGGER trg_fw_updated_at
    BEFORE UPDATE ON ai.frameworks
    FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE ai.frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.frameworks FORCE ROW LEVEL SECURITY;

CREATE POLICY fw_platform_only ON ai.frameworks
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
CREATE POLICY fw_read ON ai.frameworks
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY fw_insert ON ai.frameworks
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY fw_update ON ai.frameworks
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);


-- ── Siembra ────────────────────────────────────────────────────────────────
INSERT INTO ai.frameworks (code, display_name, adapter, notes) VALUES
    ('ultralytics', 'Ultralytics',  'ultralytics',
     'YOLO y RT-DETR. Primer adaptador que se implementara, en el Bloque 4.'),
    ('pytorch',     'PyTorch',      'torch',
     'SAM2, Grounding DINO, Florence, CLIP. Pesos .pt o .safetensors.'),
    ('tensorflow',  'TensorFlow',   'tensorflow',
     'Sin adaptador todavia. Registrado para no bloquear un modelo heredado.'),
    ('openmmlab',   'OpenMMLab',    'openmmlab',
     'MMDetection y MMSegmentation. Sin adaptador todavia.'),
    ('onnx',        'ONNX Runtime', 'onnx',
     'Solo inferencia: no entrena. Destino habitual de la exportacion.'),
    ('custom',      'Personalizado','custom',
     'Modelos propios. Cada modelo declara sus detalles en ai.models.config.')
ON CONFLICT (code) DO NOTHING;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_filas int;
    v_pol   int;
    v_force boolean;
BEGIN
    SELECT count(1) INTO v_filas FROM ai.frameworks;
    IF v_filas <> 6 THEN RAISE EXCEPTION 'se esperaban 6 frameworks, hay %', v_filas; END IF;

    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relname = 'frameworks';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'ai' AND tablename = 'frameworks';
    IF v_pol <> 4 THEN RAISE EXCEPTION 'se esperaban 4 políticas, hay %', v_pol; END IF;

    -- Los default privileges de 0031 deben haberse aplicado a esta tabla nueva.
    IF NOT has_table_privilege('olo_app', 'ai.frameworks', 'SELECT') THEN
        RAISE EXCEPTION 'olo_app sin SELECT: los default privileges de 0031 no se aplicaron';
    END IF;

    RAISE NOTICE 'OK 0035: 6 frameworks, RLS forzada, 4 politicas, privilegios heredados de 0031';
END
$$;
