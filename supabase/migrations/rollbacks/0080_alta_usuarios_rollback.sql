-- Rollback de 0080 · alta de usuarios por invitación.
--
-- Quita las dos funciones. NO borra los usuarios ni las membresías que se hayan
-- creado con ellas: son personas con acceso al producto, y quitarlas aquí las
-- dejaría fuera sin que nadie lo pidiera. Si hay que dar de baja a alguien, se hace
-- por la pantalla de Configuración —o con un UPDATE de `status`—, no revirtiendo una
-- migración.
--
-- ⚠ `core.tiene_permiso` la usa el backend desde `security/authorization.py`. Al
--   quitarla, `require_permission` falla en TODA escritura hasta que se despliegue
--   el código que trae otra vez la CTE en Python. Los dos pasos van juntos.

DROP FUNCTION IF EXISTS core.alta_usuario_invitado(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS core.tiene_permiso(text, uuid);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'core'
           AND p.proname IN ('tiene_permiso', 'alta_usuario_invitado')
    ) THEN
        RAISE EXCEPTION 'Quedan funciones de 0080 sin borrar';
    END IF;
    RAISE NOTICE 'OK · 0080 revertida';
END $$;
