-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0002_create_olo_app_role.sql
-- Crea      : rol de aplicación `olo_app` y TODOS sus privilegios
-- Por qué   : el backend no puede conectarse con `service_role`, que tiene
--             BYPASSRLS y anularía por completo el aislamiento multi-tenant.
--             `olo_app` es el rol del canal B (IDENTITY_AND_AUTH_FLOW.md §3.8):
--             sin BYPASSRLS, sujeto a RLS, con el contexto establecido por
--             set_config() dentro de transacción explícita.
-- Depende de: 0001 (los schemas core y audit deben existir)
-- Rollback  : supabase/rollbacks/0002_create_olo_app_role.down.sql
-- Riesgo    : medio — un error de atributos aquí compromete el aislamiento
--
-- Nota 1: el rol se crea SIN CONTRASEÑA. Un rol con LOGIN y sin contraseña no
--         puede autenticarse con scram-sha-256, así que el estado por defecto
--         es fail-secure. La contraseña se establecerá como operación de
--         credenciales (no de esquema) cuando el backend FastAPI necesite
--         conectarse. No se versiona ninguna contraseña.
-- Nota 2: solo se conceden privilegios sobre los schemas que YA existen
--         (core, audit). Los de Fase 1-3 recibirán los suyos en la migración
--         que los cree, aplicando el mismo patrón.
-- Nota 3: NO se conceden privilegios a `authenticated` ni a `service_role`.
--         Aparecerán cuando existan objetos que realmente los necesiten.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. El rol ──────────────────────────────────────────────────────────────
-- NOBYPASSRLS  : imprescindible. Es la diferencia con service_role.
-- NOINHERIT    : no hereda privilegios de roles de los que sea miembro;
--                obliga a SET ROLE explícito y evita escaladas silenciosas.
-- NOCREATEDB / NOCREATEROLE / NOSUPERUSER : menor privilegio.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'olo_app') THEN
        CREATE ROLE olo_app
            LOGIN
            NOBYPASSRLS
            NOINHERIT
            NOCREATEDB
            NOCREATEROLE
            NOSUPERUSER
            NOREPLICATION;
    END IF;
END
$$;

COMMENT ON ROLE olo_app IS
    'Rol de aplicacion del backend (canal B). Sin BYPASSRLS: RLS siempre aplica. '
    'Contexto por set_config() en transaccion explicita. No es propietario de ninguna tabla.';


-- ── 2. Guarda de seguridad ─────────────────────────────────────────────────
-- Si alguna vez alguien concede BYPASSRLS a este rol, todo el aislamiento
-- multi-tenant desaparece en silencio. La migración se niega a continuar.
DO $$
BEGIN
    IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'olo_app') THEN
        RAISE EXCEPTION
            'olo_app tiene BYPASSRLS. Es incompatible con el aislamiento multi-tenant.';
    END IF;
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = 'olo_app') THEN
        RAISE EXCEPTION 'olo_app es SUPERUSER. Aborta.';
    END IF;
END
$$;


-- ── 3. Acceso a los schemas existentes ─────────────────────────────────────
-- USAGE permite resolver nombres dentro del schema; no concede nada sobre las
-- tablas, que se otorga por separado (punto 4).
GRANT USAGE ON SCHEMA core  TO olo_app;
GRANT USAGE ON SCHEMA audit TO olo_app;

-- platform e internal quedan fuera del alcance del rol de aplicación.
-- Defensivo: un schema nuevo no concede nada, pero deja la intención escrita.
REVOKE ALL ON SCHEMA platform, internal FROM olo_app;


-- ── 4. Privilegios por defecto sobre objetos FUTUROS ───────────────────────
-- Las migraciones se ejecutan como `postgres`, así que los objetos que creen
-- en estos schemas concederán automáticamente a olo_app lo que aquí se define.
-- Evita repetir un GRANT por tabla en cada migración y mantiene la política de
-- privilegios del rol en un solo lugar.
--
-- core: DML completo. RLS es lo que restringe las FILAS; el privilegio de
--       tabla solo habilita la operación.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA core
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA core
    GRANT USAGE, SELECT ON SEQUENCES TO olo_app;

-- audit: SOLO lectura e inserción. La inmutabilidad append-only de
--        audit.events se sostiene sobre esta ausencia deliberada de
--        UPDATE y DELETE (RLS_IMPLEMENTATION_GUIDE.md, plantilla T5).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit
    GRANT SELECT, INSERT ON TABLES TO olo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit
    GRANT USAGE, SELECT ON SEQUENCES TO olo_app;
