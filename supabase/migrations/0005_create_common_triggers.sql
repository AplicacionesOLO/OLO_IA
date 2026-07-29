-- ═══════════════════════════════════════════════════════════════════════════
-- Migración : 0005_create_common_triggers.sql
-- Crea      : core.set_updated_at(), core.prevent_tenant_change()
-- Por qué   : las usan todas las tablas mutables del modelo. Se crean antes de
--             la primera tabla para que cada migración pueda engancharlas.
-- Depende de: 0001 (schema core)
-- Rollback  : supabase/rollbacks/0005_create_common_triggers.down.sql
-- Riesgo    : medio
--
-- Nota 1: `core.soft_delete()` NO se crea, y no es un olvido. Se verificó
--         empíricamente que como BEFORE UPDATE marca deleted_at en CUALQUIER
--         actualización —renombrar un almacén lo eliminaba— y que como
--         BEFORE DELETE no hace nada mientras el borrado físico se ejecuta en
--         silencio. Ninguna de sus dos formas de uso es salvable. El soft
--         delete se hace con UPDATE explícito en el repositorio.
-- Nota 2: set_updated_at NO toca `version`. Si lo hiciera, cualquier escritura
--         de sistema invalidaría la versión que el cliente tiene en mano y
--         produciría 409 sin causa real. La versión la incrementa la sentencia
--         de la aplicación, explícitamente.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Mantenimiento de updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.set_updated_at() IS
    'BEFORE UPDATE: fija updated_at = now(). NO modifica version (evita 409 espurios).';


-- ── 2. Inmutabilidad de tenant_id ──────────────────────────────────────────
-- IS DISTINCT FROM, no `!=`. Verificado empíricamente: con `!=`, poner
-- tenant_id a NULL atraviesa el trigger sin excepción, porque la comparación
-- devuelve NULL y el IF no entra. Era un escape de tenant no detectado.
CREATE OR REPLACE FUNCTION core.prevent_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION
            'cannot change tenant_id of existing record (% -> %)',
            OLD.tenant_id, NEW.tenant_id
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.prevent_tenant_change() IS
    'BEFORE UPDATE: impide cambiar tenant_id. Usa IS DISTINCT FROM para cubrir el caso NULL.';


-- ── 3. Verificación funcional sobre una tabla de sonda ─────────────────────
-- La sonda vive dentro del bloque y la excepción final la revierte: la
-- migración no deja ningún objeto de prueba. Si alguna aserción falla, la
-- migración entera se aborta y no se aplica.
-- IMPORTANTE sobre el test de updated_at: now() devuelve la hora de INICIO DE
-- LA TRANSACCIÓN, así que es constante dentro de ella y pg_sleep no la avanza.
-- Comparar updated_at antes y después de un UPDATE en la misma transacción da
-- siempre el mismo valor y no prueba nada. Lo que sí es el contrato del
-- trigger es que **sobrescribe el valor que envíe el cliente**: eso es lo que
-- se verifica aquí.
DO $$
DECLARE
    v_after  timestamptz;
    v_msg    text;
BEGIN
    CREATE TABLE core.__probe_0005 (
        id         int PRIMARY KEY,
        tenant_id  uuid,
        name       text,
        version    int NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TRIGGER trg_upd BEFORE UPDATE ON core.__probe_0005
        FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();
    CREATE TRIGGER trg_tenant BEFORE UPDATE ON core.__probe_0005
        FOR EACH ROW EXECUTE FUNCTION core.prevent_tenant_change();

    INSERT INTO core.__probe_0005 (id, tenant_id, name)
        VALUES (1, '11111111-1111-1111-1111-111111111111', 'inicial');

    -- T1: el cliente intenta fijar updated_at a una fecha antigua; el trigger
    --     debe imponer now() por encima de ese valor.
    UPDATE core.__probe_0005
       SET name = 'renombrado', updated_at = '2000-01-01T00:00:00Z'
     WHERE id = 1;
    SELECT updated_at INTO v_after FROM core.__probe_0005 WHERE id = 1;

    IF v_after = '2000-01-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'T1 set_updated_at no sobrescribio el valor del cliente';
    END IF;
    IF v_after <> now() THEN
        RAISE EXCEPTION 'T1 updated_at (%) no coincide con now() (%)', v_after, now();
    END IF;
    IF (SELECT version FROM core.__probe_0005 WHERE id = 1) <> 1 THEN
        RAISE EXCEPTION 'T1 set_updated_at modifico version, no debe';
    END IF;

    -- T2: cambiar tenant_id a otro valor debe lanzar excepción
    BEGIN
        UPDATE core.__probe_0005
           SET tenant_id = '22222222-2222-2222-2222-222222222222' WHERE id = 1;
        RAISE EXCEPTION 'T2 permitio cambiar tenant_id';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;  -- esperado
    END;

    -- T3: cambiar tenant_id a NULL también debe lanzar excepción.
    --     Es el caso que `!=` dejaba pasar.
    BEGIN
        UPDATE core.__probe_0005 SET tenant_id = NULL WHERE id = 1;
        RAISE EXCEPTION 'T3 permitio poner tenant_id a NULL';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;  -- esperado
    END;

    -- T4: el UPDATE que no toca tenant_id sigue funcionando
    UPDATE core.__probe_0005 SET name = 'final' WHERE id = 1;
    IF (SELECT name FROM core.__probe_0005 WHERE id = 1) <> 'final' THEN
        RAISE EXCEPTION 'T4 bloqueo un UPDATE legitimo';
    END IF;

    v_msg := 'T1..T4 OK';
    DROP TABLE core.__probe_0005;
    RAISE NOTICE '0005 verificacion: %', v_msg;
END
$$;
