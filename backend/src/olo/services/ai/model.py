"""Servicio de modelos lógicos y de su vocabulario."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.exc import DBAPIError

from olo.core.errors import (
    BusinessRuleError,
    ClassInactiveError,
    ConflictError,
    CrossProjectReferenceError,
    ModelContractImmutableError,
    NotFoundError,
    VersionConflictError,
)
from olo.domain.ai.klass import asignar_indices_contiguos
from olo.domain.ai.model import AiModel, InputType, ModelStatus, Task
from olo.domain.warehouse import DomainRuleError
from olo.repositories.ai import (
    CatalogRepository,
    ModelClassRepository,
    ModelRepository,
    ProjectRepository,
)
from olo.services.ai.errors import translate_pg_error
from olo.services.ai.project import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    Page,
    decode_cursor,
    encode_cursor,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.domain.ai.klass import ModelClass


class AiModelService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = ModelRepository(session)
        self._proyectos = ProjectRepository(session)
        self._catalogo = CatalogRepository(session)
        self._vocab = ModelClassRepository(session)

    async def list_models(
        self,
        project_id: UUID,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        task: Task | None = None,
        status: ModelStatus | None = None,
        search: str | None = None,
    ) -> Page:
        await self._require_project(project_id)
        limit = min(max(limit, 1), MAX_PAGE_SIZE)
        clave = decode_cursor(cursor) if cursor else None
        filas = await self._repo.list_page(
            project_id=project_id, limit=limit, cursor=clave,
            task=task, status=status, search=search,
        )
        hay_mas = len(filas) > limit
        items = list(filas[:limit])
        siguiente = encode_cursor(items[-1].slug, items[-1].id) if hay_mas and items else None
        return Page(items=items, next_cursor=siguiente)

    async def get(self, model_id: UUID) -> AiModel:
        modelo = await self._repo.get_resolved(model_id)
        if modelo is None:
            raise NotFoundError("Modelo no encontrado", resource_id=str(model_id))
        return modelo

    async def create(
        self, project_id: UUID, datos: dict[str, Any], *, created_by: UUID
    ) -> AiModel:
        await self._require_project(project_id)

        # Validación previa contra el catálogo: da el mensaje con la lista de
        # alternativas. El trigger es la garantía.
        arquitectura = await self._catalogo.get_architecture(datos["architecture_code"])
        if arquitectura is None:
            raise BusinessRuleError(
                f"La arquitectura {datos['architecture_code']!r} no existe en el catálogo"
            )
        try:
            arquitectura.validate_combination(
                Task(datos["task"]), InputType(datos["input_type"])
            )
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        if await self._repo.slug_taken(project_id, datos["slug"]):
            raise ConflictError(
                f"Ya existe un modelo con el slug {datos['slug']!r} en este proyecto",
                field="slug",
            )

        try:
            creado = await self._repo.create(project_id, datos, created_by=created_by)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

        # Se devuelve resuelto: el cliente espera el framework en la respuesta del 201.
        return await self.get(creado.id)

    async def update(
        self,
        model_id: UUID,
        cambios: dict[str, Any],
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiModel:
        modelo = await self.get(model_id)

        # Contrato inmutable: se comprueba ANTES para dar 409 nombrando los campos,
        # en lugar de dejar que el trigger produzca un 409 seco.
        congelados = modelo.campos_del_contrato_modificados(cambios)
        if congelados and await self._repo.count_versions(model_id) > 0:
            raise ModelContractImmutableError(
                f"El modelo tiene versiones registradas: {', '.join(congelados)} "
                "no se pueden cambiar. Crea un modelo nuevo.",
                immutable_fields=congelados,
            )

        # Si cambia la arquitectura o la tarea, revalidar la combinación resultante.
        if {"architecture_code", "task", "input_type"} & set(cambios):
            codigo = cambios.get("architecture_code", modelo.architecture_code)
            arquitectura = await self._catalogo.get_architecture(codigo)
            if arquitectura is None:
                raise BusinessRuleError(f"La arquitectura {codigo!r} no existe")
            try:
                arquitectura.validate_combination(
                    Task(cambios.get("task", modelo.task)),
                    InputType(cambios.get("input_type", modelo.input_type)),
                )
            except DomainRuleError as exc:
                raise BusinessRuleError(str(exc)) from exc

        if "slug" in cambios and await self._repo.slug_taken(
            modelo.project_id, cambios["slug"], excluding=model_id
        ):
            raise ConflictError("Ese slug ya está en uso en este proyecto", field="slug")

        try:
            actualizado = await self._repo.update(
                model_id, cambios, expected_version=expected_version,
                updated_by=updated_by,
            )
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

        if actualizado is None:
            raise VersionConflictError(
                "El modelo fue modificado por otra operación. Vuelve a leerlo.",
                resource_id=str(model_id),
                expected_version=expected_version,
                current_version=modelo.version,
            )
        return await self.get(model_id)

    async def delete(self, model_id: UUID, *, expected_version: int) -> None:
        modelo = await self.get(model_id)
        if modelo.version != expected_version:
            raise VersionConflictError(
                "El modelo fue modificado por otra operación. Vuelve a leerlo.",
                resource_id=str(model_id),
                expected_version=expected_version,
                current_version=modelo.version,
            )
        try:
            await self._repo.soft_delete_by_id(model_id, expected_version=expected_version)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

    # ── Vocabulario ────────────────────────────────────────────────────────
    async def get_vocabulary(self, model_id: UUID) -> Sequence[ModelClass]:
        await self.get(model_id)
        return await self._vocab.list_for_model(model_id)

    async def replace_vocabulary(
        self, model_id: UUID, class_ids: Sequence[UUID], *, created_by: UUID
    ) -> Sequence[ModelClass]:
        """Reemplazo atómico. `training_index` sale de la posición en la lista."""
        modelo = await self.get(model_id)

        faltan = await self._vocab.missing_class_ids(modelo.project_id, class_ids)
        if faltan:
            raise CrossProjectReferenceError(
                "Hay clases que no existen en este proyecto: "
                + ", ".join(str(c) for c in faltan),
                missing=[str(c) for c in faltan],
            )

        inusables = await self._vocab.inactive_class_ids(modelo.project_id, class_ids)
        if inusables:
            raise ClassInactiveError(
                "Hay clases desactivadas que no pueden entrar en el vocabulario: "
                + ", ".join(str(c) for c in inusables),
                inactive=[str(c) for c in inusables],
            )

        try:
            asignaciones = asignar_indices_contiguos(list(class_ids))
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        try:
            await self._vocab.replace(
                model_id, modelo.project_id, asignaciones, created_by=created_by
            )
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

        return await self._vocab.list_for_model(model_id)

    async def _require_project(self, project_id: UUID) -> None:
        if not await self._proyectos.exists(project_id):
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))
