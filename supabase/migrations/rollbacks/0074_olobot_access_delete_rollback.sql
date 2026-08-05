-- Rollback de 0074. Deja `DELETE /v1/olobot/access/{user_id}` sin privilegio otra vez:
-- el endpoint responderá y no hará nada. Solo tiene sentido si se retira 0073 entera.
REVOKE DELETE ON olobot.access FROM olo_app;
