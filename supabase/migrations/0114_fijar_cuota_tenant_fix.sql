-- ═══════════════════════════════════════════════════════════════════════════
-- 0114_fijar_cuota_tenant_fix.sql
-- Corrige   : core.fijar_cuota_tenant() (0113)
-- Depende de: 0113 (tenant_quotas)
-- Riesgo     : bajo -- CREATE OR REPLACE de una funcion de un dia, probada en
--              vivo antes de que nada mas la usara.
--
-- ── EL BUG, PROBADO EN VIVO ───────────────────────────────────────────────
--
-- `ON CONFLICT (tenant_id)` fallaba con "column reference tenant_id is
-- ambiguous": el nombre de la columna del conflict target coincide con el
-- nombre de una columna de salida de `RETURNS TABLE (tenant_id uuid, ...)`,
-- y a diferencia de una lista de columnas normal, el conflict target NO
-- admite calificarse con el nombre de la tabla (`ON CONFLICT (t.tenant_id)`
-- no es sintaxis valida) -- asi que no hay forma de desambiguarlo desde ahi.
--
-- La solucion es renombrar las columnas de SALIDA de la funcion para que no
-- choquen con ninguna columna real de `core.tenant_quotas` -- el problema
-- nunca estuvo en la tabla, solo en que la funcion devolvia columnas con el
-- mismo nombre exacto que las que lee y escribe.
-- ═══════════════════════════════════════════════════════════════════════════

-- No basta con CREATE OR REPLACE: Postgres no permite cambiar el tipo de
-- retorno de una funcion existente (los nombres de las columnas de un
-- RETURNS TABLE SI cuentan como parte del tipo), asi que hay que soltarla
-- primero -- probado en vivo, el CREATE OR REPLACE solo fallo con
-- "cannot change return type of existing function".
DROP FUNCTION IF EXISTS core.fijar_cuota_tenant(uuid, int, int);

CREATE FUNCTION core.fijar_cuota_tenant(
    p_tenant_id  uuid,
    p_max_detecciones int,
    p_max_dispositivos int
)
RETURNS TABLE (
    out_tenant_id uuid,
    out_max_detections_monthly int,
    out_max_devices int,
    out_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid := core.current_user_id();
BEGIN
    IF NOT core.is_platform_owner() THEN
        RAISE EXCEPTION 'Solo un platform owner puede fijar cuotas' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM core.tenants t WHERE t.id = p_tenant_id) THEN
        RAISE EXCEPTION 'Tenant % no encontrado', p_tenant_id USING ERRCODE = '23503';
    END IF;

    RETURN QUERY
    INSERT INTO core.tenant_quotas
        (tenant_id, max_detections_monthly, max_devices, updated_by)
    VALUES
        (p_tenant_id, p_max_detecciones, p_max_dispositivos, v_actor)
    ON CONFLICT (tenant_id) DO UPDATE SET
        max_detections_monthly = EXCLUDED.max_detections_monthly,
        max_devices            = EXCLUDED.max_devices,
        updated_at             = now(),
        updated_by             = EXCLUDED.updated_by
    RETURNING tenant_id, max_detections_monthly, max_devices, updated_at;
END;
$$;

COMMENT ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) IS
    'Unico camino de escritura de core.tenant_quotas. Comprueba is_platform_owner '
    'por su cuenta -- ver la cabecera de 0113. Columnas de salida prefijadas '
    'out_ -- ver 0114, el conflict target no se puede calificar con la tabla.';

REVOKE ALL ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.fijar_cuota_tenant(uuid, int, int) TO olo_app;

-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
DECLARE v_id uuid;
BEGIN
    -- Necesita ser platform owner para probar el camino de exito -- si esta
    -- sesion (postgres/superuser via admin_sql.py) no lo es, is_platform_owner()
    -- da false y esto documenta el rechazo en vez de fallar en silencio.
    IF core.is_platform_owner() THEN
        RAISE EXCEPTION 'esta sesion no deberia ser platform owner (es la de administracion)';
    END IF;

    BEGIN
        PERFORM core.fijar_cuota_tenant(gen_random_uuid(), 100, 5);
        RAISE EXCEPTION 'fijar_cuota_tenant deberia rechazar sin ser platform owner';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%platform owner%' THEN
            RAISE;
        END IF;
    END;
END
$$;
