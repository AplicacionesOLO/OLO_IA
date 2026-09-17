"""Repositorio de la #8 del plan de mejoras SaaS -- onboarding self-service.
Ver la cabecera de la migracion 0118 para el porque de la excepcion de
seguridad que esto representa.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class OnboardingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def crear_tenant_propio(
        self,
        *,
        org_name: str,
        email: str,
        first_name: str,
        last_name: str,
        locale: str,
        timezone: str,
    ) -> dict[str, Any]:
        """Unico camino: `core.crear_tenant_propio` decide por su cuenta si
        la identidad de la sesion puede crear una organizacion -- ver 0118."""
        fila = (
            await self._session.execute(
                text(
                    "SELECT out_tenant_id AS tenant_id, "
                    "       out_tenant_name AS tenant_name, "
                    "       out_tenant_slug AS tenant_slug, "
                    "       out_user_id AS user_id "
                    "FROM core.crear_tenant_propio(:org, :email, :fn, :ln, :loc, :tz)"
                ),
                {
                    "org": org_name,
                    "email": email,
                    "fn": first_name,
                    "ln": last_name,
                    "loc": locale,
                    "tz": timezone,
                },
            )
        ).mappings().one()
        return dict(fila)
