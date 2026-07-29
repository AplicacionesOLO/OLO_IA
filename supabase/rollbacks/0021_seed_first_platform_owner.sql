-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0021_seed_first_platform_owner.sql
--
-- ⚠ El trigger `trg_owners_last_guard` abortaría este rollback: borrar al único
--   owner deja la tabla sin owners activos, que es precisamente lo que el
--   trigger existe para impedir.
--
--   Se desactiva durante el borrado y se reactiva después. Deshacer la siembra
--   es legítimo —revierte al estado anterior a la migración, donde tampoco había
--   owners— mientras que revocar al último owner en operación normal no lo es.
--   El trigger no puede distinguir los dos casos, así que la distinción se hace
--   aquí, de forma explícita y acotada.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE platform.owners DISABLE TRIGGER trg_owners_last_guard;

DELETE FROM platform.owners
 WHERE user_id IN (
     SELECT id FROM core.users WHERE email = 'arojas@ologistics.com'
 );

ALTER TABLE platform.owners ENABLE TRIGGER trg_owners_last_guard;

DO $$
DECLARE
    v_quedan   int;
    v_habilitado char;
BEGIN
    SELECT count(1) INTO v_quedan
      FROM platform.owners o
      JOIN core.users u ON u.id = o.user_id
     WHERE u.email = 'arojas@ologistics.com';

    IF v_quedan > 0 THEN
        RAISE EXCEPTION 'la fila del owner inicial sigue presente';
    END IF;

    -- Que el trigger quede reactivado es tan importante como el borrado: si se
    -- quedara desactivado, la guarda del último owner dejaría de existir en
    -- silencio y el rollback habría abierto un agujero.
    SELECT t.tgenabled INTO v_habilitado
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relname = 'owners'
       AND t.tgname = 'trg_owners_last_guard';

    IF v_habilitado IS DISTINCT FROM 'O' THEN
        RAISE EXCEPTION
            'el trigger trg_owners_last_guard NO quedó reactivado (tgenabled=%)',
            v_habilitado;
    END IF;

    RAISE NOTICE 'OK rollback 0021: owner inicial eliminado y guarda reactivada';
END
$$;
