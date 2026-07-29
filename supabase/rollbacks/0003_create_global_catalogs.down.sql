-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0003_create_global_catalogs.sql
-- Revierte    : public.countries y public.currencies
-- Orden       : countries primero (tiene FK hacia currencies)
--
-- Nota 1: DROP TABLE elimina en cascada sus propios índices y políticas RLS.
--         No hace falta borrarlos por separado.
-- Nota 2: se usa RESTRICT implícito (sin CASCADE). Si una migración posterior
--         creó una FK hacia estas tablas —core.tenant_countries en 0008 lo
--         hará— el DROP **falla a propósito**: revertir 0003 con 0008 aplicada
--         destruiría datos de tenant.
-- Nota 3: no se restauran los privilegios que el REVOKE del punto 3 retiró.
--         Desaparecen con la tabla, y devolverlos con GRANT concedería
--         permisos que el estado previo no tenía.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.countries;
DROP TABLE IF EXISTS public.currencies;
