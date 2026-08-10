-- Rollback de 0086 · la marca de pruebas del registro de auditoría.
--
-- Quitar la columna NO borra ninguna entrada: `is_test` solo decía de dónde venía la
-- escritura. Lo que se pierde es la capacidad de separar el ruido de la suite de tests
-- del rastro de operación real — que era todo el motivo de 0086.
--
-- Después de esto, el registro volverá a mezclar las ~150 entradas que deja cada
-- `pytest` con las de las personas.

DO $$
DECLARE
    v_pruebas bigint;
BEGIN
    IF to_regclass('audit.entries') IS NULL THEN
        RAISE NOTICE 'No existe el registro: nada que revertir.';
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'audit' AND table_name = 'entries'
           AND column_name = 'is_test'
    ) THEN
        RAISE NOTICE '0086 ya estaba revertida.';
        RETURN;
    END IF;
    SELECT count(*) INTO v_pruebas FROM audit.entries WHERE is_test;
    RAISE NOTICE 'Se pierde la marca de % entradas. Las entradas se quedan.', v_pruebas;
END $$;

-- El trigger vuelve al de 0085, SIN leer `app.is_test`.
--
-- Se reescribe entero a mano y no se «reaplica 0085»: un rollback que dependa de volver
-- a ejecutar otra migración se rompe en cuanto esa otra cambia.
CREATE OR REPLACE FUNCTION audit.registrar() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_antes    jsonb;
    v_despues  jsonb;
    v_cambios  text[];
    v_tenant   uuid;
    v_usuario  uuid;
    v_auth     uuid;
BEGIN
    BEGIN
        v_usuario := core.current_user_id();
        v_auth    := core.current_auth_id();
        v_tenant  := core.current_tenant_id();
    EXCEPTION WHEN OTHERS THEN
        v_usuario := NULL;
        v_auth    := NULL;
        v_tenant  := NULL;
    END;

    IF TG_OP <> 'INSERT' THEN
        v_antes := audit.limpiar(to_jsonb(OLD));
    END IF;
    IF TG_OP <> 'DELETE' THEN
        v_despues := audit.limpiar(to_jsonb(NEW));
    END IF;

    v_tenant := coalesce(
        (coalesce(v_despues, v_antes) ->> 'tenant_id')::uuid,
        v_tenant
    );

    IF TG_OP = 'UPDATE' THEN
        v_cambios := ARRAY(
            SELECT key FROM jsonb_each(v_despues)
             WHERE v_antes -> key IS DISTINCT FROM value
             ORDER BY key
        );
        IF v_cambios IS NULL
           OR v_cambios <@ ARRAY['updated_at', 'updated_by', 'version']::text[]
        THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO audit.entries (
        tenant_id, schema_name, table_name, row_id, operation,
        actor_user_id, actor_auth_id, db_role, changed, before, after
    ) VALUES (
        v_tenant, TG_TABLE_SCHEMA, TG_TABLE_NAME,
        coalesce(v_despues, v_antes) ->> 'id', TG_OP,
        v_usuario, v_auth, session_user, v_cambios, v_antes, v_despues
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;

DROP INDEX IF EXISTS audit.ix_entries_reales;
ALTER TABLE audit.entries DROP COLUMN IF EXISTS is_test;

DO $$
DECLARE
    v_id    uuid;
    v_n     bigint;
    v_antes bigint;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'audit' AND table_name = 'entries'
           AND column_name = 'is_test'
    ) THEN
        RAISE EXCEPTION 'La columna is_test sigue ahi';
    END IF;

    -- Y el trigger tiene que seguir capturando: un rollback que deje el registro mudo
    -- seria peor que el problema que revierte.
    SELECT count(*) INTO v_antes FROM audit.entries;
    INSERT INTO core.clients (tenant_id, company_id, name, code, status)
    SELECT co.tenant_id, co.id, 'ZZZ Rollback 0086', 'ZZZ-0086R', 'active'
      FROM core.companies co ORDER BY co.created_at LIMIT 1
    RETURNING id INTO v_id;
    SELECT count(*) INTO v_n FROM audit.entries;
    IF v_n <> v_antes + 1 THEN
        RAISE EXCEPTION 'El trigger dejo de capturar tras revertir';
    END IF;
    DELETE FROM core.clients WHERE id = v_id;
    DELETE FROM audit.entries WHERE row_id = v_id::text;

    RAISE NOTICE 'OK · 0086 revertida · el registro sigue capturando y no perdio entradas';
END $$;
