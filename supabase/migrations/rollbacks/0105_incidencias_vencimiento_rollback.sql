-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0105
--
-- Devuelve incidents.v_bandeja a su forma anterior (sin due_date) y quita la
-- columna y su CHECK. Se pierde cualquier vencimiento ya fijado.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW incidents.v_bandeja AS
SELECT
    i.id,
    i.warehouse_id,
    i.location_id,
    i.location_code,
    i.kind,
    i.subkind,
    i.status,
    i.title,
    i.details,
    i.resolution,
    i.created_at,
    i.resolved_at,
    floor(extract(epoch FROM coalesce(i.resolved_at, now()) - i.created_at) / 86400::numeric)::integer AS dias_abierta,
    i.assigned_to,
    (asignada.first_name::text || ' '::text) || asignada.last_name::text AS assigned_to_name,
    (abrio.first_name::text || ' '::text) || abrio.last_name::text AS opened_by_name,
    (cerro.first_name::text || ' '::text) || cerro.last_name::text AS resolved_by_name,
    i.source_snapshot_id,
    s.taken_at AS snapshot_taken_at
FROM incidents.incidents i
LEFT JOIN core.users asignada ON asignada.id = i.assigned_to
LEFT JOIN core.users abrio ON abrio.id = i.opened_by
LEFT JOIN core.users cerro ON cerro.id = i.resolved_by
LEFT JOIN inventory.wms_snapshots s ON s.id = i.source_snapshot_id;

ALTER TABLE incidents.incidents DROP CONSTRAINT IF EXISTS chk_inc_vencimiento_futuro;
ALTER TABLE incidents.incidents DROP COLUMN IF EXISTS due_date;

DO $$
BEGIN
    RAISE NOTICE 'OK - 0105 deshecha. incidents.incidents ya no tiene due_date.';
END $$;
