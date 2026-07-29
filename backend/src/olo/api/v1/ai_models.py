"""CRUD de modelos lógicos y de su vocabulario."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status

from olo.api.deps import Db, PlatformOwnerRequired, require
from olo.api.v1.ai_schemas import (
    AiModelCreate,
    AiModelOut,
    AiModelUpdate,
    ModelClassOut,
    ModelVocabularyPut,
)
from olo.api.v1.schemas import Envelope, PagedEnvelope, PageMeta
from olo.api.v1.warehouses import _etag, _parse_if_match
from olo.domain.ai.model import ModelStatus, Task
from olo.repositories import identity
from olo.services.ai.model import AiModelService
from olo.services.ai.project import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/ai", tags=["ai-models"])


@router.get(
    "/projects/{project_id}/models",
    response_model=PagedEnvelope[AiModelOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:read")],
    summary="Modelos de un proyecto",
)
async def list_models(
    db: Db,
    project_id: UUID,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query()] = None,
    task: Annotated[Task | None, Query()] = None,
    status_filter: Annotated[ModelStatus | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> PagedEnvelope[AiModelOut]:
    page = await AiModelService(db).list_models(
        project_id, limit=limit, cursor=cursor, task=task,
        status=status_filter, search=search,
    )
    return PagedEnvelope[AiModelOut](
        data=[AiModelOut.model_validate(m, from_attributes=True) for m in page.items],
        pagination=PageMeta(next_cursor=page.next_cursor, page_size=limit),
    )


@router.post(
    "/projects/{project_id}/models",
    response_model=Envelope[AiModelOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Crear un modelo lógico",
)
async def create_model(
    db: Db, project_id: UUID, payload: AiModelCreate, response: Response
) -> Envelope[AiModelOut]:
    user_id = await identity.fetch_current_user_id(db)
    creado = await AiModelService(db).create(
        project_id, payload.model_dump(), created_by=user_id
    )
    response.headers["Location"] = f"/v1/ai/models/{creado.id}"
    response.headers["ETag"] = _etag(creado.version)
    return Envelope[AiModelOut](
        data=AiModelOut.model_validate(creado, from_attributes=True)
    )


@router.get(
    "/models/{model_id}",
    response_model=Envelope[AiModelOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:read")],
    summary="Un modelo, con framework y versión publicada resueltos",
)
async def get_model(db: Db, model_id: UUID, response: Response) -> Envelope[AiModelOut]:
    modelo = await AiModelService(db).get(model_id)
    response.headers["ETag"] = _etag(modelo.version)
    return Envelope[AiModelOut](
        data=AiModelOut.model_validate(modelo, from_attributes=True)
    )


@router.patch(
    "/models/{model_id}",
    response_model=Envelope[AiModelOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Actualizar un modelo",
)
async def update_model(
    db: Db,
    model_id: UUID,
    payload: AiModelUpdate,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Envelope[AiModelOut]:
    """Tocar `task`, `input_type` o `architecture_code` con versiones da **409**.

    409 y no 400: el valor es válido, lo que choca es el estado del recurso. La
    respuesta incluye `details.immutable_fields`.
    """
    esperada = _parse_if_match(if_match)
    user_id = await identity.fetch_current_user_id(db)
    actualizado = await AiModelService(db).update(
        model_id, payload.changes(), expected_version=esperada, updated_by=user_id
    )
    response.headers["ETag"] = _etag(actualizado.version)
    return Envelope[AiModelOut](
        data=AiModelOut.model_validate(actualizado, from_attributes=True)
    )


@router.delete(
    "/models/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[PlatformOwnerRequired, require("ai_projects:delete")],
    summary="Archivar un modelo (borrado lógico)",
)
async def delete_model(
    db: Db,
    model_id: UUID,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> None:
    esperada = _parse_if_match(if_match)
    await AiModelService(db).delete(model_id, expected_version=esperada)


# ── Vocabulario ────────────────────────────────────────────────────────────
@router.get(
    "/models/{model_id}/classes",
    response_model=Envelope[list[ModelClassOut]],
    dependencies=[PlatformOwnerRequired, require("ai_classes:read")],
    summary="Vocabulario del modelo, en orden de training_index",
)
async def get_vocabulary(db: Db, model_id: UUID) -> Envelope[list[ModelClassOut]]:
    filas = await AiModelService(db).get_vocabulary(model_id)
    return Envelope[list[ModelClassOut]](
        data=[ModelClassOut.model_validate(v, from_attributes=True) for v in filas]
    )


@router.put(
    "/models/{model_id}/classes",
    response_model=Envelope[list[ModelClassOut]],
    dependencies=[PlatformOwnerRequired, require("ai_classes:write")],
    summary="Reemplazar el vocabulario completo",
)
async def put_vocabulary(
    db: Db, model_id: UUID, payload: ModelVocabularyPut
) -> Envelope[list[ModelClassOut]]:
    """Reemplazo completo y atómico. El ORDEN de `class_ids` fija `training_index`.

    No hay POST/DELETE individuales a propósito: `training_index` debe ser contiguo
    0..N-1, y retirar una clase del medio con operaciones sueltas dejaría un hueco
    que el framework no admite.
    """
    user_id = await identity.fetch_current_user_id(db)
    filas = await AiModelService(db).replace_vocabulary(
        model_id, payload.class_ids, created_by=user_id
    )
    return Envelope[list[ModelClassOut]](
        data=[ModelClassOut.model_validate(v, from_attributes=True) for v in filas]
    )
