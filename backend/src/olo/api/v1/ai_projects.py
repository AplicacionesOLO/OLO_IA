"""CRUD de proyectos de IA."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status

from olo.api.deps import CurrentContext, Db, PlatformOwnerRequired, require
from olo.api.v1.ai_schemas import AiProjectCreate, AiProjectOut, AiProjectUpdate
from olo.api.v1.schemas import Envelope, PagedEnvelope, PageMeta
from olo.api.v1.warehouses import _etag, _parse_if_match
from olo.domain.ai.project import ProjectStatus
from olo.services.ai.project import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, AiProjectService

router = APIRouter(prefix="/ai/projects", tags=["ai-projects"])


@router.get(
    "",
    response_model=PagedEnvelope[AiProjectOut],
    dependencies=[PlatformOwnerRequired, require("ai_projects:read")],
    summary="Listar proyectos de IA",
)
async def list_projects(
    db: Db,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query()] = None,
    status_filter: Annotated[ProjectStatus | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> PagedEnvelope[AiProjectOut]:
    page = await AiProjectService(db).list_projects(
        limit=limit, cursor=cursor, status=status_filter, search=search
    )
    return PagedEnvelope[AiProjectOut](
        data=[AiProjectOut.model_validate(p, from_attributes=True) for p in page.items],
        pagination=PageMeta(next_cursor=page.next_cursor, page_size=limit),
    )


@router.post(
    "",
    response_model=Envelope[AiProjectOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[PlatformOwnerRequired, require("ai_projects:write")],
    summary="Crear un proyecto de IA",
)
async def create_project(
    db: Db, ctx: CurrentContext, payload: AiProjectCreate, response: Response
) -> Envelope[AiProjectOut]:
    from olo.repositories import identity

    user_id = await identity.fetch_current_user_id(db)
    creado = await AiProjectService(db).create(
        payload.model_dump(), created_by=user_id
    )
    response.headers["Location"] = f"/v1/ai/projects/{creado.id}"
    response.headers["ETag"] = _etag(creado.version)
    return Envelope[AiProjectOut](
        data=AiProjectOut.model_validate(creado, from_attributes=True)
    )


@router.get(
    "/{project_id}",
    response_model=Envelope[AiProjectOut],
    dependencies=[PlatformOwnerRequired, require("ai_projects:read")],
    summary="Un proyecto",
)
async def get_project(
    db: Db, project_id: UUID, response: Response
) -> Envelope[AiProjectOut]:
    proyecto = await AiProjectService(db).get(project_id)
    response.headers["ETag"] = _etag(proyecto.version)
    return Envelope[AiProjectOut](
        data=AiProjectOut.model_validate(proyecto, from_attributes=True)
    )


@router.patch(
    "/{project_id}",
    response_model=Envelope[AiProjectOut],
    dependencies=[PlatformOwnerRequired, require("ai_projects:write")],
    summary="Actualizar un proyecto",
)
async def update_project(
    db: Db,
    project_id: UUID,
    payload: AiProjectUpdate,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Envelope[AiProjectOut]:
    from olo.repositories import identity

    esperada = _parse_if_match(if_match)
    user_id = await identity.fetch_current_user_id(db)
    actualizado = await AiProjectService(db).update(
        project_id, payload.changes(), expected_version=esperada, updated_by=user_id
    )
    response.headers["ETag"] = _etag(actualizado.version)
    return Envelope[AiProjectOut](
        data=AiProjectOut.model_validate(actualizado, from_attributes=True)
    )


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[PlatformOwnerRequired, require("ai_projects:delete")],
    summary="Archivar un proyecto (borrado lógico)",
)
async def delete_project(
    db: Db,
    project_id: UUID,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> None:
    esperada = _parse_if_match(if_match)
    await AiProjectService(db).delete(project_id, expected_version=esperada)
