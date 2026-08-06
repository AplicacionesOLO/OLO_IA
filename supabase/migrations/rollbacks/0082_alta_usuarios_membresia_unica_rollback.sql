-- Rollback de 0082.
--
-- Igual que la 0081: la 0082 solo reemplaza el cuerpo de `core.alta_usuario_invitado`.
-- No crea ni borra ningún objeto, así que no hay nada que deshacer, y volver a la
-- versión anterior sería volver a tres defectos conocidos:
--
--   · el usuario nacía `pending`, y el hook de 0016 exige `active` para poner el
--     `tenant_id` en el JWT: la persona entraba y no podía abrir ninguna pantalla
--   · no miraba `uq_membership_one_active_per_user`, así que invitar a alguien que ya
--     trabaja para otro operador reventaba con una violación de unicidad
--   · ponía `is_default = true` a ciegas, contra `uq_membership_one_default`
--
-- Para deshacer el alta de usuarios se revierte la 0080, cuyo rollback quita las dos
-- funciones y con ellas todos estos arreglos.

DO $$
BEGIN
    RAISE EXCEPTION
        'La 0082 solo corrige el cuerpo de core.alta_usuario_invitado. Revertirla '
        'restauraria una version con tres defectos conocidos. Para deshacer el alta de '
        'usuarios, aplica rollbacks/0080_alta_usuarios_rollback.sql.';
END $$;
