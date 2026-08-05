"""Quién tiene OLOBOT y con qué nivel.

── LA REGLA QUE ESTE ARCHIVO EXISTE PARA IMPONER ───────────────────────────

**Nadie puede darse a sí mismo un nivel.**

No es paranoia: es la única forma de que la lista de niveles signifique algo. Si
quien administra pudiera subirse el propio, el registro de `granted_by` diría
«se lo dio él mismo» en la fila que más importa, y la matriz de permisos dejaría de
ser el sitio donde se decide quién puede qué.

La consecuencia práctica es que el primer `owner` lo puso la migración 0073, y de ahí
en adelante los niveles los conceden unos a otros. Un operador que se quede sin
ningún `owner` necesita una migración para recuperarlo, y eso es correcto: es
exactamente el tipo de cambio que debe dejar rastro en el repositorio.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.domain.olobot import ETIQUETAS, NIVELES, Nivel, capacidades_de, nivel_valido
from olo.repositories.olobot import OlobotRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext


class AccesoService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._repo = OlobotRepository(session)
        self._ctx = ctx

    async def catalogo(self) -> dict[str, Any]:
        """Los cuatro niveles con su etiqueta y lo que trae cada uno.

        Lo consume la pantalla de Configuración para pintar el desplegable. Va del
        servidor y no escrito en el frontend porque el que decide qué puede hacer
        cada nivel es `domain/olobot/level.py`: dos listas se separan.
        """
        return {
            "levels": [
                {
                    "level": n.value,
                    "label": ETIQUETAS[n][0],
                    "description": ETIQUETAS[n][1],
                    "capabilities": sorted(c.value for c in capacidades_de(n)),
                }
                for n in NIVELES
            ]
        }

    async def listar(self) -> dict[str, Any]:
        """Todos los usuarios del operador con su nivel, los que lo tienen y los que no."""
        return {"users": await self._repo.niveles(), **(await self.catalogo())}

    async def poner(
        self, *, user_id: UUID, nivel: str, nota: str | None, actor: UUID
    ) -> None:
        if not nivel_valido(nivel):
            raise BusinessRuleError(
                f"«{nivel}» no es un nivel de OLOBOT. Los niveles son: "
                + ", ".join(n.value for n in NIVELES)
                + "."
            )

        if user_id == actor:
            raise BusinessRuleError(
                "No puedes cambiar tu propio nivel de OLOBOT. Que lo haga otro "
                "administrador: así el registro dice quién lo concedió."
            )

        filas = await self._repo.poner_nivel(
            tenant_id=self._ctx.tenant_id,
            user_id=user_id,
            nivel=nivel,
            actor=actor,
            nota=nota,
        )
        if filas == 0:
            # La FK compuesta contra la membresía hace imposible la fila de alguien
            # de otro operador, así que llegar aquí con cero filas significa que el
            # usuario no existe o no es de este tenant.
            raise NotFoundError("Usuario no encontrado", resource_id=str(user_id))

    async def quitar(self, *, user_id: UUID, actor: UUID) -> None:
        if user_id == actor:
            raise BusinessRuleError(
                "No puedes retirarte tu propio acceso a OLOBOT."
            )
        filas = await self._repo.quitar_nivel(user_id)
        if filas == 0:
            raise NotFoundError(
                "Ese usuario no tenía acceso a OLOBOT", resource_id=str(user_id)
            )

    async def nivel_actual(self, user_id: UUID) -> Nivel | None:
        """El nivel del usuario que está hablando, o `None` si no tiene bot."""
        crudo = await self._repo.nivel_de(user_id)
        if crudo is None or not nivel_valido(crudo):
            return None
        return Nivel(crudo)
