"""Guardar y leer las anotaciones de una imagen.

─────────────────────────────────────────────────────────────────────────────
UNA SOLA OPERACIÓN DE ESCRITURA: REEMPLAZAR EL CONJUNTO DE UNA IMAGEN

`PUT /ai/images/{id}/annotations` con la lista completa. No hay alta ni baja por
caja. El motivo está en `domain/ai/annotation.py`, y se resume en que el estado de
la imagen depende del conjunto, no de una caja suelta.

─────────────────────────────────────────────────────────────────────────────
EL CERROJO ES LA VERSIÓN DE LA IMAGEN, NO LA DE CADA CAJA

Un `If-Match` por anotación obligaría al cliente a llevar N versiones y a resolver
N conflictos, y no protegería de lo que de verdad pasa: dos personas anotando la
misma imagen a la vez. Con la versión de la IMAGEN, quien guarda segundo recibe un
409 y vuelve a leer — que es exactamente la conversación que hay que tener.

Y es coherente, no un atajo: al guardar cambia también la imagen, porque se le
fijan `annotated_by` y `annotated_at` y puede pasar de `pending` a `annotated`.

─────────────────────────────────────────────────────────────────────────────
POR QUÉ SE VALIDAN LAS CLASES AQUÍ SI EL MOTOR YA LO HACE

Las FK compuestas de `ai_annotations` impiden que una anotación apunte a una clase
de otro proyecto, y eso es la autoridad. Pero llega como un error de integridad de
Postgres, sin decir CUÁL de las ocho cajas está mal. Validando antes, la respuesta
nombra la clase y el motivo; el motor sigue siendo la red de seguridad.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import text

from olo.core.errors import (
    ClassInactiveError,
    CrossProjectReferenceError,
    NotFoundError,
    VersionConflictError,
)
from olo.domain.ai.annotation import (
    Annotation,
    AnnotationDraft,
    planificar_guardado,
    siguiente_estado_imagen,
)
from olo.domain.ai.asset import ImageStatus
from olo.domain.warehouse import DomainRuleError
from olo.repositories.ai.annotation import AnnotationRepository
from olo.repositories.ai.asset import ImageRepository
from olo.repositories.ai.klass import ClassRepository
from olo.services.ai.errors import translate_pg_error

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.domain.ai.asset import AiImage


class AiAnnotationResult:
    """Lo que devuelve un guardado: las cajas y el estado nuevo de la imagen.

    Se devuelven las dos cosas juntas porque el cliente necesita las dos: la lista
    con los `id` recién asignados —sin ellos, el siguiente guardado volvería a
    insertarlas— y la versión nueva de la imagen, que es el `If-Match` de la
    siguiente escritura. Obligar a un GET después de cada guardado dejaría una
    ventana en la que el cliente tiene un ETag caducado.
    """

    __slots__ = ("annotations", "image")

    def __init__(self, annotations: Sequence[Annotation], image: AiImage) -> None:
        self.annotations = annotations
        self.image = image


class AiAnnotationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = AnnotationRepository(session)
        self._imagenes = ImageRepository(session)
        self._clases = ClassRepository(session)

    # ── Lectura ───────────────────────────────────────────────────────────────
    async def list_for_image(self, image_id: UUID) -> Sequence[Annotation]:
        await self._require_image(image_id)
        return await self._repo.list_for_image(image_id)

    # ── Escritura ─────────────────────────────────────────────────────────────
    async def replace_for_image(
        self,
        image_id: UUID,
        drafts: Sequence[AnnotationDraft],
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiAnnotationResult:
        imagen = await self._require_image(image_id)

        # El cerrojo se comprueba ANTES de escribir nada. Si se comprobara al final,
        # las anotaciones ya estarían guardadas cuando el 409 llega, y el cliente
        # recibiría un error habiendo mutado la base.
        if imagen.version != expected_version:
            raise VersionConflictError(
                "La imagen cambió desde que la leíste. Vuelve a abrirla antes de guardar.",
                resource_id=str(image_id),
                expected=expected_version,
            )

        await self._validar_clases(imagen.project_id, drafts)

        existentes = await self._repo.list_for_image(image_id)
        try:
            plan = planificar_guardado(existentes, drafts)
        except DomainRuleError as exc:
            raise CrossProjectReferenceError(str(exc)) from exc

        # El orden importa: primero retirar, luego actualizar, luego insertar. Así el
        # conjunto nunca pasa por un estado con dos cajas donde acabará habiendo una.
        # Hoy ninguna restricción lo prohíbe; cuando la haya, este orden ya es el bueno.
        try:
            for retirada in plan.retirar:
                await self._repo.retire(retirada.id, updated_by=updated_by)
            for annotation_id, cambiada in plan.actualizar:
                await self._repo.update_box(annotation_id, cambiada, updated_by=updated_by)
            for nueva in plan.insertar:
                await self._repo.insert(
                    imagen.project_id, image_id, nueva, created_by=updated_by
                )
        except Exception as exc:
            traducido = translate_pg_error(exc)
            raise (traducido or exc) from exc

        imagen = await self._sellar_imagen(imagen, plan.total_resultante, updated_by)
        return AiAnnotationResult(
            annotations=await self._repo.list_for_image(image_id), image=imagen
        )

    # ── Interno ───────────────────────────────────────────────────────────────
    async def _require_image(self, image_id: UUID) -> AiImage:
        imagen = await self._imagenes.get_by_id(image_id)
        if imagen is None:
            # 404 y no 403 aunque fuera de otro tenant: RLS la hace invisible, así
            # que aquí llega como inexistente. Un 403 confirmaría que existe.
            raise NotFoundError("Imagen no encontrada", resource_id=str(image_id))
        return imagen

    async def _validar_clases(
        self, project_id: UUID, drafts: Sequence[AnnotationDraft]
    ) -> None:
        """Toda clase referida existe, es de ESTE proyecto y está activa.

        Se leen las clases del proyecto una sola vez y se comprueba en memoria: con
        una consulta por caja, ocho cajas serían ocho viajes de 260 ms contra el
        pooler. El conjunto de clases de un proyecto son decenas de filas.
        """
        if not drafts:
            return

        del_proyecto = {c.id: c for c in await self._clases.list_for_project(project_id)}

        ajenas: list[UUID] = []
        inactivas: list[str] = []
        for d in drafts:
            clase = del_proyecto.get(d.class_id)
            if clase is None:
                ajenas.append(d.class_id)
            elif not clase.usable:
                inactivas.append(clase.name)

        if ajenas:
            listado = ", ".join(str(x) for x in dict.fromkeys(ajenas))
            raise CrossProjectReferenceError(
                f"Estas clases no pertenecen al proyecto de la imagen: {listado}"
            )
        if inactivas:
            listado = ", ".join(dict.fromkeys(inactivas))
            raise ClassInactiveError(
                f"No se puede anotar con clases desactivadas: {listado}"
            )

    async def _sellar_imagen(
        self, imagen: AiImage, anotaciones: int, updated_by: UUID
    ) -> AiImage:
        """Fija la autoría de la anotación y mueve el estado si toca.

        Se hace SIEMPRE una escritura sobre la imagen, incluso si el estado no
        cambia, y es a propósito: `annotated_by` / `annotated_at` responden a «quién
        anotó esto y cuándo», y una corrección también es anotar. Además esa
        escritura sube la `version`, que es lo que invalida el ETag del otro
        anotador que tuviera la imagen abierta.
        """
        nuevo = siguiente_estado_imagen(imagen.status.value, anotaciones)
        estado = ImageStatus(nuevo) if nuevo else imagen.status

        actualizada = await self._imagenes.update_status(
            imagen.id, estado, expected_version=imagen.version, updated_by=updated_by
        )
        if actualizada is None:
            # Perdimos la carrera entre la comprobación del cerrojo y esta escritura.
            raise VersionConflictError(
                "La imagen cambió mientras se guardaba. Vuelve a abrirla.",
                resource_id=str(imagen.id),
                expected=imagen.version,
            )

        await self._marcar_anotada(imagen.id, updated_by)
        return actualizada

    async def _marcar_anotada(self, image_id: UUID, user_id: UUID) -> None:
        """`annotated_by` y `annotated_at`, que `update_status` no toca.

        Van en una sentencia aparte y sin condición de versión porque la anterior ya
        ganó el cerrojo en esta misma transacción: volver a exigir la versión aquí
        fallaría siempre, ya que `update_status` acaba de incrementarla.
        """
        await self._session.execute(
            text(
                "UPDATE ai.images SET annotated_by = CAST(:u AS uuid), annotated_at = now() "
                "WHERE id = CAST(:id AS uuid) AND deleted_at IS NULL"
            ),
            {"id": str(image_id), "u": str(user_id)},
        )
