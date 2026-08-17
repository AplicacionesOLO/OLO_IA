-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0093 · Catálogo de modelos 3D
--
-- ── QUE DEVUELVE Y QUE NO ─────────────────────────────────────────────────────
--
-- Devuelve el esquema a como estaba: fuera las dos tablas, las políticas, la función de
-- ruta y el bucket.
--
-- Lo que NO puede devolver son los BYTES. Si alguien ha subido figuras, este guion falla a
-- propósito en vez de borrarlas: un `.glb` que alguien compró o modeló no se recupera de
-- ningún sitio, y perderlo por deshacer una migración sería un daño que no se ve hasta que
-- alguien lo busca.
--
-- Para forzarlo, vacía el bucket primero DESDE STORAGE —no por SQL, que un disparador lo
-- impide para no dejar objetos huérfanos— y vuelve a ejecutar.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_objetos int;
    v_filas   int;
BEGIN
    SELECT count(*) INTO v_objetos FROM storage.objects WHERE bucket_id = 'spatial-assets';
    IF v_objetos > 0 THEN
        RAISE EXCEPTION
            'hay % objeto(s) en spatial-assets. Vacia el bucket desde Storage antes de '
            'deshacer: los .glb no se recuperan de ningun sitio.', v_objetos;
    END IF;

    SELECT count(*) INTO v_filas FROM spatial.asset_instances WHERE deleted_at IS NULL;
    IF v_filas > 0 THEN
        RAISE NOTICE 'aviso: se van a borrar % figura(s) colocada(s) en planos', v_filas;
    END IF;
END $$;

DROP POLICY IF EXISTS spatial_assets_read ON storage.objects;
DROP POLICY IF EXISTS spatial_assets_write ON storage.objects;
DROP POLICY IF EXISTS spatial_assets_plataforma ON storage.objects;
DROP POLICY IF EXISTS spatial_assets_delete ON storage.objects;

DROP POLICY IF EXISTS asset_inst_select ON spatial.asset_instances;
DROP POLICY IF EXISTS asset_inst_write ON spatial.asset_instances;
DROP POLICY IF EXISTS asset_models_select ON spatial.asset_models;
DROP POLICY IF EXISTS asset_models_write ON spatial.asset_models;
DROP POLICY IF EXISTS asset_models_plataforma ON spatial.asset_models;

-- `asset_instances` primero: referencia a `asset_models`.
DROP TABLE IF EXISTS spatial.asset_instances;
DROP TABLE IF EXISTS spatial.asset_models;

DROP FUNCTION IF EXISTS core.spatial_asset_path_ok(text);

DELETE FROM storage.buckets WHERE id = 'spatial-assets';

DO $$
BEGIN
    RAISE NOTICE 'OK · 0093 deshecha. El bucket, las dos tablas y la funcion de ruta ya no '
                 'estan. Nada mas del esquema cambio.';
END $$;
