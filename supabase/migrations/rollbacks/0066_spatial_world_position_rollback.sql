-- ══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK 0066 · quita la derivación de world_position
--
-- Se puede deshacer sin pérdida IRREPARABLE, y esa es la diferencia con el
-- rollback de 0065: aquella migración guardaba la colocación de los racks, que
-- ninguna importación puede regenerar porque el DWG del almacén no contiene los
-- códigos del WMS. Esta guarda una geometría CALCULADA a partir de esa colocación,
-- así que mientras `spatial.rack_placements` siga en pie basta con volver a
-- publicar el layout para tenerla otra vez.
--
-- ── QUÉ SE BORRA Y QUÉ NO ────────────────────────────────────────────────────
--
-- Se borra SOLO lo que cuelga del marco de esta migración —el que lleva
-- `provenance.migration = '0066'`—. Si algún día existe un levantamiento CAD real,
-- sus filas colgarán de otro marco y este script no las toca: deshacer una
-- migración no debería destruir datos medidos con instrumentos.
--
-- `origin` no se modifica en ningún caso. 0066 tampoco lo modificaba: dice de dónde
-- salió la UBICACIÓN, no de dónde salió su geometría.
--
-- El marco de referencia del layout se borra DESPUÉS de las coordenadas, porque
-- `fk_loc_frame` lo exige y porque el orden inverso dejaría filas apuntando a un
-- marco inexistente durante la transacción.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1 · Limpiar la geometría derivada ──────────────────────────────────────
DO $$
DECLARE v_filas bigint;
BEGIN
    SELECT count(*) INTO v_filas
      FROM spatial.locations l
      JOIN spatial.reference_frames f ON f.id = l.world_frame_id
     WHERE l.world_position IS NOT NULL
       AND f.provenance ->> 'migration' = '0066';

    IF v_filas > 0 THEN
        RAISE NOTICE 'se limpian % ubicaciones con geometria derivada (recuperable republicando el layout)', v_filas;
    END IF;

    UPDATE spatial.locations l
       SET world_frame_id = NULL,
           world_position = NULL
     WHERE l.world_position IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM spatial.reference_frames f
            WHERE f.id = l.world_frame_id
              AND f.provenance ->> 'migration' = '0066'
       );
END $$;

-- ── 2 · El índice espacial ─────────────────────────────────────────────────
-- Vuelve al estado de 0052, que se negó a crearlo con la columna al 100 % NULL.
DROP INDEX IF EXISTS spatial.idx_loc_world_position;

-- ── 3 · Las funciones ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS spatial.clear_derived_world_positions(uuid);
DROP FUNCTION IF EXISTS spatial.derive_world_positions(uuid);
DROP FUNCTION IF EXISTS spatial.ensure_layout_frame(uuid);

-- ── 4 · Los marcos que creó esta migración ─────────────────────────────────
-- Se identifican por su `provenance`, no por el código: si mañana alguien crea un
-- marco a mano con un nombre parecido, este script no debe llevárselo.
DELETE FROM spatial.reference_frames
 WHERE provenance ->> 'migration' = '0066';

-- ── 5 · Verificación ───────────────────────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
    SELECT count(*) INTO v
      FROM spatial.locations l
      JOIN spatial.reference_frames f ON f.id = l.world_frame_id
     WHERE l.world_position IS NOT NULL AND f.provenance ->> 'migration' = '0066';
    IF v <> 0 THEN
        RAISE EXCEPTION 'quedan % ubicaciones derivadas sin limpiar', v;
    END IF;

    SELECT count(*) INTO v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'spatial'
       AND p.proname IN ('ensure_layout_frame', 'derive_world_positions',
                         'clear_derived_world_positions');
    IF v <> 0 THEN
        RAISE EXCEPTION 'quedan % funciones de 0066', v;
    END IF;

    RAISE NOTICE 'rollback 0066 OK';
END $$;
