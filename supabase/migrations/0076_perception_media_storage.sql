-- ══════════════════════════════════════════════════════════════════════════════
-- 0076 · Los bytes del vídeo. Hasta ahora nunca salían del navegador.
--
-- Crea : core.perception_media_path_ok() + bucket privado `perception-media`
--        + 4 políticas RLS sobre storage.objects
--
-- ═══════════════════════════════════════════════════════════════════════════
-- EL AGUJERO QUE ESTO TAPA
--
-- «Nueva inspección» pedía un archivo, lo medía, calculaba su SHA-256 en el navegador
-- y mandaba METADATOS: nombre, tipo, tamaño, hash, dimensiones. Los bytes se quedaban
-- en la pestaña y se perdían al cerrarla.
--
-- 0069 lo dejó dicho —«NO hay almacenamiento de medios, `bucket`/`object_path` se
-- guardan para cuando exista la subida»— y era coherente mientras no hubiera worker:
-- un vídeo subido que nadie va a procesar son 400 MB pagados por nada.
--
-- Ahora hay worker (`tools/inferir.py`), y un worker no puede analizar un vídeo que
-- no existe. Esta migración es el eslabón que faltaba entre los dos.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BUCKET PROPIO, Y NO `ai-assets`
--
-- Podría reutilizarse. No debe, y el motivo está en las políticas de 0045: las cuatro
-- de `ai-assets` exigen `core.is_platform_owner()`. Es correcto allí —un dataset de
-- entrenamiento es material de la PLATAFORMA, compartido entre operadores— y es
-- exactamente lo contrario de lo que hace falta aquí.
--
-- Un vídeo del pasillo es del OPERADOR. Lo graba su drone, en su almacén, y lo tiene
-- que poder subir su jefe de turno, que no es owner de la plataforma. Metiéndolo en
-- `ai-assets` habría dos opciones y las dos malas: dar `is_platform_owner` a quien
-- sube vídeos —una escalada—, o relajar las políticas de `ai-assets` y con ellas el
-- aislamiento de los datos de entrenamiento.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LA RUTA ES LA FRONTERA, Y LA COMPRUEBA LA BASE
--
--     {tenant_id}/{warehouse_id}/{media_id}/{nombre}
--
-- Los dos primeros segmentos son el aislamiento, y no se confía en que el backend los
-- ponga bien: `core.perception_media_path_ok()` exige que el primero sea el tenant
-- ACTUAL y que el segundo sea un almacén al que este usuario tiene acceso. Una URL
-- firmada funciona sin sesión, así que el momento de comprobar quién puede escribir
-- dónde es antes de emitirla, no después.
--
-- Es el mismo razonamiento de 0045 con `ai_asset_path_ok`, con dos diferencias: aquí
-- el primer segmento es un tenant y no un proyecto, y hay un segundo nivel —el
-- almacén— porque el acceso en este sistema se acota por almacén, no solo por tenant.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION core.perception_media_path_ok(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
-- SECURITY DEFINER por lo mismo que `ai_asset_path_ok`: el rol `authenticated` que
-- ejecuta la política de storage no tiene USAGE sobre los esquemas que hay que
-- consultar para responder.
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_partes text[] := string_to_array(coalesce(p_name, ''), '/');
    v_uuid   text   := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
    -- Cuatro segmentos exactos. Ni tres —faltaría un nivel— ni cinco: con más, un
    -- `a/b/c/d/../../otro` navegaría fuera de su prefijo.
    IF array_length(v_partes, 1) <> 4 THEN
        RETURN false;
    END IF;

    IF v_partes[1] !~ v_uuid OR v_partes[2] !~ v_uuid OR v_partes[3] !~ v_uuid THEN
        RETURN false;
    END IF;

    -- El nombre no puede estar vacío ni contener `..`: el primero dejaría una ruta
    -- terminada en `/` y el segundo es el que permite salir del prefijo.
    IF v_partes[4] = '' OR v_partes[4] LIKE '%..%' THEN
        RETURN false;
    END IF;

    -- EL PRIMER SEGMENTO ES EL TENANT ACTUAL. Aquí está el aislamiento: sin esta
    -- comprobación, un usuario del operador A podría pedir una firma para escribir
    -- bajo el prefijo del operador B con solo cambiar el UUID.
    IF v_partes[1]::uuid IS DISTINCT FROM core.current_tenant_id() THEN
        RETURN false;
    END IF;

    -- Y EL SEGUNDO ES UN ALMACÉN SUYO. Se usa la función del motor y no una consulta
    -- propia para que el acceso se resuelva EXACTAMENTE igual que en el resto del
    -- sistema: dos criterios de «puede ver este almacén» se separan.
    RETURN core.can_access_warehouse(v_partes[2]::uuid);
END;
$$;

COMMENT ON FUNCTION core.perception_media_path_ok(text) IS
    'Valida {tenant}/{warehouse}/{media}/{nombre} y que los dos primeros sean del usuario actual. SECURITY DEFINER: `authenticated` no puede consultar core directamente.';

GRANT EXECUTE ON FUNCTION core.perception_media_path_ok(text) TO authenticated, olo_app;


-- ── El bucket ──────────────────────────────────────────────────────────────
--
-- Privado. Se lee con URL firmada de vida corta, que es lo que `sign_download` emite.
--
-- 2 GiB de tope: lo impone el vídeo. Un vuelo de inspección de diez minutos en 4K
-- pasa de 1 GB sin esfuerzo, y un tope que rechaza el material real convertiría el
-- módulo en una demo.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'perception-media', 'perception-media', false,
    2147483648,
    ARRAY[
        'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/webm', 'video/quicktime',
        -- Lo que manda un DJI: MOV y MP4 según el modelo, y a veces el navegador no
        -- reconoce el tipo y envía `octet-stream`. Rechazarlo obligaría al operador a
        -- renombrar archivos para poder subir su propio vuelo.
        'application/octet-stream'
    ]
)
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── Las políticas ──────────────────────────────────────────────────────────
--
-- Cuatro, y ninguna menciona a `platform.owners`: quien opera el almacén sube y lee
-- sus propios vídeos. La autoridad sobre QUIÉN puede hacerlo vive en la API
-- —`perception:write` para subir— y lo que estas políticas garantizan es DÓNDE.
CREATE POLICY perception_media_read ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'perception-media'
        AND core.perception_media_path_ok(name)
    );

CREATE POLICY perception_media_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'perception-media'
        AND core.perception_media_path_ok(name)
    );

CREATE POLICY perception_media_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'perception-media'
        AND core.perception_media_path_ok(name)
    )
    WITH CHECK (
        bucket_id = 'perception-media'
        AND core.perception_media_path_ok(name)
    );

CREATE POLICY perception_media_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'perception-media'
        AND core.perception_media_path_ok(name)
    );


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol     int;
    v_definer boolean;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'perception-media' AND NOT public
    ) THEN
        RAISE EXCEPTION 'el bucket perception-media debe existir y ser privado';
    END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname LIKE 'perception\_media\_%';
    IF v_pol <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 politicas de perception-media, hay %', v_pol;
    END IF;

    SELECT p.prosecdef INTO v_definer
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'perception_media_path_ok';
    IF NOT coalesce(v_definer, false) THEN
        RAISE EXCEPTION 'core.perception_media_path_ok() debe ser SECURITY DEFINER';
    END IF;

    -- Rutas que TIENEN que fallar. Sin contexto de sesión —que es el caso aquí, esto
    -- corre como superusuario— `current_tenant_id()` es NULL, así que la función debe
    -- rechazar incluso una ruta bien formada. Es la comprobación que demuestra que el
    -- aislamiento no depende de que el backend ponga bien los segmentos.
    IF core.perception_media_path_ok(
        '11111111-1111-1111-1111-111111111111/'
        '22222222-2222-2222-2222-222222222222/'
        '33333333-3333-3333-3333-333333333333/v.mp4'
    ) THEN
        RAISE EXCEPTION 'una ruta de otro tenant no puede validar';
    END IF;

    IF core.perception_media_path_ok('solo/tres/segmentos') THEN
        RAISE EXCEPTION 'tres segmentos no es una ruta valida';
    END IF;

    RAISE NOTICE '0076 OK · bucket perception-media privado, 4 politicas, ruta acotada a tenant y almacen';
END $$;
