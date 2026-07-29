-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0020_platform_owners.sql
--
-- ⚠ El trigger del último owner abortaría el propio rollback al vaciar la tabla,
--   así que se elimina ANTES que la tabla. Es el orden inverso exacto de la
--   creación.
--
-- ⚠ Aborta si existen tablas de 0025+ : sus políticas invocan
--   core.is_platform_owner() y quedarían apuntando a una función inexistente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_dependientes int;
BEGIN
    SELECT count(1) INTO v_dependientes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'platform' AND c.relkind = 'r' AND c.relname <> 'owners';

    IF v_dependientes > 0 THEN
        RAISE EXCEPTION
            'Hay % tablas en platform que dependen de is_platform_owner(). Revierte 0024-0030 primero.',
            v_dependientes;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_owners_last_guard ON platform.owners;
DROP FUNCTION IF EXISTS platform.prevent_last_owner_revocation();

DROP POLICY IF EXISTS owners_update          ON platform.owners;
DROP POLICY IF EXISTS owners_insert          ON platform.owners;
DROP POLICY IF EXISTS owners_read            ON platform.owners;
DROP POLICY IF EXISTS owners_platform_only   ON platform.owners;

DROP TABLE IF EXISTS platform.owners;

-- La función se elimina después de la tabla: la política la referenciaba.
DROP FUNCTION IF EXISTS core.is_platform_owner();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'platform' AND c.relname = 'owners') THEN
        RAISE EXCEPTION 'platform.owners sigue existiendo';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'core' AND p.proname = 'is_platform_owner') THEN
        RAISE EXCEPTION 'core.is_platform_owner() sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0020: tabla, trigger, políticas y función eliminadas';
END
$$;
