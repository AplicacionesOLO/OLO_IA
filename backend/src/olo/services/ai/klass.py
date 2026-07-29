"""Servicio de clases del proyecto."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.exc import DBAPIError

from olo.core.errors import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    VersionConflictError,
)
from olo.domain.ai.klass import AiClass
from olo.domain.warehouse import DomainRuleError
from olo.repositories.ai import CatalogRepository, ClassRepository, ProjectRepository
from olo.services.ai.errors import translate_pg_error

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession


class AiClassService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = ClassRepository(session)
        self._proyectos = ProjectRepository(session)
        self._catalogo = CatalogRepository(session)

    async def list_classes(
        self, project_id: UUID, *, only_active: bool = False
    ) -> Sequence[AiClass]:
        if not await self._proyectos.exists(project_id):
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))
        return await self._repo.list_for_project(project_id, only_active=only_active)

    async def get(self, class_id: UUID) -> AiClass:
        clase = await self._repo.get_by_id(class_id)
        if clase is None:
            raise NotFoundError("Clase no encontrada", resource_id=str(class_id))
        return clase

    async def create(
        self, project_id: UUID, datos: dict[str, Any], *, created_by: UUID
    ) -> AiClass:
        """`class_index` lo asigna el repositorio con advisory lock. El cliente no lo envía."""
        if not await self._proyectos.exists(project_id):
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))

        if await self._repo.name_taken(project_id, datos["name"]):
            raise ConflictError(
                f"Ya existe una clase llamada {datos['name']!r} en este proyecto",
                field="name",
            )

        try:
            return await self._repo.create(project_id, datos, created_by=created_by)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

    async def update(
        self,
        class_id: UUID,
        cambios: dict[str, Any],
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiClass:
        clase = await self.get(class_id)

        if "name" in cambios and await self._repo.name_taken(
            clase.project_id, cambios["name"], excluding=class_id
        ):
            raise ConflictError("Ese nombre ya está en uso en este proyecto", field="name")

        try:
            actualizada = await self._repo.update(
                class_id, cambios, expected_version=expected_version,
                updated_by=updated_by,
            )
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        if actualizada is None:
            raise VersionConflictError(
                "La clase fue modificada por otra operación. Vuelve a leerla.",
                resource_id=str(class_id),
                expected_version=expected_version,
                current_version=clase.version,
            )
        return actualizada
