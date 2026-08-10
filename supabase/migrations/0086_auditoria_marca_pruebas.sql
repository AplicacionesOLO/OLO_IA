-- ═══════════════════════════════════════════════════════════════════════════════
-- 0086 · AUDITORÍA — distinguir las escrituras de las pruebas
--
-- ── EL PROBLEMA, MEDIDO ───────────────────────────────────────────────────────
--
-- La suite de tests corre contra ESTA base —hay una sola instancia de Supabase— y
-- escribe de verdad. Medido en la primera pasada completa después de 0085: el registro
-- pasó de 22 a 174 entradas, o sea **152 entradas por ejecución**, con cosas como
-- «María Rojas borró una colocación de racks» — un usuario de prueba.
--
-- Antes de 0085 eso no dejaba huella y daba igual. Ahora cada `pytest` añade ~150
-- entradas al registro que alguien va a leer para auditar de verdad, y el ruido de las
-- pruebas supera al de la operación.
--
-- ── LA MARCA ES UNA PISTA, NO UN CONTROL DE SEGURIDAD ─────────────────────────
--
-- El trigger lee `app.is_test` de la sesión. Eso significa que **cualquiera que pueda
-- ejecutar SQL en la sesión de la aplicación puede marcar sus escrituras**, y hay que
-- decirlo en voz alta en lugar de fingir que esto es una garantía.
--
-- Lo que lo hace aceptable es que marcar NO es esconder:
--
--   · la entrada se escribe igual, con todo su contenido. No se pierde nada.
--   · nunca se borra: `olo_app` sigue sin poder hacer DELETE.
--   · la API cuenta cuántas oculta y la pantalla lo dice, con un interruptor para
--     verlas. Igual que con las tablas que no se auditan: lo que no se enseña, se
--     cuenta.
--
-- Una marca que hiciera desaparecer filas en silencio sí sería un agujero. Esta no.
--
-- ── POR QUÉ NO SE TOCA `tenant_session` ───────────────────────────────────────
--
-- El código de producción no sabe que existen las pruebas. La marca la pone la suite,
-- desde `tests/app_session.py`, con un `SET LOCAL` dentro de su propia transacción. Si
-- la aplicación tuviera una forma cómoda de marcar sus escrituras, antes o después
-- alguien la usaría para bajar el ruido de algo que no es una prueba.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1 · La columna ────────────────────────────────────────────────────────────
ALTER TABLE audit.entries
    ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN audit.entries.is_test IS
    'La escritura venia de la suite de tests (`SET LOCAL app.is_test`). Es una PISTA '
    'para bajar el ruido, no un control: la entrada se guarda igual y la interfaz '
    'cuenta cuantas oculta. Ver 0086.';

-- El índice del uso normal, ahora sin las de prueba. Parcial y no completo: las de
-- prueba son mayoría en volumen y no se recorren nunca por fecha.
CREATE INDEX IF NOT EXISTS ix_entries_reales
    ON audit.entries (tenant_id, occurred_at DESC, id DESC)
 WHERE NOT is_test;


-- ── 2 · El trigger lee la marca ───────────────────────────────────────────────
--
-- Se reescribe entero —no hay forma de parchear una función— y sigue siendo el de 0085
-- salvo la lectura de `app.is_test`. Los comentarios de allí siguen valiendo:
-- `session_user` y no `current_user`, contexto de sesión protegido, y el resto sin red
-- porque si falla se quiere saber.
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
    -- Lo único protegido: leer el contexto de sesión. Con un contexto a medias estas
    -- llamadas podrían fallar, y un fallo aquí tumbaría la escritura auditada por una
    -- razón que no tiene nada que ver con ella.
    BEGIN
        v_usuario := core.current_user_id();
        v_auth    := core.current_auth_id();
        v_tenant  := core.current_tenant_id();
    EXCEPTION WHEN OTHERS THEN
        v_usuario := NULL;
        v_auth    := NULL;
        v_tenant  := NULL;
    END;

    -- `true` como segundo argumento: si el GUC no está puesto devuelve NULL en vez de
    -- reventar. Sin eso, TODA escritura fuera de los tests fallaría.
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
        -- Un UPDATE que solo movió la contabilidad no es un evento.
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
        v_tenant,
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        coalesce(v_despues, v_antes) ->> 'id',
        TG_OP,
        v_usuario,
        v_auth,
        -- `session_user`, NO `current_user`: dentro de SECURITY DEFINER `current_user`
        -- es el dueño de la función y la columna no distinguiría nada.
        session_user,
        v_cambios,
        v_antes,
        v_despues,
        v_prueba
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;


-- ── 3 · Las 174 entradas que ya había ─────────────────────────────────────────
--
-- Se marcan como de prueba, y esta es la ÚNICA vez que el registro se escribe a mano.
-- La justificación tiene que quedar aquí, porque un registro de auditoría corregido sin
-- explicación es exactamente lo que no debe pasar:
--
--   · `audit.entries` se creó el 7 de agosto de 2026 (migración 0085) y se marcó ese
--     mismo día. Entre las dos cosas no hubo ningún usuario real en el sistema.
--   · las 174 entradas salen de dos sitios y de ninguno más: los guiones de
--     verificación de la API escritos ese día, y la suite de pytest.
--   · están todas en una ventana de una hora, entre las 15:34 y las 16:47 UTC.
--
-- El `WHERE` es por ID y acotado por fecha: si esta migración se aplicara más tarde en
-- otra base, no marcaría entradas que no le corresponden.
UPDATE audit.entries
   SET is_test = true
 WHERE NOT is_test
   AND occurred_at < '2026-08-07T17:00:00Z'::timestamptz;


-- ── 4 · Verificación ──────────────────────────────────────────────────────────
DO $$
DECLARE
    v_id      uuid;
    v_marca   boolean;
    v_pend    bigint;
BEGIN
    -- ── Con la marca puesta ───────────────────────────────────────────────────
    SET LOCAL app.is_test = 'on';

    INSERT INTO core.clients (tenant_id, company_id, name, code, status)
    SELECT co.tenant_id, co.id, 'ZZZ Marca 0086', 'ZZZ-0086', 'active'
      FROM core.companies co ORDER BY co.created_at LIMIT 1
    RETURNING id INTO v_id;

    SELECT is_test INTO v_marca FROM audit.entries
     WHERE row_id = v_id::text ORDER BY id DESC LIMIT 1;
    IF v_marca IS NOT TRUE THEN
        RAISE EXCEPTION 'Con `app.is_test` puesto la entrada no quedo marcada';
    END IF;

    DELETE FROM core.clients WHERE id = v_id;
    DELETE FROM audit.entries WHERE row_id = v_id::text;

    -- ── Sin la marca ──────────────────────────────────────────────────────────
    --
    -- Es la mitad importante: si el GUC ausente marcara todo como prueba, el registro
    -- entero quedaria escondido detras de un interruptor y nadie lo notaria.
    SET LOCAL app.is_test = '';

    INSERT INTO core.clients (tenant_id, company_id, name, code, status)
    SELECT co.tenant_id, co.id, 'ZZZ Sin marca 0086', 'ZZZ-0086B', 'active'
      FROM core.companies co ORDER BY co.created_at LIMIT 1
    RETURNING id INTO v_id;

    SELECT is_test INTO v_marca FROM audit.entries
     WHERE row_id = v_id::text ORDER BY id DESC LIMIT 1;
    IF v_marca IS NOT FALSE THEN
        RAISE EXCEPTION 'Sin `app.is_test` la entrada quedo marcada como prueba';
    END IF;

    DELETE FROM core.clients WHERE id = v_id;
    DELETE FROM audit.entries WHERE row_id = v_id::text;

    -- ── El histórico quedó marcado ────────────────────────────────────────────
    SELECT count(*) INTO v_pend FROM audit.entries
     WHERE NOT is_test AND occurred_at < '2026-08-07T17:00:00Z'::timestamptz;
    IF v_pend > 0 THEN
        RAISE EXCEPTION 'Quedan % entradas del periodo de construccion sin marcar', v_pend;
    END IF;

    -- Marcar no es borrar: siguen todas ahí.
    SELECT count(*) INTO v_pend FROM audit.entries WHERE is_test;
    IF v_pend < 100 THEN
        RAISE EXCEPTION 'Solo % entradas marcadas; se esperaban las ~174 del historico',
                        v_pend;
    END IF;

    RAISE NOTICE 'OK · la marca funciona en los dos sentidos · % entradas de prueba '
                 'marcadas y NINGUNA borrada', v_pend;
END $$;
