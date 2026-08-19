-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 0101
--
-- Se quita el CHECK y se devuelven los nombres y colores a como estaban. Devolver las
-- mayusculas es volver al estado anterior, no una mejora: con ellas, las comparaciones
-- del worker vuelven a no casar en silencio.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE ai.classes DROP CONSTRAINT IF EXISTS chk_class_name_canonico;

UPDATE ai.classes SET name = 'Larguero', color = '#FFFFFF', updated_at = now()
 WHERE name = 'larguero';

UPDATE ai.classes SET name = 'Paral', color = '#280193', updated_at = now()
 WHERE name = 'paral';

DO $$
BEGIN
    RAISE NOTICE 'OK - 0101 deshecha. Las comparaciones exactas del worker vuelven a '
                 'poder fallar en silencio con estas dos clases.';
END $$;
