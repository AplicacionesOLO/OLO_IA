-- ROLLBACK de 0071 · Quita las asignaciones de `clients:*`.
--
-- Deja el sistema como estaba: los cuatro permisos existen en el catálogo y ningún rol
-- los tiene, así que `POST /v1/admin/clients` vuelve a responder 403 a todo el mundo,
-- incluido el platform owner. Se documenta porque es un estado que parece funcional
-- —hay endpoint, formulario y fila en la matriz— y no lo es.
DELETE FROM core.role_permissions WHERE permission_code LIKE 'clients:%';
