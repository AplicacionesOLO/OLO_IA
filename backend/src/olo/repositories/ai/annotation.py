"""Acceso a `ai.annotations`.

─────────────────────────────────────────────────────────────────────────────
NO HAY BORRADO FÍSICO, Y NO ES UNA PREFERENCIA

`ai.annotations` tiene cuatro políticas RLS: la restrictiva de plataforma, SELECT,
INSERT y UPDATE. **No hay política de DELETE.** Con `FORCE ROW LEVEL SECURITY`
activa, un `DELETE` desde `olo_app` no borra nada y no falla: afecta a cero filas.
Un repositorio que hiciera `DELETE` parecería funcionar y dejaría las anotaciones
donde estaban.

Así que retirar una anotación es marcar `deleted_at`, que además es lo correcto por
negocio: una versión de dataset ya congelada tiene que poder seguir resolviendo las
anotaciones con las que se entrenó.

─────────────────────────────────────────────────────────────────────────────
EL JOIN CON ai.classes VIENE EN LA MISMA CONSULTA

El anotador pinta cada caja con el color de su clase. Sin el JOIN, la pantalla
tendría que cruzar dos respuestas antes de dibujar el primer rectángulo, y con la
lista de clases todavía en vuelo pintaría cajas grises que luego cambian de color.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import text

from olo.db.repository import BaseRepository
from olo.domain.ai.annotation import (
    KIND_BBOX,
    ORIGEN_HUMANO,
    Annotation,
    AnnotationDraft,
    BBox,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy import RowMapping

_COLUMNS = (
    "a.id, a.project_id, a.image_id, a.class_id, a.kind, "
    "a.cx, a.cy, a.w, a.h, a.geometry, a.origin, a.confidence, "
    "a.created_at, a.created_by, a.updated_at, a.updated_by, a.version, a.deleted_at"
)

_CLASE_COLUMNS = "c.name AS class_name, c.color AS class_color, c.class_index AS class_index"


class AnnotationRepository(BaseRepository[Annotation]):
    schema = "ai"
    table = "annotations"
    soft_delete = True

    def _to_entity(self, row: RowMapping) -> Annotation:
        caja = None
        if row["kind"] == KIND_BBOX:
            caja = BBox(cx=row["cx"], cy=row["cy"], w=row["w"], h=row["h"])
        return Annotation(
            id=row["id"],
            project_id=row["project_id"],
            image_id=row["image_id"],
            class_id=row["class_id"],
            kind=row["kind"],
            box=caja,
            origin=row["origin"],
            confidence=row["confidence"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
            class_name=row.get("class_name"),
            class_color=row.get("class_color"),
            class_index=row.get("class_index"),
        )

    # ── Lectura ───────────────────────────────────────────────────────────────
    async def list_for_image(self, image_id: UUID) -> Sequence[Annotation]:
        """Las anotaciones vivas de una imagen, con su clase resuelta.

        Sin paginar: una imagen tiene decenas de cajas como mucho, y el anotador las
        necesita todas para poder dibujar. Paginarlas obligaría a la pantalla a
        recomponer el conjunto antes de pintar, y a mostrar una imagen a medio
        anotar mientras llegan las demás.

        Ordenadas por `created_at`: el orden estable evita que la lista lateral
        baile entre guardados, que es desorientador cuando hay ocho cajas.
        """
        stmt = text(
            f"SELECT {_COLUMNS}, {_CLASE_COLUMNS} "  # noqa: S608
            f"FROM {self.qualified_name} a "
            "JOIN ai.classes c ON c.id = a.class_id "
            "WHERE a.image_id = CAST(:image_id AS uuid) AND a.deleted_at IS NULL "
            "ORDER BY a.created_at ASC, a.id ASC"
        )
        rows = (
            await self._session.execute(stmt, {"image_id": str(image_id)})
        ).mappings().all()
        return [self._to_entity(r) for r in rows]

    async def count_for_image(self, image_id: UUID) -> int:
        stmt = text(
            f"SELECT count(1) FROM {self.qualified_name} "  # noqa: S608
            "WHERE image_id = CAST(:image_id AS uuid) AND deleted_at IS NULL"
        )
        return int((await self._session.execute(stmt, {"image_id": str(image_id)})).scalar_one())

    # ── Escritura ─────────────────────────────────────────────────────────────
    #
    # Las tres operaciones son de una sola sentencia por anotación y se ejecutan
    # dentro de la transacción de la petición: si una falla, no queda un conjunto a
    # medio guardar. No se usa `executemany` porque el número de cajas por imagen es
    # de un dígito y el `RETURNING` individual permite devolver el conjunto final
    # sin una segunda lectura.

    async def insert(
        self, project_id: UUID, image_id: UUID, draft: AnnotationDraft, *, created_by: UUID
    ) -> UUID:
        """Inserta una caja nueva.

        `origin` es siempre `human` y `confidence` siempre NULL: este repositorio
        sirve al anotador manual. Cuando el modelo preanote, será otra ruta con
        `origin = 'model'` y su confianza — y el CHECK `chk_ann_confianza` del motor
        impide confundirlas.
        """
        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(project_id, image_id, class_id, kind, cx, cy, w, h, origin, created_by) "
            "VALUES (CAST(:project_id AS uuid), CAST(:image_id AS uuid), "
            "        CAST(:class_id AS uuid), :kind, :cx, :cy, :w, :h, :origin, "
            "        CAST(:created_by AS uuid)) "
            "RETURNING id"
        )
        row = (
            await self._session.execute(
                stmt,
                {
                    "project_id": str(project_id),
                    "image_id": str(image_id),
                    "class_id": str(draft.class_id),
                    "kind": KIND_BBOX,
                    "cx": draft.box.cx,
                    "cy": draft.box.cy,
                    "w": draft.box.w,
                    "h": draft.box.h,
                    "origin": ORIGEN_HUMANO,
                    "created_by": str(created_by),
                },
            )
        ).first()
        return UUID(str(row[0]))  # type: ignore[index]

    async def update_box(
        self, annotation_id: UUID, draft: AnnotationDraft, *, updated_by: UUID
    ) -> None:
        """Mueve la caja o le cambia la clase.

        `version` la sube esta sentencia, no el trigger: `core.set_updated_at()` solo
        toca `updated_at`, deliberadamente, para que una escritura de sistema no
        invalide la versión que el cliente tiene en mano.

        El filtro `deleted_at IS NULL` evita resucitar una anotación retirada por
        otra sesión entre la lectura y el guardado.
        """
        stmt = text(
            f"UPDATE {self.qualified_name} SET "  # noqa: S608
            "class_id = CAST(:class_id AS uuid), cx = :cx, cy = :cy, w = :w, h = :h, "
            "updated_by = CAST(:updated_by AS uuid), version = version + 1, "
            "updated_at = now() "
            "WHERE id = CAST(:id AS uuid) AND deleted_at IS NULL"
        )
        await self._session.execute(
            stmt,
            {
                "id": str(annotation_id),
                "class_id": str(draft.class_id),
                "cx": draft.box.cx,
                "cy": draft.box.cy,
                "w": draft.box.w,
                "h": draft.box.h,
                "updated_by": str(updated_by),
            },
        )

    async def retire(self, annotation_id: UUID, *, updated_by: UUID) -> None:
        """Baja lógica. Ver la cabecera: no hay política de DELETE en RLS."""
        stmt = text(
            f"UPDATE {self.qualified_name} SET "  # noqa: S608
            "deleted_at = now(), updated_by = CAST(:updated_by AS uuid), "
            "version = version + 1, updated_at = now() "
            "WHERE id = CAST(:id AS uuid) AND deleted_at IS NULL"
        )
        await self._session.execute(
            stmt, {"id": str(annotation_id), "updated_by": str(updated_by)}
        )
