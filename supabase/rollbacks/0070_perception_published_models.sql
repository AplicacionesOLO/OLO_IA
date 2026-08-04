-- ROLLBACK de 0070 · El catálogo de modelos publicados.
--
-- Sin destrucción de datos: es una vista de solo lectura sobre `ai`. Al quitarla,
-- el desplegable de modelos del módulo de percepción se queda sin fuente y la
-- pantalla tiene que decirlo —no puede caer en «no hay modelos», que sería una
-- afirmación sobre el catálogo y no sobre la vista que falta—.
DROP VIEW IF EXISTS perception.v_published_models;
