-- ═══════════════════════════════════════════════════════════════════════════════
-- 0090 · «Leí el código y no está en el catálogo» deja de decirse «no pude leerlo»
--
-- ── EL PROBLEMA, VISTO EN UN RECORRIDO REAL ───────────────────────────────────
--
-- `v_reconciliation` metía en `location_qr_unreadable` dos situaciones sin nada que ver:
--
--   · `location_qr = 'unreadable'` → la etiqueta estaba y no se pudo leer. Problema de
--     CAPTURA: la respuesta es volver a grabar más cerca o más quieto.
--   · código LEÍDO y `location_id IS NULL` → se leyó perfectamente y el catálogo no conoce
--     ese código. Problema de CATÁLOGO o de ETIQUETADO: la respuesta es dar de alta la
--     ubicación o corregir la etiqueta. Volver a grabar no arregla nada.
--
-- La pantalla decía «no se leyó el código del hueco» de un código leído tres veces, con su
-- QR decodificado y el texto impreso coincidiendo. Quien lo miraba concluía, con toda
-- lógica, que el sistema fallaba — cuando lo que había encontrado era una etiqueta real que
-- ningún sistema del almacén conoce.
--
-- Caso medido: `RACK26-C036-N01-1`, decodificada en tres recortes distintos del mismo
-- recorrido, con CERO coincidencias entre las 29.310 ubicaciones del catálogo y las 41.055
-- filas del corte del WMS. Y aparecía en el mismo fotograma que `RCL47-C019-N01-1` y
-- `RCL47-C019-N01-2`: pegada junto a ellas en el mismo montante.
--
-- ── LO QUE CAMBIA ─────────────────────────────────────────────────────────────
--
-- Un estado nuevo, `location_unknown`, para el segundo caso. El primero se queda igual.
-- Ninguna fila cambia de significado: se parte un estado que mezclaba dos cosas.
--
-- El cuerpo de la vista es el que estaba en la base —volcado con `pg_get_viewdef`— con la
-- rama nueva delante. Reconstruirlo del archivo de 0064 habría perdido lo que migraciones
-- posteriores le añadieron: `low_confidence` no está en el original, y el primer intento de
-- esta migración falló por eso.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW inventory.v_reconciliation
WITH (security_invoker = true) AS
SELECT r.id AS reading_id,
    r.scan_id,
    r.tenant_id,
    r.warehouse_id,
    r.location_id,
    COALESCE(l.code, r.location_code_observed) AS location_code,
    l.logical_x,
    l.logical_y,
    l.logical_z,
    r.location_qr,
    r.content,
    r.pallet_qr,
    r.pallet_code_observed,
    r.location_confidence,
    r.content_confidence,
    r.pallet_confidence,
    r.image_id,
    r.observed_at,
    e.n AS expected_rows,
    e.pallet_codes AS expected_pallets,
        CASE
            WHEN e.n = 1 THEN e.pallet_codes[1]
            ELSE NULL::character varying
        END AS expected_pallet,
    e.client_ids AS expected_clients,
        CASE
            WHEN array_length(e.client_ids, 1) = 1 THEN e.client_ids[1]
            ELSE NULL::uuid
        END AS expected_client,
    e.skus AS expected_skus,
    COALESCE(e.n, 0::bigint) > 0 AS wms_expects_pallet,
        CASE
            WHEN r.location_id IS NULL AND r.location_qr::text = 'read'::text THEN 'location_unknown'::text
            WHEN r.location_id IS NULL OR r.location_qr::text = 'unreadable'::text THEN 'location_qr_unreadable'::text
            WHEN r.content::text = 'obstructed'::text THEN 'obstructed'::text
            WHEN r.content::text = 'unknown'::text THEN 'not_scanned'::text
            WHEN r.content::text = 'empty'::text AND COALESCE(e.n, 0::bigint) = 0 THEN 'verified_empty'::text
            WHEN r.content::text = 'empty'::text THEN 'unexpected_empty'::text
            WHEN r.content::text = 'object_no_qr'::text OR (r.pallet_qr::text = ANY (ARRAY['unreadable'::character varying, 'absent'::character varying]::text[])) THEN 'pallet_without_qr'::text
            WHEN r.pallet_qr::text = 'read'::text AND COALESCE(e.n, 0::bigint) = 0 THEN 'unexpected_pallet'::text
            WHEN r.pallet_qr::text = 'read'::text AND (r.pallet_code_observed::text = ANY (e.pallet_codes::text[])) THEN 'verified_match'::text
            WHEN r.pallet_qr::text = 'read'::text THEN 'unexpected_pallet'::text
            ELSE 'manual_review'::text
        END AS status,
    COALESCE(r.content_confidence, 1::real) < 0.60::double precision OR COALESCE(r.pallet_confidence, 1::real) < 0.60::double precision AS low_confidence
   FROM inventory.readings r
     JOIN inventory.scans s ON s.id = r.scan_id
     LEFT JOIN spatial.locations l ON l.id = r.location_id
     LEFT JOIN LATERAL ( SELECT count(*) AS n,
            array_agg(DISTINCT w.pallet_code) FILTER (WHERE w.pallet_code IS NOT NULL) AS pallet_codes,
            array_agg(DISTINCT w.client_id) FILTER (WHERE w.client_id IS NOT NULL) AS client_ids,
            array_agg(DISTINCT w.sku) FILTER (WHERE w.sku IS NOT NULL) AS skus
           FROM inventory.wms_stock w
          WHERE w.snapshot_id = s.wms_snapshot_id AND w.location_id = r.location_id) e ON r.location_id IS NOT NULL;

COMMENT ON VIEW inventory.v_reconciliation IS
    'Estado por ubicacion, DERIVADO de los tres ejes observados contra lo declarado. '
    '`location_unknown` distingue «se leyo y el catalogo no lo tiene» de «no se pudo leer»: '
    'uno se arregla dando de alta la ubicacion, el otro volviendo a grabar.';

GRANT SELECT ON inventory.v_reconciliation TO olo_app, authenticated;

DO $$
DECLARE
    v_desconocidas int;
    v_ilegibles int;
BEGIN
    SELECT count(*) INTO v_desconocidas
      FROM inventory.v_reconciliation WHERE status = 'location_unknown';

    -- Una lectura que NO se pudo leer tiene que seguir diciendo lo de siempre: la rama
    -- nueva solo puede llevarse las que SI se leyeron.
    SELECT count(*) INTO v_ilegibles
      FROM inventory.v_reconciliation
     WHERE location_qr = 'unreadable' AND status <> 'location_qr_unreadable';
    IF v_ilegibles > 0 THEN
        RAISE EXCEPTION 'la rama nueva se llevo % lectura(s) ilegibles', v_ilegibles;
    END IF;

    -- Y ninguna atribuida puede haber caido en el estado nuevo.
    IF EXISTS (
        SELECT 1 FROM inventory.v_reconciliation
         WHERE status = 'location_unknown' AND location_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'una lectura CON hueco se clasifico como desconocida';
    END IF;

    RAISE NOTICE 'OK · % lectura(s) pasan a «codigo leido, hueco desconocido»', v_desconocidas;
END $$;
