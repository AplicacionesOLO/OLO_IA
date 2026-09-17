-- ═══════════════════════════════════════════════════════════════════════════
-- 0117_actualizacion_remota_modelo.sql
-- Crea      : core.fleet_model_path_ok(), bucket privado `fleet-models` + 4
--             politicas, core.tenant_fleet_model, core.fijar_modelo_flota()
-- Altera    : core.fleet_devices (current_model_version)
-- Depende de: 0045 (ai-assets), 0076 (perception-media, mismo patron de
--             politicas), 0077 (v_published_models trae los pesos), 0110
--             (fleet_devices), 0113 (tenant_quotas, mismo patron de funcion)
-- Riesgo     : medio -- bucket y tabla nuevos, sin lectores todavia.
--
-- Base de la #7 del plan de mejoras SaaS: llevar un modelo publicado a la
-- flota SIN reinstalar el APK ni copiar el archivo a mano en cada telefono.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA DE FONDO: DOS REGIMENES DE PERMISO QUE NO SE PUEDEN MEZCLAR
--
-- Los pesos de un modelo publicado viven en `ai-assets` (0045), cuyas cuatro
-- politicas EXIGEN `core.is_platform_owner()` -- correcto ahi, porque un
-- modelo entrenado es material de la PLATAFORMA, compartido entre operadores
-- (ver la cabecera de 0077). Un dispositivo de flota (rol `device`, 0111)
-- tiene solo `perception:ingest`/`drones:ingest` -- ni es, ni deberia ser,
-- platform owner.
--
-- La solucion NO es relajar `ai-assets` (eso destaparia el catalogo de
-- entrenamiento a cualquier telefono con una credencial de dispositivo) ni
-- dar `is_platform_owner` a un aparato de campo (una escalada real: un
-- telefono se puede perder o robar, un platform owner no). Es la MISMA
-- separacion que 0076 ya uso para el video: un bucket PROPIO, con su propia
-- ruta acotada por tenant, donde SI puede leer un miembro cualquiera del
-- tenant (dispositivo incluido).
--
-- "Publicar a la flota" es entonces un puente EXPLICITO, disparado por un
-- platform owner (que ya puede leer `ai-assets`), que copia los bytes UNA VEZ
-- a `fleet-models`. De ahi en adelante, cualquier dispositivo del tenant los
-- descarga con su propia credencial normal -- sin que nadie mas alla del
-- platform owner que publico haya tocado un permiso elevado.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── La ruta, y quien puede validarla ─────────────────────────────────────────
-- {tenant_id}/{model_version_id}/{nombre} -- tres segmentos, mismo criterio
-- que perception_media_path_ok (0076): el primero es el aislamiento real, y
-- no se confia en que el backend lo ponga bien.
CREATE OR REPLACE FUNCTION core.fleet_model_path_ok(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_partes text[] := string_to_array(coalesce(p_name, ''), '/');
    v_uuid   text   := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
    IF array_length(v_partes, 1) <> 3 THEN
        RETURN false;
    END IF;

    IF v_partes[1] !~ v_uuid OR v_partes[2] !~ v_uuid THEN
        RETURN false;
    END IF;

    IF v_partes[3] = '' OR v_partes[3] LIKE '%..%' THEN
        RETURN false;
    END IF;

    -- EL PRIMER SEGMENTO ES EL TENANT ACTUAL -- igual que 0076. Sin esto, un
    -- dispositivo del tenant A podria pedir una firma bajo el prefijo de B
    -- con solo cambiar el UUID.
    RETURN v_partes[1]::uuid IS NOT DISTINCT FROM core.current_tenant_id();
END;
$$;

COMMENT ON FUNCTION core.fleet_model_path_ok(text) IS
    'Valida {tenant}/{model_version}/{nombre} en el bucket fleet-models: el primer segmento tiene que ser el tenant actual. SECURITY DEFINER: authenticated no puede consultar core directamente.';

GRANT EXECUTE ON FUNCTION core.fleet_model_path_ok(text) TO authenticated, olo_app;


-- ── El bucket ──────────────────────────────────────────────────────────────
-- Privado, se lee con URL firmada (StorageClient.sign_download). 300 MiB de
-- tope: generoso para un ONNX/TFLite cuantizado (unos pocos MB en el S21
-- actual), sin acotar tanto que un modelo mas grande de mañana no quepa.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'fleet-models', 'fleet-models', false,
    314572800,
    ARRAY['application/octet-stream']
)
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- LECTURA: cualquier miembro autenticado del tenant (dispositivo incluido) --
-- la autoridad sobre QUIEN puede pedirla vive en la API (`drones:ingest`),
-- esto solo garantiza DONDE.
CREATE POLICY fleet_models_read ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'fleet-models'
        AND core.fleet_model_path_ok(name)
    );

-- ESCRITURA: ademas de la ruta, EXIGE platform owner -- a diferencia de
-- perception-media (0076), aqui si hace falta: el origen de estos bytes es
-- `ai-assets`, que ya exige platform owner para leerse, y "publicar a la
-- flota" hereda esa misma exigencia en el otro extremo de la copia.
CREATE POLICY fleet_models_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'fleet-models'
        AND core.fleet_model_path_ok(name)
        AND core.is_platform_owner()
    );

CREATE POLICY fleet_models_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'fleet-models'
        AND core.fleet_model_path_ok(name)
        AND core.is_platform_owner()
    )
    WITH CHECK (
        bucket_id = 'fleet-models'
        AND core.fleet_model_path_ok(name)
        AND core.is_platform_owner()
    );

CREATE POLICY fleet_models_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'fleet-models'
        AND core.fleet_model_path_ok(name)
        AND core.is_platform_owner()
    );


-- ── El puntero: que modelo le toca a la flota de este tenant ────────────────
-- Un modelo por TENANT, no por dispositivo: en la practica toda la flota de
-- un almacen corre la misma version. Asignar por dispositivo individual (para
-- probar un modelo nuevo en uno solo antes de soltarlo a todos) queda fuera
-- de este alcance -- se puede añadir despues sin romper esto, con una columna
-- opcional en fleet_devices que sobreescriba este valor.
CREATE TABLE core.tenant_fleet_model (
    tenant_id         UUID        PRIMARY KEY REFERENCES core.tenants(id),
    model_version_id  UUID        NOT NULL,
    -- Copiados de ai.model_versions/ai.models al momento de publicar, para
    -- que el barrido del dispositivo no tenga que unir contra `ai.*` --que
    -- ademas no tiene tenant_id, ver 0070/0077-- en cada consulta.
    architecture_code TEXT        NOT NULL,
    version_label     TEXT        NOT NULL,
    object_path       TEXT        NOT NULL,
    published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_by      UUID
);

COMMENT ON TABLE core.tenant_fleet_model IS
    'Que version de modelo le toca correr a la flota de un tenant (#7 del plan de mejoras SaaS). Se escribe SOLO via core.fijar_modelo_flota() -- igual que core.tenant_quotas (0113), esta tabla no tiene politica de escritura para authenticated/olo_app.';

ALTER TABLE core.tenant_fleet_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenant_fleet_model FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core.tenant_fleet_model
    AS RESTRICTIVE FOR ALL TO authenticated, olo_app
    USING      (tenant_id = core.current_tenant_id())
    WITH CHECK (tenant_id = core.current_tenant_id());

-- Solo LECTURA para el propio tenant -- la escritura pasa por la funcion,
-- nunca por esta politica (RESTRICTIVE + ninguna PERMISSIVE de escritura =
-- ninguna escritura posible por este camino). Mismo criterio que 0113.
CREATE POLICY fleet_model_read ON core.tenant_fleet_model
    AS PERMISSIVE FOR SELECT TO authenticated, olo_app
    USING (tenant_id = core.current_tenant_id());

GRANT SELECT ON TABLE core.tenant_fleet_model TO authenticated, olo_app;

-- ── La unica escritura posible ───────────────────────────────────────────
CREATE FUNCTION core.fijar_modelo_flota(
    p_tenant_id         uuid,
    p_model_version_id  uuid,
    p_architecture_code text,
    p_version_label     text,
    p_object_path       text
)
RETURNS TABLE (
    out_tenant_id         uuid,
    out_model_version_id  uuid,
    out_architecture_code text,
    out_version_label     text,
    out_object_path       text,
    out_published_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := core.current_user_id();
BEGIN
    -- Publicar a la flota de OTRO tenant es una escritura en el tenant de
    -- otro -- mismo motivo que core.fijar_cuota_tenant (0113): un platform
    -- owner gestionando el modelo de un cliente, no el suyo propio.
    IF NOT core.is_platform_owner() THEN
        RAISE EXCEPTION 'Solo un platform owner puede publicar un modelo a la flota' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM core.tenants t WHERE t.id = p_tenant_id) THEN
        RAISE EXCEPTION 'Tenant % no encontrado', p_tenant_id USING ERRCODE = '23503';
    END IF;

    RETURN QUERY
    INSERT INTO core.tenant_fleet_model
        (tenant_id, model_version_id, architecture_code, version_label, object_path, published_by)
    VALUES
        (p_tenant_id, p_model_version_id, p_architecture_code, p_version_label, p_object_path, v_actor)
    ON CONFLICT (tenant_id) DO UPDATE SET
        model_version_id  = EXCLUDED.model_version_id,
        architecture_code = EXCLUDED.architecture_code,
        version_label     = EXCLUDED.version_label,
        object_path       = EXCLUDED.object_path,
        published_at      = now(),
        published_by      = EXCLUDED.published_by
    RETURNING tenant_id, model_version_id, architecture_code, version_label, object_path, published_at;
END;
$$;

COMMENT ON FUNCTION core.fijar_modelo_flota(uuid, uuid, text, text, text) IS
    'Unico camino de escritura de core.tenant_fleet_model. Comprueba is_platform_owner() por su cuenta -- mismo patron que core.fijar_cuota_tenant (0113).';

REVOKE ALL ON FUNCTION core.fijar_modelo_flota(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.fijar_modelo_flota(uuid, uuid, text, text, text) TO olo_app;


-- ── Que trae instalado cada dispositivo, para verlo en Flota ────────────────
-- Informativo -- ver la cabecera de arriba: la decision de si hace falta
-- actualizar la toma el propio dispositivo comparando esto contra
-- tenant_fleet_model, no el backend comparando por el. NO se usa para
-- autorizar ni para decidir nada, solo para que la pantalla de Flota pueda
-- decir "3 de 5 al dia" de un vistazo -- mismo espiritu que app_version.
ALTER TABLE core.fleet_devices
    ADD COLUMN IF NOT EXISTS current_model_version TEXT;

COMMENT ON COLUMN core.fleet_devices.current_model_version IS
    'Version del modelo que el dispositivo dice tener cargada ahora mismo (0117, #7 del plan de mejoras SaaS). Informativo -- el propio dispositivo decide si actualizar comparando esto contra GET /v1/fleet/model, el backend no lo hace por el.';


-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
DECLARE v_pol int;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'fleet-models' AND NOT public
    ) THEN
        RAISE EXCEPTION 'el bucket fleet-models debe existir y ser privado';
    END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname LIKE 'fleet\_models\_%';
    IF v_pol <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 politicas de fleet-models, hay %', v_pol;
    END IF;

    IF core.fleet_model_path_ok(
        '11111111-1111-1111-1111-111111111111/'
        '22222222-2222-2222-2222-222222222222/pesos.onnx'
    ) THEN
        RAISE EXCEPTION 'una ruta de otro tenant no puede validar (sin sesion, current_tenant_id() es NULL)';
    END IF;

    IF core.fleet_model_path_ok('solo/dos') THEN
        RAISE EXCEPTION 'dos segmentos no es una ruta valida';
    END IF;

    IF to_regprocedure('core.fijar_modelo_flota(uuid,uuid,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'fijar_modelo_flota no se creo';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'fleet_devices'
           AND column_name = 'current_model_version'
    ) THEN
        RAISE EXCEPTION 'falta core.fleet_devices.current_model_version';
    END IF;

    RAISE NOTICE '0117 OK - bucket fleet-models, tenant_fleet_model, fijar_modelo_flota() y current_model_version listos.';
END $$;
