-- ═══════════════════════════════════════════════════════════════════════════
-- 0108_incidencias_escalamiento.sql
-- Altera    : incidents.incidents (columna aditiva), incidents.v_bandeja
-- Depende de: 0083 (incidencias), 0104 (notificaciones), 0105 (due_date)
-- Riesgo    : bajo
--
-- 0105 dejó dicho, a propósito, que no hay política de SLA por defecto ni
-- escalamiento automático — porque adivinar un plazo que nadie fijó sería el
-- sistema decidiendo algo que le tocaba decidir a una persona. Esto NO es eso:
-- `due_date` ya lo fija una persona explícitamente, y `overdue_notified_at`
-- solo evita avisar dos veces del MISMO vencimiento — no inventa ningún plazo,
-- no cierra nada, no cambia ningún estado.
--
-- Se resetea a NULL cada vez que `due_date` cambia (mismo UPDATE, en
-- `fijar_vencimiento`): un plazo movido es un vencimiento distinto, y merece
-- poder avisar otra vez si el nuevo también se pasa.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE incidents.incidents
    ADD COLUMN overdue_notified_at timestamptz NULL;

COMMENT ON COLUMN incidents.incidents.overdue_notified_at IS
    'Cuando se avisó por última vez de que esta incidencia pasó su due_date. Se limpia cada vez que due_date cambia. NULL = no se ha avisado de este vencimiento.';

ALTER TABLE incidents.incidents
    ADD CONSTRAINT chk_inc_overdue_requiere_plazo
    CHECK (overdue_notified_at IS NULL OR due_date IS NOT NULL);

-- La vista se reemplaza con la MISMA definición más la columna nueva al final,
-- para no romper el orden de columnas de quien ya consulta v_bandeja.
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
    i.due_date,
    i.overdue_notified_at
   FROM incidents.incidents i
     LEFT JOIN core.users asignada ON asignada.id = i.assigned_to
     LEFT JOIN core.users abrio ON abrio.id = i.opened_by
     LEFT JOIN core.users cerro ON cerro.id = i.resolved_by
     LEFT JOIN inventory.wms_snapshots s ON s.id = i.source_snapshot_id;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_columna boolean;
    v_vista   boolean;
    v_rechazo boolean := false;
    v_id      uuid;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'incidents' AND table_name = 'incidents'
           AND column_name = 'overdue_notified_at'
    ) INTO v_columna;
    IF NOT v_columna THEN
        RAISE EXCEPTION 'falta incidents.incidents.overdue_notified_at';
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'incidents' AND table_name = 'v_bandeja'
           AND column_name = 'overdue_notified_at'
    ) INTO v_vista;
    IF NOT v_vista THEN
        RAISE EXCEPTION 'v_bandeja no expone overdue_notified_at';
    END IF;

    -- El CHECK rechaza marcar un aviso sin plazo. Se prueba contra una fila
    -- real si hay alguna; si no hay ninguna incidencia todavía, se omite.
    SELECT id INTO v_id FROM incidents.incidents WHERE due_date IS NULL LIMIT 1;
    IF v_id IS NOT NULL THEN
        BEGIN
            UPDATE incidents.incidents SET overdue_notified_at = now() WHERE id = v_id;
        EXCEPTION WHEN check_violation THEN
            v_rechazo := true;
        END;
        IF NOT v_rechazo THEN
            RAISE EXCEPTION 'el CHECK admitio un aviso de vencimiento sin due_date';
        END IF;
        -- Deshacer el intento (por si el EXCEPTION no bastara para revertirlo).
        UPDATE incidents.incidents SET overdue_notified_at = NULL WHERE id = v_id;
    ELSE
        RAISE NOTICE 'sin incidencias sin due_date para probar el CHECK; se omite esa parte';
    END IF;

    RAISE NOTICE 'OK 0108: overdue_notified_at en la tabla y en v_bandeja, CHECK probado';
END
$$;
