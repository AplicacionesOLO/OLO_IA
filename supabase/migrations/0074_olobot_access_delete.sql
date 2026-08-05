-- ══════════════════════════════════════════════════════════════════════════════
-- 0074 · Retirar el acceso a OLOBOT tenía endpoint pero no privilegio
--
-- `DELETE /v1/olobot/access/{user_id}` existía, el servicio lo implementaba y RLS lo
-- permitía. Lo que faltaba era el GRANT: 0073 dio a `olo_app` SELECT, INSERT y UPDATE
-- sobre `olobot.access`, y no DELETE.
--
-- ── POR QUÉ SE ESCAPÓ ──────────────────────────────────────────────────────
--
-- Porque en 0073 el DELETE se negó a propósito en `messages` y en `actions` —un
-- historial que se puede borrar fila a fila no es un historial, y un registro de
-- auditoría que el auditado puede vaciar no audita nada—, y `access` heredó la misma
-- lista de privilegios sin que nadie se preguntara si le correspondía.
--
-- No le corresponde. `access` no es un registro de lo que pasó: es el estado actual de
-- quién tiene asistente. Retirárselo a alguien que cambia de puesto es una operación
-- normal, y lo que queda registrado de ella es otra cosa —el `granted_by` de la
-- siguiente concesión, y la fila que desaparece de la lista—.
--
-- Lo encontró la verificación de punta a punta: el paso que devolvía el nivel a su
-- valor anterior no lo devolvía, y el usuario seguía con `supervisor` después de que
-- la prueba dijera que lo había quitado. Un endpoint que responde y no hace nada es
-- peor que uno que no existe.
-- ══════════════════════════════════════════════════════════════════════════════

GRANT DELETE ON olobot.access TO olo_app;

-- Las otras tres siguen sin DELETE, y esta vez está dicho en voz alta:
--
--   olobot.conversations  se retira con `deleted_at`, que conserva lo que se dijo
--   olobot.messages       nunca; el historial no se edita
--   olobot.actions        nunca; es el registro de auditoría

DO $$
DECLARE
    v_access  integer;
    v_otras   integer;
BEGIN
    SELECT count(*) INTO v_access
      FROM information_schema.role_table_grants
     WHERE table_schema = 'olobot' AND table_name = 'access'
       AND grantee = 'olo_app' AND privilege_type = 'DELETE';
    IF v_access <> 1 THEN
        RAISE EXCEPTION 'olo_app sigue sin poder borrar en olobot.access';
    END IF;

    -- Y que el arreglo no se haya llevado por delante la decisión de 0073.
    SELECT count(*) INTO v_otras
      FROM information_schema.role_table_grants
     WHERE table_schema = 'olobot'
       AND table_name IN ('messages', 'actions', 'conversations')
       AND grantee = 'olo_app' AND privilege_type = 'DELETE';
    IF v_otras <> 0 THEN
        RAISE EXCEPTION
            'alguien concedio DELETE sobre el historial o la auditoria: % grants', v_otras;
    END IF;

    RAISE NOTICE '0074 OK · access se puede retirar; el historial y la auditoria siguen sin DELETE';
END $$;
