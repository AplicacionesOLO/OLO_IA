-- Rollback de 0016_create_auth_hook.sql
-- ANTES de ejecutarlo hay que DESREGISTRAR el hook en la configuracion de Auth.
-- Si se elimina la funcion con el hook aun registrado, GoTrue falla al emitir
-- tokens y NADIE puede iniciar sesion:
--   PATCH /v1/projects/{ref}/config/auth  {"hook_custom_access_token_enabled": false}
DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);