"""Catálogo de frameworks y arquitecturas. Solo lectura."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from olo.api.deps import Db, PlatformOwnerRequired, require
from olo.api.v1.ai_schemas import ArchitectureOut, FrameworkOut
from olo.api.v1.schemas import Envelope
from olo.core.errors import NotFoundError
from olo.domain.ai.model import Task
from olo.repositories.ai import CatalogRepository

router = APIRouter(prefix="/ai", tags=["ai-catalog"])


@router.get(
    "/frameworks",
    response_model=Envelope[list[FrameworkOut]],
    dependencies=[PlatformOwnerRequired, require("ai_architectures:read")],
    summary="Listar frameworks",
)
async def list_frameworks(
    db: Db,
    include_inactive: Annotated[bool, Query()] = False,
) -> Envelope[list[FrameworkOut]]:
    filas = await CatalogRepository(db).list_frameworks(only_active=not include_inactive)
    return Envelope[list[FrameworkOut]](
        data=[FrameworkOut.model_validate(f, from_attributes=True) for f in filas]
    )


@router.get(
    "/architectures",
    response_model=Envelope[list[ArchitectureOut]],
    dependencies=[PlatformOwnerRequired, require("ai_architectures:read")],
    summary="Listar arquitecturas con sus capacidades",
)
async def list_architectures(
    db: Db,
    framework: Annotated[str | None, Query()] = None,
    task: Annotated[Task | None, Query()] = None,
    include_inactive: Annotated[bool, Query()] = False,
) -> Envelope[list[ArchitectureOut]]:
    filas = await CatalogRepository(db).list_architectures(
        framework=framework, task=task, only_active=not include_inactive
    )
    return Envelope[list[ArchitectureOut]](data=[_to_out(a) for a in filas])


@router.get(
    "/architectures/{code}",
    response_model=Envelope[ArchitectureOut],
    dependencies=[PlatformOwnerRequired, require("ai_architectures:read")],
    summary="Una arquitectura con su hyperparam_schema",
)
async def get_architecture(db: Db, code: str) -> Envelope[ArchitectureOut]:
    arquitectura = await CatalogRepository(db).get_architecture(code)
    if arquitectura is None:
        raise NotFoundError("Arquitectura no encontrada", resource_id=code)
    return Envelope[ArchitectureOut](data=_to_out(arquitectura))


def _to_out(a: object) -> ArchitectureOut:
    """Los frozenset del dominio pasan a listas ordenadas.

    Ordenadas y no en orden arbitrario: un `frozenset` no garantiza orden, y una
    respuesta que cambia de orden entre llamadas hace que cualquier diff del cliente
    marque cambios inexistentes.
    """
    return ArchitectureOut(
        code=a.code,  # type: ignore[attr-defined]
        framework_code=a.framework_code,  # type: ignore[attr-defined]
        display_name=a.display_name,  # type: ignore[attr-defined]
        family=a.family,  # type: ignore[attr-defined]
        supported_tasks=sorted(t.value for t in a.supported_tasks),  # type: ignore[attr-defined]
        supported_input_types=sorted(i.value for i in a.supported_input_types),  # type: ignore[attr-defined]
        supported_annotation_kinds=sorted(a.supported_annotation_kinds),  # type: ignore[attr-defined]
        requires_training=a.requires_training,  # type: ignore[attr-defined]
        requires_annotations=a.requires_annotations,  # type: ignore[attr-defined]
        weights_extension=a.weights_extension,  # type: ignore[attr-defined]
        default_hyperparams=a.default_hyperparams,  # type: ignore[attr-defined]
        hyperparam_schema=a.hyperparam_schema,  # type: ignore[attr-defined]
        min_images_recommended=a.min_images_recommended,  # type: ignore[attr-defined]
        approx_weights_mb=a.approx_weights_mb,  # type: ignore[attr-defined]
        is_active=a.is_active,  # type: ignore[attr-defined]
        notes=a.notes,  # type: ignore[attr-defined]
    )
