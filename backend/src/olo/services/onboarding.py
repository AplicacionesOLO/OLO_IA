"""Servicio de la #8 del plan de mejoras SaaS -- onboarding self-service.
Ver la cabecera de la migracion 0118 para el diseno de seguridad completo.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy.exc import DBAPIError

from olo.core.errors import BusinessRuleError, ConflictError, ForbiddenError
from olo.db.pg_errors import extract_pg_error
from olo.repositories.onboarding import OnboardingRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

#: Los tres SQLSTATE que `core.crear_tenant_propio` puede lanzar a proposito
#: (0118) -- cualquier otro error de base sube tal cual, sin traducir, porque
#: seria un fallo real y no una regla de negocio.
_SIN_IDENTIDAD = "42501"
_YA_TIENE_TENANT = "42710"
_DATOS_INVALIDOS = "22023"


class OnboardingService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = OnboardingRepository(session)

    async def crear_tenant_propio(
        self,
        *,
        org_name: str,
        email: str,
        first_name: str,
        last_name: str,
        locale: str = "es",
        timezone: str = "America/Costa_Rica",
    ) -> dict[str, Any]:
        try:
            return await self._repo.crear_tenant_propio(
                org_name=org_name,
                email=email,
                first_name=first_name,
                last_name=last_name,
                locale=locale,
                timezone=timezone,
            )
        except DBAPIError as exc:
            pg = extract_pg_error(exc)
            if pg and pg.sqlstate == _YA_TIENE_TENANT:
                raise ConflictError(
                    "Esta cuenta ya pertenece a una organizacion -- inicia sesion "
                    "normalmente en vez de crear una nueva."
                ) from exc
            if pg and pg.sqlstate == _DATOS_INVALIDOS:
                raise BusinessRuleError(pg.message or "Datos invalidos") from exc
            if pg and pg.sqlstate == _SIN_IDENTIDAD:
                raise ForbiddenError(
                    "No se pudo verificar la identidad de la sesion"
                ) from exc
            raise
