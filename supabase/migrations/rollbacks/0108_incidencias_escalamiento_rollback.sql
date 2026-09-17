-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0108
--
-- Devuelve incidents.v_bandeja a su forma anterior (sin overdue_notified_at) y
-- quita la columna y su CHECK. Se pierde el registro de que ya se avisó de un
-- vencimiento.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW incidents.v_bandeja AS
 SELECT i.id,
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
    floor(EXTRACT(epoch FROM COALESCE(i.resolved_at, now()) - i.created_at) / 86400::numeric)::integer AS dias_abierta,
    i.assigned_to,
    (asignada.first_name::text || ' '::text) || asignada.last_name::text AS assigned_to_name,
    (abrio.first_name::text || ' '::text) || abrio.last_name::text AS opened_by_name,
    (cerro.first_name::text || ' '::text) || cerro.last_name::text AS resolved_by_name,
    i.source_snapshot_id,
    s.taken_at AS snapshot_taken_at,
    i.due_date
   FROM incidents.incidents i
     LEFT JOIN core.users asignada ON asignada.id = i.assigned_to
     LEFT JOIN core.users abrio ON abrio.id = i.opened_by
     LEFT JOIN core.users cerro ON cerro.id = i.resolved_by
     LEFT JOIN inventory.wms_snapshots s ON s.id = i.source_snapshot_id;

ALTER TABLE incidents.incidents DROP CONSTRAINT IF EXISTS chk_inc_overdue_requiere_plazo;
ALTER TABLE incidents.incidents DROP COLUMN IF EXISTS overdue_notified_at;

DO $$
BEGIN
    RAISE NOTICE 'OK - 0108 deshecha. incidents.incidents ya no tiene overdue_notified_at.';
END $$;
