-- Rollback de 0075. Los servicios volverían a decir que no hay workers, que era la
-- respuesta correcta antes de esto: no rompe nada, solo deja de poder ser cierto.
DROP FUNCTION IF EXISTS core.worker_esta_vivo(text);
DROP TABLE IF EXISTS core.workers;
