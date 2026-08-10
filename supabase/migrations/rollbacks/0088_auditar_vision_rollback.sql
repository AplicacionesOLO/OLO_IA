-- Rollback de 0088 · auditar Visión.
--
-- Lo que se pierde:
--
--   · el rastro de las inspecciones. Volver aquí es volver al estado en el que un
--     borrado de 70,5 MB no dejó ni una entrada y hubo que reconstruirlo desde los
--     logs de Render, que caducan.
--   · el filtro de telemetría. La función vuelve a la de 0086, que solo ignora
--     `updated_at`, `updated_by` y `version`.
--
-- Las entradas YA escritas no se borran: siguen siendo rastro válido de lo que pasó.

DO $$
DECLARE
    v_n bigint;
BEGIN
    SELECT count(*) INTO v_n FROM audit.entries
     WHERE schema_name = 'perception';
    IF v_n > 0 THEN
        RAISE NOTICE 'Se dejan de vigilar las inspecciones. Las % entradas ya escritas '
                     'se conservan.', v_n;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_auditar ON perception.inference_jobs;
DROP TRIGGER IF EXISTS trg_auditar ON perception.media;

-- La función vuelve a la de 0086: sin la telemetría en la lista de ruido.
--
-- Se reescribe entera a mano y no se «reaplica 0086»: un rollback que dependa de volver
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
    v_prueba   boolean := false;
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

    v_prueba := coalesce(
        nullif(current_setting('app.is_test', true), '') IN ('on', 'true', '1'),
        false
    );

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
        actor_user_id, actor_auth_id, db_role, changed, before, after, is_test
    ) VALUES (
        v_tenant, TG_TABLE_SCHEMA, TG_TABLE_NAME,
        coalesce(v_despues, v_antes) ->> 'id', TG_OP,
        v_usuario, v_auth, session_user, v_cambios, v_antes, v_despues, v_prueba
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;

DO $$
DECLARE
    v_n int;
BEGIN
    SELECT count(*) INTO v_n
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = 'trg_auditar' AND n.nspname = 'perception';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'Quedan % triggers de auditoria en perception', v_n;
    END IF;

    -- Y el registro tiene que seguir capturando en el resto: un rollback que lo deje
    -- mudo seria peor que el hueco que revierte.
    SELECT count(*) INTO v_n
      FROM pg_trigger WHERE tgname = 'trg_auditar' AND NOT tgisinternal;
    IF v_n < 27 THEN
        RAISE EXCEPTION 'Solo quedan % tablas vigiladas; se esperaban las 27 de 0085',
                        v_n;
    END IF;
    RAISE NOTICE 'OK · 0088 revertida · % tablas siguen vigiladas · las entradas ya '
                 'escritas se conservan', v_n;
END $$;
