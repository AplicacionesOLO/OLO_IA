-- ═══════════════════════════════════════════════════════════════════════════════
-- Rollback de 0090 · vuelve a mezclar «no se pudo leer» con «no está en el catálogo»
--
-- Deshacer esto NO rompe nada, pero devuelve a la pantalla una mentira concreta: dirá «no se
-- leyó el código del hueco» de códigos que se leyeron perfectamente y que el catálogo no
-- conoce. Son 51 lecturas en los datos actuales, y las dos situaciones piden acciones
-- opuestas — una, volver a grabar; la otra, dar de alta la ubicación—.
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

GRANT SELECT ON inventory.v_reconciliation TO olo_app, authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM inventory.v_reconciliation WHERE status = 'location_unknown') THEN
        RAISE EXCEPTION 'el estado nuevo sigue apareciendo';
    END IF;
    RAISE NOTICE 'OK · vuelta atras: los dos casos se mezclan otra vez';
END $$;
