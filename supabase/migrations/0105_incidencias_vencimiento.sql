-- ═══════════════════════════════════════════════════════════════════════════════
-- 0105 · Vencimiento de una incidencia (SLA minimo)
--
-- Crea     : incidents.incidents.due_date + CHECK, actualiza incidents.v_bandeja
-- Depende de: 0083 (incidents.incidents, incidents.v_bandeja)
-- Riesgo   : bajo — columna nueva NULL, la vista solo GANA una columna al final
--
-- ── LO QUE ESTO NO ES ────────────────────────────────────────────────────────
--
-- No hay escalamiento automatico ni notificacion por vencimiento en esta
-- migracion. Fijar una politica de SLA por defecto —cuantos dias, por tipo de
-- incidencia, quien se entera— es una decision de producto que no se puede
-- adivinar sin datos de uso reales, y automatizarla mal seria peor que no
-- automatizarla: un plazo por defecto equivocado se lee como que el sistema
-- decidio algo que nadie decidio. `due_date` es NULL por omision, opcional, y
-- lo fija una persona; el "esto esta vencida" se resuelve en la pantalla
-- comparando con `now()`, no aqui.
--
-- ── POR QUE NO ES UNA TABLA APARTE ───────────────────────────────────────────
--
-- Un vencimiento es un atributo de la incidencia, no un evento de su historial
-- ni una entidad con vida propia: no versiona, no tiene su propio ciclo de
-- estado, y preguntar "cual es el vencimiento de esta incidencia" no deberia
-- necesitar un JOIN.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE incidents.incidents
    ADD COLUMN due_date timestamptz NULL;

ALTER TABLE incidents.incidents
    ADD CONSTRAINT chk_inc_vencimiento_futuro
    CHECK (due_date IS NULL OR due_date >= created_at);

COMMENT ON COLUMN incidents.incidents.due_date IS
    'Vencimiento opcional, lo fija una persona. NULL = sin plazo. "Vencida" se calcula en la pantalla comparando con now(), no hay columna derivada.';

-- La vista solo GANA `due_date` al final de la lista de columnas: es la unica
-- forma de CREATE OR REPLACE VIEW sin romper columnas existentes ni sus permisos.
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
    s.taken_at AS snapshot_taken_at,
    i.due_date
FROM incidents.incidents i
LEFT JOIN core.users asignada ON asignada.id = i.assigned_to
LEFT JOIN core.users abrio ON abrio.id = i.opened_by
LEFT JOIN core.users cerro ON cerro.id = i.resolved_by
LEFT JOIN inventory.wms_snapshots s ON s.id = i.source_snapshot_id;


-- ── Verificación ────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_tiene_columna boolean;
    v_vista_ok      boolean;
    v_rechaza       boolean := false;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'incidents' AND table_name = 'incidents'
           AND column_name = 'due_date' AND data_type = 'timestamp with time zone'
    ) INTO v_tiene_columna;
    IF NOT v_tiene_columna THEN
        RAISE EXCEPTION 'falta incidents.incidents.due_date (timestamptz)';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'incidents' AND table_name = 'v_bandeja'
           AND column_name = 'due_date'
    ) INTO v_vista_ok;
    IF NOT v_vista_ok THEN
        RAISE EXCEPTION 'incidents.v_bandeja no expone due_date';
    END IF;

    -- El CHECK rechaza un vencimiento anterior a la apertura. Se prueba solo si
    -- hay alguna fila real: sin ninguna, no hay sobre que probarlo.
    IF NOT EXISTS (SELECT 1 FROM incidents.incidents) THEN
        RAISE NOTICE 'sin ninguna incidencia todavia; se omite la prueba del CHECK';
    ELSE
        BEGIN
            UPDATE incidents.incidents
               SET due_date = created_at - interval '1 day'
             WHERE id = (SELECT id FROM incidents.incidents LIMIT 1);
            RAISE EXCEPTION 'el CHECK admitio un vencimiento anterior a la apertura';
        EXCEPTION
            WHEN check_violation THEN
                v_rechaza := true;
        END;
        IF NOT v_rechaza THEN
            RAISE EXCEPTION 'chk_inc_vencimiento_futuro no se disparo como se esperaba';
        END IF;
    END IF;

    RAISE NOTICE '0105 OK - due_date existe, la vista lo expone, y el CHECK rechaza vencimientos anteriores a la apertura';
END $$;
