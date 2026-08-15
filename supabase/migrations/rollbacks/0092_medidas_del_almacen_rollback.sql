-- ═══════════════════════════════════════════════════════════════════════════════
-- Rollback de 0092 · borra las medidas del almacén
--
-- ⚠ Esto SÍ pierde datos, y son de los caros: alguien fue con una cinta métrica. Deshacer
-- esto no se recupera consultando otra tabla ni volviendo a analizar un vídeo — hay que
-- volver a medir el almacén.
--
-- Se imprime cuántas filas se van antes de irse.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    v_filas int;
    v_medidas int;
BEGIN
    SELECT count(*) INTO v_filas FROM spatial.warehouse_metrics WHERE deleted_at IS NULL;
    SELECT COALESCE(sum(medidas_tomadas), 0) INTO v_medidas FROM spatial.v_warehouse_metrics;
    RAISE NOTICE 'Se borran % fila(s) con % medida(s) tomadas. Recuperarlas exige volver '
                 'a medir el almacen.', v_filas, v_medidas;
END $$;

DROP VIEW IF EXISTS spatial.v_warehouse_metrics;
DROP TABLE IF EXISTS spatial.warehouse_metrics;

DO $$
BEGIN
    RAISE NOTICE 'OK · vuelta atras: el visor se queda solo con sus convenciones';
END $$;
