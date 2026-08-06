-- Rollback de 0081.
--
-- La 0081 no crea ni borra nada: solo reemplaza el cuerpo de
-- `core.alta_usuario_invitado` para quitar una referencia ambigua que hacía que la
-- función fallara SIEMPRE al ejecutarse.
--
-- Por eso «revertirla» a la versión de la 0080 no tiene ningún sentido: dejaría una
-- función que existe, que se puede llamar, y que revienta con
-- «column reference user_id is ambiguous» en la primera invitación.
--
-- Si hay que deshacer el alta de usuarios, lo que se revierte es la 0080 —su rollback
-- quita las dos funciones— y con ella se va también este arreglo.

DO $$
BEGIN
    RAISE EXCEPTION
        'La 0081 solo corrige el cuerpo de core.alta_usuario_invitado. Revertirla '
        'restauraria una version que falla en toda invitacion. Para deshacer el alta '
        'de usuarios, aplica rollbacks/0080_alta_usuarios_rollback.sql.';
END $$;
