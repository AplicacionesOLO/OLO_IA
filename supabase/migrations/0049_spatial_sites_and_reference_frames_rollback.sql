-- ═══════════════════════════════════════════════════════════════════════════
-- 0049_spatial_sites_and_reference_frames_rollback.sql
-- Revierte : 0049 · `spatial.sites` y `spatial.reference_frames`
--
-- Reversión limpia si no hay nada colgando. `spatial.nodes` referencia `sites`
-- (0050) y `spatial.locations` referencia `reference_frames` por
-- `world_frame_id` (0052), así que hay que revertir esas dos antes. La
-- comprobación lo nombra en lugar de dejar el error genérico.
--
-- `reference_frames` está VACÍA por diseño —ningún levantamiento métrico se ha
-- hecho, y vacía es un estado válido (SPA-09)— así que eliminarla no pierde nada.
-- `sites` sí tiene la fila `DEFAULT` que creó el importador.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_dep text; v_sitios int; v_marcos int;
BEGIN
    SELECT string_agg(DISTINCT origen.relname, ', ' ORDER BY origen.relname) INTO v_dep
      FROM pg_constraint c
      JOIN pg_class origen  ON origen.oid = c.conrelid
      JOIN pg_class destino ON destino.oid = c.confrelid
      JOIN pg_namespace n   ON n.oid = destino.relnamespace
     WHERE c.contype = 'f' AND n.nspname = 'spatial'
       AND destino.relname IN ('sites', 'reference_frames')
       AND origen.relname NOT IN ('sites', 'reference_frames');
    IF v_dep IS NOT NULL THEN
        RAISE EXCEPTION
            'No se puede revertir 0049: % referencia(n) a sites o reference_frames. '
            'Revierta primero las migraciones posteriores (0050 crea nodes con '
            'site_id; 0052 anade locations.world_frame_id).', v_dep;
    END IF;

    SELECT count(1) INTO v_sitios FROM spatial.sites;
    SELECT count(1) INTO v_marcos FROM spatial.reference_frames;
    IF v_sitios > 0 OR v_marcos > 0 THEN
        RAISE WARNING 'rollback 0049: se eliminan % sitio(s) y % marco(s)',
                      v_sitios, v_marcos;
    END IF;
END
$$;

-- `reference_frames` primero: su `parent_frame_id` es autorreferencial y su
-- `site_id` apunta a `sites`.
DROP TABLE IF EXISTS spatial.reference_frames;
DROP TABLE IF EXISTS spatial.sites;

DO $$
DECLARE v_n int;
BEGIN
    SELECT count(1) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname IN ('sites', 'reference_frames');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % tabla(s) de 0049', v_n; END IF;

    SELECT count(1) INTO v_n FROM pg_policies
     WHERE schemaname = 'spatial' AND tablename IN ('sites', 'reference_frames');
    IF v_n <> 0 THEN RAISE EXCEPTION 'quedan % politica(s) huerfana(s)', v_n; END IF;

    RAISE NOTICE 'OK rollback 0049: sites y reference_frames eliminadas '
                 '(marcos primero, por la FK) · sin politicas huerfanas';
END
$$;
