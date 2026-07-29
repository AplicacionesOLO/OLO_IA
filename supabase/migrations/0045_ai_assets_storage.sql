-- ═══════════════════════════════════════════════════════════════════════════
-- 0045_ai_assets_storage.sql
-- Crea     : core.ai_asset_path_ok() + bucket privado `ai-assets`
--            + 4 políticas RLS sobre storage.objects
-- Depende de: 0006 (GRANT USAGE ON SCHEMA core TO authenticated),
--             0020 (core.is_platform_owner), 0025 (ai.projects)
-- Estado   : APLICADA Y VERIFICADA (ciclo aplicar → rollback → reaplicar)
--
-- EL ROLLBACK NO ELIMINA EL BUCKET. Verificado: Supabase rechaza el borrado directo
-- sobre las tablas de storage («Direct deletion from storage tables is not allowed»)
-- y ese rechazo abortaba la transacción completa. El rollback quita las políticas y
-- la función; sin política, RLS deniega todo y el bucket queda inaccesible.
--
-- UN SOLO BUCKET con prefijos por proyecto. Cinco buckets separados solo se
-- justificarían con políticas de acceso o retención distintas, y aquí todas las
-- carpetas comparten régimen: privadas y de Platform Owner.
--
--     ai-assets/{project_id}/{kind}/{asset_id}/{filename_sanitizado}
--
-- Sin `service_role` (vacía por decisión del proyecto), el cliente sube DIRECTO a
-- Storage con su propio JWT y estas políticas son la ÚNICA autorización. El backend
-- posee la ruta canónica y el metadato, no el binario.
--
-- POR QUÉ UNA FUNCIÓN Y NO UN `EXISTS` EN LA POLÍTICA
--   La política se evalúa como `authenticated`, y ese rol tiene USAGE sobre `core`
--   (0006) pero NO sobre `ai`. Un `EXISTS (SELECT 1 FROM ai.projects ...)` escrito
--   directamente en el `WITH CHECK` no falla al crear la política —el cuerpo no se
--   resuelve hasta la primera fila— sino en cada subida, con
--   «permission denied for schema ai». La subida entera queda inutilizable.
--   SECURITY DEFINER lo resuelve sin abrir el schema: `postgres` tiene BYPASSRLS,
--   así que la lectura interna no evalúa políticas ni topa con el
--   FORCE ROW LEVEL SECURITY de ai.projects.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── La ruta como invariante comprobable ────────────────────────────────────
--
-- Comprobar solo `is_platform_owner()` deja el prefijo libre: el owner podría
-- escribir en cualquier ruta del bucket y dejar objetos que ningún proyecto
-- reclama y que ninguna consulta encuentra. El aislamiento por proyecto vive en
-- la ruta, así que la ruta tiene que ser un invariante y no una convención.
CREATE OR REPLACE FUNCTION core.ai_asset_path_ok(
    p_name         text,
    p_require_live boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_partes text[] := string_to_array(coalesce(p_name, ''), '/');
    v_uuid   text   := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    v_pid    uuid;
BEGIN
    -- Exactamente 4 segmentos: nada más plano ni más profundo.
    IF array_length(v_partes, 1) IS DISTINCT FROM 4 THEN
        RETURN false;
    END IF;

    -- Segmentos 1 y 3: UUID canónico en minúsculas. Cierra el paso a '..' y a
    -- cualquier nombre que no sea un identificador que el backend haya emitido.
    IF v_partes[1] !~ v_uuid OR v_partes[3] !~ v_uuid THEN
        RETURN false;
    END IF;

    -- Segmento 2: vocabulario cerrado. Los seis primeros son `ai.AssetKind`; los
    -- dos últimos quedan reservados para las versiones de dataset y la
    -- exportación, que aún no escriben.
    IF v_partes[2] NOT IN (
        'image', 'video', 'frame', 'thumbnail', 'weights', 'run_artifact',
        'datasets', 'exports'
    ) THEN
        RETURN false;
    END IF;

    -- Segmento 4: nombre de archivo, nunca vacío ni un salto de directorio.
    IF v_partes[4] = '' OR v_partes[4] IN ('.', '..') OR v_partes[4] LIKE '%..%' THEN
        RETURN false;
    END IF;

    v_pid := v_partes[1]::uuid;

    -- Escribir exige un proyecto VIVO. Leer y borrar, no: si se exigiera, los
    -- binarios de un proyecto archivado quedarían ilegibles e imposibles de
    -- limpiar, que es justo cuando hay que limpiarlos.
    IF p_require_live THEN
        RETURN EXISTS (
            SELECT 1 FROM ai.projects p
             WHERE p.id = v_pid AND p.deleted_at IS NULL
        );
    END IF;

    RETURN EXISTS (SELECT 1 FROM ai.projects p WHERE p.id = v_pid);
END
$$;

COMMENT ON FUNCTION core.ai_asset_path_ok(text, boolean) IS
    'Valida la forma de una ruta de ai-assets y que su primer segmento sea un proyecto. SECURITY DEFINER porque `authenticated` no tiene USAGE sobre el schema ai.';

GRANT EXECUTE ON FUNCTION core.ai_asset_path_ok(text, boolean) TO authenticated, olo_app;


-- ── El bucket ──────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'ai-assets', 'ai-assets', false,
    2147483648,   -- 2 GiB: el tope lo impone el vídeo, no la imagen
    ARRAY[
        'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/quicktime', 'video/x-msvideo',
        'application/octet-stream',              -- .pt, .pth
        'application/zip', 'text/csv', 'application/json'
    ]
)
ON CONFLICT (id) DO UPDATE
   SET public = false,
       file_size_limit = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── Las políticas ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS ai_assets_read   ON storage.objects;
DROP POLICY IF EXISTS ai_assets_write  ON storage.objects;
DROP POLICY IF EXISTS ai_assets_update ON storage.objects;
DROP POLICY IF EXISTS ai_assets_delete ON storage.objects;

CREATE POLICY ai_assets_read ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'ai-assets'
        AND core.is_platform_owner()
        AND core.ai_asset_path_ok(name, false)
    );

CREATE POLICY ai_assets_write ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'ai-assets'
        AND core.is_platform_owner()
        AND core.ai_asset_path_ok(name, true)
    );

CREATE POLICY ai_assets_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'ai-assets'
        AND core.is_platform_owner()
        AND core.ai_asset_path_ok(name, true)
    )
    WITH CHECK (
        bucket_id = 'ai-assets'
        AND core.is_platform_owner()
        AND core.ai_asset_path_ok(name, true)
    );

CREATE POLICY ai_assets_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'ai-assets'
        AND core.is_platform_owner()
        AND core.ai_asset_path_ok(name, false)
    );


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_pol      int;
    v_definer  boolean;
    v_proyecto uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'ai-assets' AND NOT public
    ) THEN
        RAISE EXCEPTION 'el bucket ai-assets debe existir y ser privado';
    END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname LIKE 'ai\_assets\_%';
    IF v_pol <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 políticas de ai-assets, hay %', v_pol;
    END IF;

    SELECT p.prosecdef INTO v_definer
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'core' AND p.proname = 'ai_asset_path_ok';
    IF NOT coalesce(v_definer, false) THEN
        RAISE EXCEPTION 'core.ai_asset_path_ok() debe ser SECURITY DEFINER';
    END IF;

    -- La forma se rechaza SIN consultar ai.projects: estas cuatro devuelven false
    -- por estructura, y son exactamente los intentos que hay que impedir.
    IF core.ai_asset_path_ok('cualquiera/image/x/f.jpg', false) THEN
        RAISE EXCEPTION 'un primer segmento que no es UUID debe rechazarse';
    END IF;
    IF core.ai_asset_path_ok(
        '00000000-0000-0000-0000-000000000000/secretos/'
        || '00000000-0000-0000-0000-000000000000/f.jpg', false
    ) THEN
        RAISE EXCEPTION 'un kind fuera del vocabulario debe rechazarse';
    END IF;
    IF core.ai_asset_path_ok(
        '00000000-0000-0000-0000-000000000000/image/'
        || '00000000-0000-0000-0000-000000000000/../../etc/passwd', false
    ) THEN
        RAISE EXCEPTION 'un salto de directorio debe rechazarse';
    END IF;
    IF core.ai_asset_path_ok(
        '00000000-0000-0000-0000-000000000000/image/'
        || '00000000-0000-0000-0000-000000000000/a/b/f.jpg', false
    ) THEN
        RAISE EXCEPTION 'una ruta de más de 4 segmentos debe rechazarse';
    END IF;

    -- Un UUID bien formado que no es ningún proyecto tampoco pasa.
    IF core.ai_asset_path_ok(
        'ffffffff-ffff-4fff-8fff-ffffffffffff/image/'
        || '00000000-0000-0000-0000-000000000000/f.jpg', true
    ) THEN
        RAISE EXCEPTION 'un project_id inexistente debe rechazarse';
    END IF;

    -- Y una ruta de un proyecto real sí pasa. Sin esta comprobación positiva la
    -- función podría estar devolviendo false siempre y las cinco anteriores
    -- seguirían pasando.
    SELECT id INTO v_proyecto FROM ai.projects WHERE deleted_at IS NULL LIMIT 1;
    IF v_proyecto IS NOT NULL THEN
        IF NOT core.ai_asset_path_ok(
            v_proyecto::text || '/image/'
            || '00000000-0000-0000-0000-000000000000/foto.jpg', true
        ) THEN
            RAISE EXCEPTION 'la ruta de un proyecto vivo debe aceptarse';
        END IF;
        RAISE NOTICE 'OK 0045: comprobación positiva hecha contra el proyecto %', v_proyecto;
    ELSE
        RAISE WARNING 'OK 0045 PARCIAL: sin proyectos en ai.projects, la comprobación positiva no pudo ejecutarse';
    END IF;

    RAISE NOTICE 'OK 0045: bucket ai-assets privado, 4 políticas, ruta validada como invariante';
END
$$;
