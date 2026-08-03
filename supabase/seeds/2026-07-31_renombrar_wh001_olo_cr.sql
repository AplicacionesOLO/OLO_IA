-- ═══════════════════════════════════════════════════════════════════════════
-- SEMILLA DE DATOS — NO ES UNA MIGRACIÓN
--
-- Fecha  : 2026-07-31
-- Objeto : renombrar el código del almacén WH-001 a OLO-CR
--
-- No va en `supabase/migrations/` porque es contenido de usuario: una migración
-- renombraría «WH-001» en todos los entornos y para siempre, incluidos aquellos
-- donde ese almacén no existe o significa otra cosa.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ «OLO CR» NO PUEDE SER EL CÓDIGO. EL MOTOR NO LO ACEPTA
--
--   `chk_wh_code` exige `^[A-Z0-9][A-Z0-9-]*$` — mayúsculas, dígitos y guiones. Un
--   espacio lo viola, así que el código queda **OLO-CR**.
--
--   Es una restricción razonable: el código entra en informes, en nombres de archivo
--   y en URLs, y un espacio ahí produce escapados inconsistentes.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUÉ SE CAMBIA Y QUÉ NO
--
--   · `code`: WH-001 → OLO-CR
--   · `name`: **NO se toca.** Sigue siendo «Centro de Distribución San José», que es
--     información real sobre dónde está el almacén. El selector mostrará
--     «OLO-CR — Centro de Distribución San José».
--
--   Si lo que se quería era cambiar el NOMBRE a «OLO CR», es otra sentencia y ahí sí
--   cabe el espacio. Se deja sin hacer porque perdería el dato de la ubicación.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- POR QUÉ ES SEGURO CAMBIAR EL CÓDIGO
--
--   Comprobado: `spatial.locations`, `spatial.nodes` y `spatial.bays` referencian el
--   almacén por `warehouse_id` (uuid), no por código. El código es una etiqueta
--   legible, no una clave foránea. Las 29.312 ubicaciones no se enteran.
--
--   Lo que SÍ cambia es lo que se ve: cabeceras, informes y cualquier captura
--   anterior dirá WH-001.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_id       uuid;
    v_ubic     int;
    v_nodos    int;
    v_afectado int;
BEGIN
    SELECT id INTO v_id FROM core.warehouses WHERE code = 'WH-001';

    IF v_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM core.warehouses WHERE code = 'OLO-CR') THEN
            RAISE NOTICE 'Ya estaba renombrado: OLO-CR existe y WH-001 no. Nada que hacer.';
            RETURN;
        END IF;
        RAISE EXCEPTION 'no existe ningun almacen con code = WH-001';
    END IF;

    IF EXISTS (SELECT 1 FROM core.warehouses WHERE code = 'OLO-CR' AND id <> v_id) THEN
        RAISE EXCEPTION 'ya existe OTRO almacen con code = OLO-CR: hay que resolverlo a mano';
    END IF;

    SELECT count(*) INTO v_ubic  FROM spatial.locations WHERE warehouse_id = v_id;
    SELECT count(*) INTO v_nodos FROM spatial.nodes     WHERE warehouse_id = v_id;

    UPDATE core.warehouses
       SET code       = 'OLO-CR',
           version    = version + 1,
           updated_at = now()
     WHERE id = v_id;
    GET DIAGNOSTICS v_afectado = ROW_COUNT;

    IF v_afectado <> 1 THEN
        RAISE EXCEPTION 'se esperaba 1 fila afectada, fueron %', v_afectado;
    END IF;

    -- Verificación: la estructura sigue colgando del mismo almacén.
    IF (SELECT count(*) FROM spatial.locations WHERE warehouse_id = v_id) <> v_ubic THEN
        RAISE EXCEPTION 'FALLO: cambio el numero de ubicaciones del almacen';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM core.warehouses WHERE code = 'OLO-CR' AND id = v_id) THEN
        RAISE EXCEPTION 'FALLO: el codigo no quedo aplicado';
    END IF;

    RAISE NOTICE '───────────────────────────────────────────────';
    RAISE NOTICE 'WH-001 → OLO-CR';
    RAISE NOTICE '  id:      %', v_id;
    RAISE NOTICE '  nombre:  % (sin cambios)',
        (SELECT name FROM core.warehouses WHERE id = v_id);
    RAISE NOTICE '  nodos:   %  ·  ubicaciones: %  (intactos)', v_nodos, v_ubic;
    RAISE NOTICE '───────────────────────────────────────────────';
END $$;
