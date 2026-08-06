-- Rollback de 0076.
--
-- NO elimina el bucket: Supabase rechaza el borrado directo sobre las tablas de
-- storage («Direct deletion from storage tables is not allowed») y ese rechazo aborta
-- la transaccion entera. Es lo mismo que documenta 0045. Sin politicas, RLS deniega
-- todo y el bucket queda inaccesible, que es el efecto que se busca.
--
-- Los objetos ya subidos SIGUEN AHI y siguen costando almacenamiento. Vaciarlos es una
-- operacion de la consola de Supabase, no de una migracion: borrar videos de
-- inspeccion de verdad no debe ser el efecto colateral de deshacer un cambio de
-- esquema.
DROP POLICY IF EXISTS perception_media_read   ON storage.objects;
DROP POLICY IF EXISTS perception_media_write  ON storage.objects;
DROP POLICY IF EXISTS perception_media_update ON storage.objects;
DROP POLICY IF EXISTS perception_media_delete ON storage.objects;

DROP FUNCTION IF EXISTS core.perception_media_path_ok(text);
