-- ROLLBACK de 0045_ai_assets_storage.sql
--
-- NO borra el bucket. VERIFICADO: Supabase instala un trigger que rechaza el
-- borrado directo sobre las tablas de storage —
--
--     InsufficientPrivilege: Direct deletion from storage tables is not allowed.
--     Use the Storage API instead.
--     HINT: This prevents accidental data loss from orphaned objects.
--
-- y ese rechazo abortaba la transacción entera, dejando el rollback inservible.
--
-- Quitar las políticas es suficiente y es más seguro: con RLS activo y ninguna
-- política, `storage.objects` deniega todo en el bucket. El bucket queda existiendo
-- pero inaccesible, que es el estado seguro. Eliminarlo de verdad requiere vaciarlo
-- primero por la Storage API, a mano y a conciencia.

DO $$
DECLARE v_objetos int;
BEGIN
    SELECT count(1) INTO v_objetos FROM storage.objects WHERE bucket_id = 'ai-assets';
    IF v_objetos > 0 THEN
        RAISE WARNING
            'El bucket ai-assets conserva % objeto(s). Quedan inaccesibles, no borrados.',
            v_objetos;
    END IF;
END
$$;

DROP POLICY IF EXISTS ai_assets_delete ON storage.objects;
DROP POLICY IF EXISTS ai_assets_update ON storage.objects;
DROP POLICY IF EXISTS ai_assets_write  ON storage.objects;
DROP POLICY IF EXISTS ai_assets_read   ON storage.objects;

-- Después de las políticas: son ellas las que la invocan.
DROP FUNCTION IF EXISTS core.ai_asset_path_ok(text, boolean);

DO $$
DECLARE v_pol int;
BEGIN
    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname LIKE 'ai\_assets\_%';
    IF v_pol <> 0 THEN
        RAISE EXCEPTION 'quedan % políticas de ai-assets', v_pol;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'core' AND p.proname = 'ai_asset_path_ok'
    ) THEN
        RAISE EXCEPTION 'core.ai_asset_path_ok() sigue existiendo';
    END IF;

    RAISE NOTICE 'OK rollback 0045: sin políticas ni función. El bucket permanece, inaccesible.';
END
$$;
