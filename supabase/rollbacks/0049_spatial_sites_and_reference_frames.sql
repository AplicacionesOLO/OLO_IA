-- ROLLBACK de 0049_spatial_sites_and_reference_frames.sql
--
-- SIN `CASCADE`. `reference_frames` primero: `sites` es su destino de FK, y
-- borrarla antes fallaría. Si el DROP de `sites` falla, significa que hay una
-- migración posterior sin revertir —0050 cuelga `nodes` de `sites`— y ese fallo
-- es la señal deseada.
--
-- Los triggers, índices, políticas y grants desaparecen con la tabla: no hace
-- falta borrarlos por separado, y hacerlo enmascararía un DROP que no ocurrió.

DROP TABLE spatial.reference_frames;
DROP TABLE spatial.sites;


-- ── Verificación ───────────────────────────────────────────────────────────
DO $$
DECLARE
    v_tab int;
    v_pol int;
    v_trg int;
BEGIN
    SELECT count(1) INTO v_tab FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'spatial' AND c.relname IN ('sites', 'reference_frames');
    IF v_tab <> 0 THEN RAISE EXCEPTION 'quedan % tabla(s) de 0049', v_tab; END IF;

    SELECT count(1) INTO v_pol FROM pg_policies
     WHERE schemaname = 'spatial' AND tablename IN ('sites', 'reference_frames');
    IF v_pol <> 0 THEN RAISE EXCEPTION 'quedan % politica(s) huerfana(s)', v_pol; END IF;

    SELECT count(1) INTO v_trg FROM pg_trigger t JOIN pg_class ct ON ct.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = ct.relnamespace
     WHERE n.nspname = 'spatial' AND ct.relname IN ('sites', 'reference_frames')
       AND NOT t.tgisinternal;
    IF v_trg <> 0 THEN RAISE EXCEPTION 'quedan % trigger(s) huerfano(s)', v_trg; END IF;

    -- Lo de 0048 sigue intacto: este rollback no debe tocarlo.
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'spatial' AND c.relname = 'locations') THEN
        RAISE EXCEPTION 'spatial.locations desaparecio: este rollback no debe tocar 0048';
    END IF;

    RAISE NOTICE
        'OK rollback 0049: sin sites ni reference_frames, sin politicas ni triggers huerfanos, 0048 intacta';
END
$$;
