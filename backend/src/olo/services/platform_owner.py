"""Conceder y revocar Platform Owner. Ver la cabecera de `api/v1/platform.py`.

── LO QUE SE COMPRUEBA AQUÍ, Y LO QUE SE DEJA A LA BASE ─────────────────────

Este servicio adelanta dos comprobaciones que la base también hace —no
autogrant y "no dejes la plataforma sin owners"— SOLO para dar un mensaje
legible antes de gastar un viaje a la base. La autoridad real sigue siendo la
base: `chk_owner_no_self_grant` y el disparador del último owner no se pueden
desactivar desde aquí, así que un fallo en esta comprobación anticipada nunca
se traduce en una escalada — como mucho, en un 500 menos amable.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.repositories import platform_owner as repo

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class PlatformOwnerService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def grant(self, *, email: str, reason: str, actor: UUID) -> dict[str, object]:
        usuario = await repo.find_user_by_email(self._session, email.strip().lower())
        if usuario is None:
            raise NotFoundError(f"No existe ningún usuario con el correo «{email}»")
        target = UUID(str(usuario["id"]))

        if target == actor:
            raise BusinessRuleError(
                "No puedes concederte el privilegio a ti mismo: pídeselo a otro "
                "Platform Owner."
            )
        if await repo.is_active_owner(self._session, target):
            raise BusinessRuleError(f"«{email}» ya es Platform Owner activo.")

        fila = await repo.grant(self._session, user_id=target, granted_by=actor, reason=reason)
        await repo.log_operation(
            self._session,
            actor_user_id=actor,
            operation="owner.grant",
            target_id=target,
            before_state=None,
            after_state={"email": usuario["email"], "reason": reason},
        )
        return {**fila, "email": usuario["email"]}

    async def revoke(self, *, user_id: UUID, reason: str, actor: UUID) -> None:
        if not await repo.is_active_owner(self._session, user_id):
            raise NotFoundError("Ese usuario no es Platform Owner activo")
        # Sin importar quien lo pida ni a quien le toque: dejar la plataforma sin
        # NINGUN owner activo bloquea el modulo entero sin via de recuperacion
        # desde la aplicacion. El disparador de la base lo bloquearia igual, pero
        # con un 500 opaco en vez de este mensaje — medido en pruebas.
        if await repo.count_active(self._session) <= 1:
            raise BusinessRuleError(
                "No se puede dejar la plataforma sin ningún Platform Owner activo. "
                "Concede el privilegio a otra persona antes de revocar este."
            )

        cerrado = await repo.revoke(self._session, user_id)
        if cerrado is None:
            raise NotFoundError("Ese usuario no es Platform Owner activo")

        await repo.log_operation(
            self._session,
            actor_user_id=actor,
            operation="owner.revoke",
            target_id=user_id,
            before_state={"reason": cerrado["reason"]},
            after_state={"revoked_reason": reason},
        )
