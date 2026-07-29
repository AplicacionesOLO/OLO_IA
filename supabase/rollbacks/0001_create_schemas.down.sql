-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback de : 0001_create_schemas.sql
-- Revierte    : los cuatro schemas creados por 0001
-- Orden       : inverso al de creación
--
-- Nota 1: se usa RESTRICT (el comportamiento por defecto de DROP SCHEMA), NO
--         CASCADE. Si un schema contiene objetos creados por migraciones
--         posteriores, este DROP **falla a propósito**. Es la protección
--         exigida: un rollback de 0001 no debe destruir el trabajo de 0002+.
-- Nota 2: NO se toca `public`, ni las extensiones, ni los roles anon /
--         authenticated / service_role. Nada de eso fue creado por 0001.
-- Nota 3: los REVOKE de 0001 no se deshacen explícitamente porque desaparecen
--         con el schema. Revertirlos con GRANT sería incorrecto: concedería
--         privilegios que el estado previo no tenía.
-- ═══════════════════════════════════════════════════════════════════════════

DROP SCHEMA IF EXISTS internal;
DROP SCHEMA IF EXISTS platform;
DROP SCHEMA IF EXISTS audit;
DROP SCHEMA IF EXISTS core;
