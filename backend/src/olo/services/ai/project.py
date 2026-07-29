"""Servicio de proyectos de IA."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.exc import DBAPIError

from olo.core.errors import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    VersionConflictError,
)
from olo.domain.ai.project import AiProject, ProjectStatus
from olo.domain.warehouse import DomainRuleError
from olo.repositories.ai import ProjectRepository
from olo.services.ai.errors import translate_pg_error

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 20


@dataclass(frozen=True, slots=True)
class Page:
    items: Sequence[Any]
    next_cursor: str | None


def encode_cursor(clave: str, entity_id: UUID) -> str:
    return (
        base64.urlsafe_b64encode(f"{clave}\x00{entity_id}".encode())
        .decode()
        .rstrip("=")
    )


def decode_cursor(cursor: str) -> tuple[str, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        clave, _, raw = base64.urlsafe_b64decode(padded).decode().partition("\x00")
        return clave, UUID(raw)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise BusinessRuleError("El cursor de paginación no es válido") from exc


def traducir(exc: DBAPIError) -> Exception:
    """Error del motor → error de dominio, o el original si no se reconoce.

    Devolver el original hace que salga como 500, que es lo correcto para un fallo
    que no sabemos interpretar.
    """
    return translate_pg_error(exc) or exc


class AiProjectService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = ProjectRepository(session)

    async def list_projects(
        self,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        status: ProjectStatus | None = None,
        search: str | None = None,
    ) -> Page:
        limit = min(max(limit, 1), MAX_PAGE_SIZE)
        clave = decode_cursor(cursor) if cursor else None
        filas = await self._repo.list_page(
            limit=limit, cursor=clave, status=status, search=search
        )
        hay_mas = len(filas) > limit
        items = list(filas[:limit])
        siguiente = encode_cursor(items[-1].slug, items[-1].id) if hay_mas and items else None
        return Page(items=items, next_cursor=siguiente)

    async def get(self, project_id: UUID) -> AiProject:
        proyecto = await self._repo.get_by_id(project_id)
        if proyecto is None:
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))
        return proyecto

    async def create(self, datos: dict[str, Any], *, created_by: UUID) -> AiProject:
        try:
            return await self._repo.create(datos, created_by=created_by)
        except DBAPIError as exc:
            if _es_slug_duplicado(exc):
                raise ConflictError(
                    f"Ya existe un proyecto con el slug {datos['slug']!r}",
                    field="slug",
                ) from exc
            raise traducir(exc) from exc
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

    async def update(
        self,
        project_id: UUID,
        cambios: dict[str, Any],
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiProject:
        try:
            actualizado = await self._repo.update(
                project_id, cambios, expected_version=expected_version,
                updated_by=updated_by,
            )
        except DBAPIError as exc:
            if _es_slug_duplicado(exc):
                raise ConflictError("Ese slug ya está en uso", field="slug") from exc
            raise traducir(exc) from exc
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        if actualizado is None:
            # No se puede distinguir aquí: se relee para dar el código correcto.
            actual = await self._repo.get_by_id(project_id)
            if actual is None:
                raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))
            raise VersionConflictError(
                "El proyecto fue modificado por otra operación. Vuelve a leerlo.",
                resource_id=str(project_id),
                expected_version=expected_version,
                current_version=actual.version,
            )
        return actualizado

    async def delete(
        self, project_id: UUID, *, expected_version: int
    ) -> None:
        proyecto = await self._repo.get_by_id(project_id)
        if proyecto is None:
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))

        if await self._repo.has_models(project_id):
            raise ConflictError(
                "El proyecto tiene modelos activos. Archiva o elimina los modelos primero.",
                resource_id=str(project_id),
            )

        if proyecto.version != expected_version:
            raise VersionConflictError(
                "El proyecto fue modificado por otra operación. Vuelve a leerlo.",
                resource_id=str(project_id),
                expected_version=expected_version,
                current_version=proyecto.version,
            )
        await self._repo.soft_delete_by_id(project_id, expected_version=expected_version)


def _es_slug_duplicado(exc: DBAPIError) -> bool:
    from olo.db.pg_errors import extract_pg_error

    pg = extract_pg_error(exc)
    return bool(pg and pg.sqlstate == "23505" and "slug" in (pg.constraint or ""))
