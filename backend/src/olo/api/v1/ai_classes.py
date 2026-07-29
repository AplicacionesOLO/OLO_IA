"""CRUD de clases del proyecto. Sin DELETE: se desactivan."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status

from olo.api.deps import Db, PlatformOwnerRequired, require
from olo.api.v1.ai_schemas import AiClassCreate, AiClassOut, AiClassUpdate
from olo.api.v1.schemas import Envelope
from olo.api.v1.warehouses import _etag, _parse_if_match
from olo.repositories import identity
from olo.services.ai.klass import AiClassService

router = APIRouter(prefix="/ai", tags=["ai-classes"])


@router.get(
    "/projects/{project_id}/classes",
    response_model=Envelope[list[AiClassOut]],
    dependencies=[PlatformOwnerRequired, require("ai_classes:read")],
    summary="Clases del proyecto, en orden de class_index",
)
async def list_classes(
    db: Db,
    project_id: UUID,
    only_active: Annotated[bool, Query()] = False,
) -> Envelope[list[AiClassOut]]:
    filas = await AiClassService(db).list_classes(project_id, only_active=only_active)
    return Envelope[list[AiClassOut]](
        data=[AiClassOut.model_validate(c, from_attributes=True) for c in filas]
    )


@router.post(
    "/projects/{project_id}/classes",
    response_model=Envelope[AiClassOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[PlatformOwnerRequired, require("ai_classes:write")],
    summary="Crear una clase",
)
async def create_class(
    db: Db, project_id: UUID, payload: AiClassCreate, response: Response
) -> Envelope[AiClassOut]:
    """`class_index` lo asigna el SERVIDOR, con advisory lock por proyecto.

    El cliente no lo envía y no puede elegirlo: es inmutable y no se reutiliza, así
    que dejarlo al cliente solo permitiría colisiones y huecos.
    """
    user_id = await identity.fetch_current_user_id(db)
    creada = await AiClassService(db).create(
        project_id, payload.model_dump(), created_by=user_id
    )
    response.headers["Location"] = f"/v1/ai/classes/{creada.id}"
    response.headers["ETag"] = _etag(creada.version)
    return Envelope[AiClassOut](
        data=AiClassOut.model_validate(creada, from_attributes=True)
    )


@router.patch(
    "/classes/{class_id}",
    response_model=Envelope[AiClassOut],
    dependencies=[PlatformOwnerRequired, require("ai_classes:write")],
    summary="Editar o desactivar una clase",
)
async def update_class(
    db: Db,
    class_id: UUID,
    payload: AiClassUpdate,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Envelope[AiClassOut]:
    """Nombre, color, descripción y `is_active`. NUNCA `class_index`.

    No hay DELETE: desactivar con `is_active = false` es la vía correcta, porque los
    pesos guardan índices y renumerar hace que un modelo entrenado devuelva la
    etiqueta equivocada sin dar ningún error.
    """
    esperada = _parse_if_match(if_match)
    user_id = await identity.fetch_current_user_id(db)
    actualizada = await AiClassService(db).update(
        class_id, payload.changes(), expected_version=esperada, updated_by=user_id
    )
    response.headers["ETag"] = _etag(actualizada.version)
    return Envelope[AiClassOut](
        data=AiClassOut.model_validate(actualizada, from_attributes=True)
    )
