-- ═══════════════════════════════════════════════════════════════════════════
-- 0039_ai_model_classes.sql
-- Crea     : ai.model_classes, ai.prevent_training_index_change() + trigger,
--            políticas RLS
-- Depende de: 0038 (model_versions), 0037 (models), 0033 (ai.classes)
-- Riesgo   : bajo
--
-- ESTA TABLA ES LO QUE HACE POSIBLE LA DECISIÓN 6.
--
--   `Detector YOLO` y `Detector RT-DETR` declaran el MISMO subconjunto de clases
--   del proyecto y comparten imágenes y anotaciones sin copiar nada. Comparar dos
--   arquitecturas sobre los mismos datos —el experimento más común de todo el
--   aprendizaje automático— no cuesta ni una anotación adicional.
--
--   `Detector de daños` declara otro subconjunto —roto, mojado— sobre las mismas
--   imágenes.
--
-- ⚠ DOS ÍNDICES CON PROPÓSITOS DISTINTOS, Y CONVIENE NO CONFUNDIRLOS.
--
--   `classes.class_index`         → identidad estable de la clase en el PROYECTO.
--                                   Inmutable desde 0026. Nunca se reutiliza.
--   `model_classes.training_index`→ índice contiguo 0..N-1 que verán los pesos de
--                                   ESE modelo. Es lo que YOLO escribe en el .pt.
--
--   Un proyecto puede tener las clases 0..9 y un modelo declarar solo la 3 y la 7,
--   que para él son `training_index` 0 y 1. Sin esta separación, el detector de
--   daños heredaría índices 3 y 7 y el framework esperaría diez clases donde hay
--   dos.
--
--   `training_index` hereda la regla de inmutabilidad de `class_index` por la
--   misma razón: los pesos guardan índices, no nombres, y renumerar hace que el
--   modelo devuelva la etiqueta equivocada SIN PRODUCIR NINGÚN ERROR.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE ai.model_classes (
    model_id        uuid     NOT NULL,
    class_id        uuid     NOT NULL,
    project_id      uuid     NOT NULL,
    training_index  smallint NOT NULL,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid        NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,

    PRIMARY KEY (model_id, class_id),

    -- FK compuestas: el modelo y la clase deben ser del MISMO proyecto. Es lo que
    -- impide que el detector de daños declare una clase de otro proyecto.
    CONSTRAINT fk_mc_model FOREIGN KEY (project_id, model_id)
        REFERENCES ai.models (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_mc_class FOREIGN KEY (project_id, class_id)
        REFERENCES ai.classes (project_id, id) ON DELETE RESTRICT,

    -- El índice de entrenamiento es único DENTRO del modelo, no del proyecto.
    CONSTRAINT uq_mc_indice UNIQUE (model_id, training_index),
    CONSTRAINT chk_mc_indice CHECK (training_index >= 0)
);

COMMENT ON TABLE ai.model_classes IS
    'Vocabulario de cada modelo: subconjunto de las clases del proyecto con su indice de entrenamiento. Permite que varios modelos compartan imagenes y anotaciones sin copiarlas.';
COMMENT ON COLUMN ai.model_classes.training_index IS
    'Indice contiguo 0..N-1 que verán los pesos de ESTE modelo. Distinto de classes.class_index, que es identidad de proyecto.';

CREATE INDEX idx_mc_clase ON ai.model_classes (class_id);
CREATE INDEX idx_mc_modelo_orden ON ai.model_classes (model_id, training_index);


-- ── Inmutabilidad del índice de entrenamiento ──────────────────────────────
CREATE OR REPLACE FUNCTION ai.prevent_training_index_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_versiones int;
    v_modelo    uuid;
BEGIN
    v_modelo := COALESCE(NEW.model_id, OLD.model_id);

    SELECT count(1) INTO v_versiones
      FROM ai.model_versions
     WHERE model_id = v_modelo AND deleted_at IS NULL;

    IF v_versiones = 0 THEN
        -- Sin pesos registrados no hay nada que pueda malinterpretarse: el
        -- vocabulario aún se está definiendo y debe poder reordenarse.
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'el modelo ya tiene % version(es) registradas: no se puede retirar una '
            'clase de su vocabulario. Los pesos existentes esperan % clases.',
            v_versiones, (SELECT count(1) FROM ai.model_classes WHERE model_id = v_modelo)
            USING ERRCODE = 'raise_exception';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.training_index IS DISTINCT FROM OLD.training_index THEN
        RAISE EXCEPTION
            'training_index es inmutable con versiones existentes (% -> %). Los pesos '
            'guardan indices, no nombres: renumerar hace que el modelo devuelva la '
            'etiqueta equivocada sin producir ningun error.',
            OLD.training_index, NEW.training_index
            USING ERRCODE = 'raise_exception';
    END IF;

    IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION
            'el modelo ya tiene % version(es) registradas: no se puede anadir una '
            'clase a su vocabulario. Crea una version nueva del modelo.', v_versiones
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN COALESCE(NEW, OLD);
END
$$;

COMMENT ON FUNCTION ai.prevent_training_index_change() IS
    'Congela el vocabulario de un modelo en cuanto existen pesos. Antes de eso deja reordenarlo libremente.';

CREATE TRIGGER trg_mc_inmutable
    BEFORE INSERT OR UPDATE OR DELETE ON ai.model_classes
    FOR EACH ROW EXECUTE FUNCTION ai.prevent_training_index_change();


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE ai.model_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.model_classes FORCE ROW LEVEL SECURITY;

CREATE POLICY mc_platform_only ON ai.model_classes
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING (core.is_platform_owner()) WITH CHECK (core.is_platform_owner());
CREATE POLICY mc_read ON ai.model_classes
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app USING (true);
CREATE POLICY mc_insert ON ai.model_classes
    AS PERMISSIVE FOR INSERT TO authenticated, olo_app WITH CHECK (true);
CREATE POLICY mc_update ON ai.model_classes
    AS PERMISSIVE FOR UPDATE TO authenticated, olo_app USING (true) WITH CHECK (true);
CREATE POLICY mc_delete ON ai.model_classes
    AS PERMISSIVE FOR DELETE TO authenticated, olo_app USING (true);


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol    int;
    v_force  boolean;
    v_owner  uuid;
    v_proj   uuid;
    v_m1     uuid;
    v_m2     uuid;
    v_c1     uuid;
    v_c2     uuid;
    v_asset  uuid;
    v_ok     int := 0;
    v_compartidas int;
BEGIN
    SELECT c.relforcerowsecurity INTO v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ai' AND c.relname = 'model_classes';
    IF NOT v_force THEN RAISE EXCEPTION 'falta FORCE ROW LEVEL SECURITY'; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'ai' AND tablename = 'model_classes';
    IF v_pol <> 5 THEN RAISE EXCEPTION 'se esperaban 5 políticas, hay %', v_pol; END IF;

    SELECT id INTO v_owner FROM core.users
     WHERE email = 'arojas@ologistics.com' AND deleted_at IS NULL;
    IF v_owner IS NULL THEN
        RAISE NOTICE 'AVISO: sin usuario owner, se omiten las pruebas vivas';
        RETURN;
    END IF;

    INSERT INTO ai.projects (name, slug, created_by)
    VALUES ('Verif 0039', 'verif-0039', v_owner) RETURNING id INTO v_proj;

    INSERT INTO ai.classes (project_id, name, class_index, color, created_by)
    VALUES (v_proj, 'pallet', 0, '#FF0000', v_owner) RETURNING id INTO v_c1;
    INSERT INTO ai.classes (project_id, name, class_index, color, created_by)
    VALUES (v_proj, 'caja', 1, '#00FF00', v_owner) RETURNING id INTO v_c2;

    -- Dos modelos, dos arquitecturas, MISMO proyecto: es el caso de la decisión 6.
    INSERT INTO ai.models (project_id, name, slug, framework_code, architecture_code,
                           task, input_type, requires_training, created_by)
    VALUES (v_proj, 'Detector YOLO', 'det-yolo', 'ultralytics', 'yolo11m',
            'detect', 'image', true, v_owner) RETURNING id INTO v_m1;
    INSERT INTO ai.models (project_id, name, slug, framework_code, architecture_code,
                           task, input_type, requires_training, created_by)
    VALUES (v_proj, 'Detector RT-DETR', 'det-rtdetr', 'ultralytics', 'rtdetr-l',
            'detect', 'image', true, v_owner) RETURNING id INTO v_m2;
    v_ok := v_ok + 1;

    -- 1 · Los dos declaran las MISMAS clases: comparten vocabulario sin copiarlo
    INSERT INTO ai.model_classes (model_id, class_id, project_id, training_index, created_by)
    VALUES (v_m1, v_c1, v_proj, 0, v_owner),
           (v_m1, v_c2, v_proj, 1, v_owner),
           (v_m2, v_c1, v_proj, 0, v_owner),
           (v_m2, v_c2, v_proj, 1, v_owner);

    SELECT count(DISTINCT class_id) INTO v_compartidas
      FROM ai.model_classes WHERE project_id = v_proj;
    IF v_compartidas <> 2 THEN
        RAISE EXCEPTION 'los dos modelos debian compartir 2 clases, comparten %', v_compartidas;
    END IF;
    v_ok := v_ok + 1;

    -- 2 · training_index duplicado dentro de un modelo: rechazado
    BEGIN
        INSERT INTO ai.model_classes (model_id, class_id, project_id, training_index, created_by)
        VALUES (v_m1, v_c1, v_proj, 5, v_owner);
        RAISE EXCEPTION 'se acepto una clase duplicada en el modelo';
    EXCEPTION WHEN unique_violation THEN
        v_ok := v_ok + 1;
    END;

    -- 3 · Sin versiones, el vocabulario SÍ se puede reordenar
    UPDATE ai.model_classes SET training_index = 9
     WHERE model_id = v_m1 AND class_id = v_c2;
    UPDATE ai.model_classes SET training_index = 1
     WHERE model_id = v_m1 AND class_id = v_c2;
    v_ok := v_ok + 1;

    -- 4 · Con una versión registrada, queda congelado
    INSERT INTO ai.assets (project_id, kind, bucket, object_path, original_filename,
                           content_type, bytes, sha256, created_by)
    VALUES (v_proj, 'weights', 'ai-weights', 'verif/0039/best.pt', 'best.pt',
            'application/octet-stream', 2048, repeat('e', 64), v_owner)
    RETURNING id INTO v_asset;

    INSERT INTO ai.model_versions (project_id, model_id, version, origin,
                                   weights_asset_id, source_reference, created_by)
    VALUES (v_proj, v_m1, 1, 'imported', v_asset, 'pesos de verificacion', v_owner);

    BEGIN
        UPDATE ai.model_classes SET training_index = 4
         WHERE model_id = v_m1 AND class_id = v_c2;
        RAISE EXCEPTION 'se permitio renumerar el vocabulario con versiones existentes';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%training_index es inmutable%' THEN v_ok := v_ok + 1;
        ELSE RAISE; END IF;
    END;

    -- 5 · Y tampoco se puede retirar una clase
    BEGIN
        DELETE FROM ai.model_classes WHERE model_id = v_m1 AND class_id = v_c2;
        RAISE EXCEPTION 'se permitio retirar una clase con versiones existentes';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%no se puede retirar%' THEN v_ok := v_ok + 1;
        ELSE RAISE; END IF;
    END;

    -- Limpieza: se desactiva el trigger, que si no impide retirar el testigo.
    ALTER TABLE ai.model_classes DISABLE TRIGGER trg_mc_inmutable;
    DELETE FROM ai.model_classes  WHERE project_id = v_proj;
    ALTER TABLE ai.model_classes ENABLE TRIGGER trg_mc_inmutable;
    DELETE FROM ai.model_versions WHERE project_id = v_proj;
    DELETE FROM ai.models         WHERE project_id = v_proj;
    DELETE FROM ai.assets         WHERE project_id = v_proj;
    DELETE FROM ai.classes        WHERE project_id = v_proj;
    DELETE FROM ai.projects       WHERE id = v_proj;

    IF v_ok <> 6 THEN RAISE EXCEPTION 'solo % de 6 comprobaciones vivas pasaron', v_ok; END IF;

    RAISE NOTICE
        'OK 0039: RLS forzada, 5 politicas, verificado en vivo: 2 modelos comparten vocabulario, indice unico por modelo, reordenable sin versiones, congelado con versiones';
END
$$;
