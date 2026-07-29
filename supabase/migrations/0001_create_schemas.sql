-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0001_create_schemas.sql
-- Crea      : schemas core, audit, platform, internal
-- Por qué   : contenedores de todo el modelo de Fase 0. Son cinco schemas en
--             total; `public` ya existe. Los schemas inventory, integrations,
--             ai, devices y spatial NO se crean aquí: cada uno nace con su
--             primera tabla (FINAL_DATABASE_MODEL.md §2).
-- Depende de: nada. Es la primera migración del proyecto.
-- Rollback  : supabase/rollbacks/0001_create_schemas.down.sql
-- Riesgo    : bajo — solo crea contenedores vacíos y revoca privilegios.
--
-- Nota 1: NO crea extensiones. `gen_random_uuid()` está disponible de serie en
--         este proyecto (pgcrypto ya instalado en el schema `extensions`),
--         verificado antes de escribir esta migración. El roadmap la creaba
--         solo "si no está disponible".
-- Nota 2: NO referencia `olo_app`. Ese rol se crea en 0002, y allí se gestionan
--         todos sus privilegios, incluida la revocación sobre platform e
--         internal (corrección del roadmap aprobada).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Guarda de entorno ───────────────────────────────────────────────────
-- gen_random_uuid() es la PK por defecto de todo el modelo
-- (FINAL_DATABASE_MODEL.md §1). Si falta, esta migración debe fallar aquí y
-- no más adelante de forma difusa, cuando ya haya tablas dependiendo de ella.
DO $$
BEGIN
    IF to_regprocedure('gen_random_uuid()') IS NULL THEN
        RAISE EXCEPTION
            'gen_random_uuid() no está disponible. Instalar pgcrypto antes de continuar.';
    END IF;
END
$$;


-- ── 2. Schemas de Fase 0 ───────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS internal;

COMMENT ON SCHEMA core     IS
    'Tenancy, jerarquia organizacional, identidad y autorizacion. Expuesto a PostgREST.';
COMMENT ON SCHEMA audit    IS
    'Eventos de auditoria append-only. Expuesto a PostgREST solo para SELECT.';
COMMENT ON SCHEMA platform IS
    'Operaciones cross-tenant y log de privilegios. NO expuesto a PostgREST.';
COMMENT ON SCHEMA internal IS
    'Vistas materializadas y artefactos internos. NO expuesto a PostgREST.';


-- ── 3. Aislamiento de platform e internal ──────────────────────────────────
-- Un schema recién creado no concede nada a PUBLIC en PostgreSQL, así que
-- estos REVOKE son defensivos: no cambian el estado efectivo, pero dejan la
-- intención escrita y protegen frente a cambios futuros en los privilegios
-- por defecto del proyecto.
--
-- Solo se referencian roles que YA existen en el proyecto: anon y
-- authenticated. `olo_app` se trata en 0002.
REVOKE ALL ON SCHEMA platform, internal FROM PUBLIC;
REVOKE ALL ON SCHEMA platform, internal FROM anon;
REVOKE ALL ON SCHEMA platform, internal FROM authenticated;
