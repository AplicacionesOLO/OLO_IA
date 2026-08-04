-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK 0067 · quita las observaciones de racks
--
-- ── LO QUE SE PIERDE, Y ES IRRECUPERABLE ─────────────────────────────────────
--
-- Las observaciones. Cada una es un hecho que ocurrió una vez —«a las 14:03 el dron
-- vio el rack MZ04»— y no se puede volver a observar: el momento pasó. A diferencia
-- de la geometría derivada de 0066, que se recalcula republicando el layout, esto no
-- se regenera desde ningún sitio.
--
-- Por eso el script EXPORTA antes de borrar, igual que el rollback de 0065 hace con
-- la colocación. El volcado sale por NOTICE en JSON y se puede volver a ingerir por
-- el endpoint —la ingesta es idempotente, así que reponer un vuelo dos veces no lo
-- duplica— siempre que 0067 se vuelva a aplicar.
--
-- El volcado se acota a 20.000 filas: por encima, un NOTICE de decenas de megas no
-- llega al operador de forma útil y el aviso dice cuántas se quedaron fuera. Si hay
-- más, hay que exportarlas con una consulta antes de ejecutar esto.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1 · Exportar lo que no se puede recuperar ──────────────────────────────
DO $$
DECLARE
    v_total  bigint;
    v_volcado jsonb;
BEGIN
    SELECT count(*) INTO v_total FROM spatial.rack_observations;
    IF v_total = 0 THEN
        RAISE NOTICE 'no hay observaciones que exportar';
        RETURN;
    END IF;

    SELECT jsonb_agg(fila) INTO v_volcado
      FROM (
        SELECT jsonb_build_object(
                   'warehouse_id', o.warehouse_id,
                   'source_code',  s.code,
                   'source_kind',  s.kind,
                   'rack_code',    n.node_code,
                   'rack_node_id', o.rack_node_id,
                   'observed_at',  o.observed_at,
                   'confidence',   o.confidence,
                   'frame_ref',    o.frame_ref,
                   'frame_ms',     o.frame_ms,
                   'notes',        o.notes
               ) AS fila
          FROM spatial.rack_observations o
          JOIN spatial.observation_sources s ON s.id = o.source_id
          JOIN spatial.nodes n ON n.id = o.rack_node_id
         ORDER BY s.code, o.observed_at
         LIMIT 20000
      ) t;

    RAISE NOTICE 'EXPORTACION de % observaciones (se vuelcan hasta 20.000):', v_total;
    RAISE NOTICE '%', jsonb_pretty(v_volcado);
    IF v_total > 20000 THEN
        RAISE WARNING '% observaciones NO se han volcado: exportalas antes de continuar',
            v_total - 20000;
    END IF;
END $$;

-- ── 2 · Vistas ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS spatial.v_rack_observations;
DROP VIEW IF EXISTS spatial.v_observation_route;

-- ── 3 · Tablas ─────────────────────────────────────────────────────────────
-- Las observaciones primero: tienen FK contra las fuentes.
DROP TABLE IF EXISTS spatial.rack_observations;
DROP TABLE IF EXISTS spatial.observation_sources;

-- ── 4 · Permisos ───────────────────────────────────────────────────────────
-- `role_permissions` antes que `permissions`: la FK va en esa dirección.
DELETE FROM core.role_permissions
 WHERE permission_code IN ('observations:read', 'observations:write');
DELETE FROM core.permissions
 WHERE code IN ('observations:read', 'observations:write');

-- ── 5 · Verificación ───────────────────────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
    SELECT count(*) INTO v FROM information_schema.tables
     WHERE table_schema = 'spatial'
       AND table_name IN ('observation_sources', 'rack_observations');
    IF v <> 0 THEN
        RAISE EXCEPTION 'quedan % tablas de 0067', v;
    END IF;

    SELECT count(*) INTO v FROM core.permissions
     WHERE code LIKE 'observations:%';
    IF v <> 0 THEN
        RAISE EXCEPTION 'quedan % permisos de observations', v;
    END IF;

    RAISE NOTICE 'rollback 0067 OK';
END $$;
