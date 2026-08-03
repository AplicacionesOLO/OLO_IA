-- ROLLBACK de 0046_platform_owner_self_diagnosis.sql
--
-- Solo elimina la función de diagnóstico. No hay datos que revertir: 0046 no
-- inserta, no concede y no modifica nada.

DROP FUNCTION IF EXISTS core.my_platform_access();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'core' AND p.proname = 'my_platform_access'
    ) THEN
        RAISE EXCEPTION 'core.my_platform_access() sigue existiendo';
    END IF;
    RAISE NOTICE 'OK rollback 0046: funcion de diagnostico eliminada';
END
$$;
