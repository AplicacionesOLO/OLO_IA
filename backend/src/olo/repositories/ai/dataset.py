"""Acceso a `ai.dataset_versions` y `ai.dataset_items`.

─────────────────────────────────────────────────────────────────────────────
SOLO INSERTA Y LEE. NO HAY UPDATE NI DELETE, Y NO PODRIA HABERLOS

Las dos tablas tienen un trigger `BEFORE UPDATE OR DELETE` que aborta con excepción,
además de no tener políticas RLS para esas operaciones. La doble capa es deliberada:
sin política, un UPDATE desde `olo_app` quedaría en cero filas EN SILENCIO —que no
es lo mismo que rechazado—, y el trigger además protege de `postgres`, que tiene
`rolbypassrls` y por tanto ignora RLS.

Si alguna vez hace falta «corregir» una versión, la respuesta es crear otra. Es lo
que hace comparables dos entrenamientos.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from sqlalchemy import text

from olo.db.repository import BaseRepository
from olo.domain.ai.dataset import ClaseCongelada, DatasetVersion, ImagenCandidata

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from sqlalchemy import RowMapping

_COLUMNS = (
    "id, project_id, version, name, notes, class_snapshot, "
    "image_count, train_count, val_count, test_count, split_seed, "
    "frozen_at, created_at, created_by"
)


class DatasetVersionRepository(BaseRepository[DatasetVersion]):
    schema = "ai"
    table = "dataset_versions"
    #: La tabla NO tiene `deleted_at`: una versión congelada no se borra ni lógicamente.
    soft_delete = False

    def _to_entity(self, row: RowMapping) -> DatasetVersion:
        crudo = row["class_snapshot"]
        # `asyncpg` puede devolver jsonb como str o ya deserializado según el codec
        # registrado. Se normaliza aquí en lugar de asumir uno de los dos.
        datos = json.loads(crudo) if isinstance(crudo, str) else crudo
        return DatasetVersion(
            id=row["id"],
            project_id=row["project_id"],
            version=row["version"],
            name=row["name"],
            notes=row["notes"],
            class_snapshot=tuple(
                ClaseCongelada(index=int(c["index"]), name=str(c["name"])) for c in datos
            ),
            image_count=row["image_count"],
            train_count=row["train_count"],
            val_count=row["val_count"],
            test_count=row["test_count"],
            split_seed=row["split_seed"],
            frozen_at=row["frozen_at"],
        )

    # ── Lectura ───────────────────────────────────────────────────────────────
    async def list_for_project(self, project_id: UUID) -> Sequence[DatasetVersion]:
        """Todas las versiones, la más reciente primero."""
        stmt = text(
            f"SELECT {_COLUMNS} FROM {self.qualified_name} "  # noqa: S608
            "WHERE project_id = CAST(:pid AS uuid) ORDER BY version DESC"
        )
        rows = (
            await self._session.execute(stmt, {"pid": str(project_id)})
        ).mappings().all()
        return [self._to_entity(r) for r in rows]

    async def candidatas(self, project_id: UUID) -> Sequence[ImagenCandidata]:
        """Imágenes del proyecto con su recuento de cajas vivas.

        El recuento se calcula en la misma consulta con una subconsulta correlacionada
        y no con un `GROUP BY`: hace falta que aparezcan también las imágenes con CERO
        anotaciones, porque una `validated` sin cajas es un negativo legítimo y un
        `JOIN` las dejaría fuera.
        """
        stmt = text(
            "SELECT i.id, i.status, "
            "       (SELECT count(1) FROM ai.annotations a "
            "         WHERE a.image_id = i.id AND a.deleted_at IS NULL) AS n "
            "FROM ai.images i "
            "WHERE i.project_id = CAST(:pid AS uuid) AND i.deleted_at IS NULL "
            "ORDER BY i.created_at ASC"
        )
        rows = (await self._session.execute(stmt, {"pid": str(project_id)})).mappings().all()
        return [
            ImagenCandidata(id=r["id"], status=r["status"], annotation_count=int(r["n"]))
            for r in rows
        ]

    async def siguiente_version(self, project_id: UUID) -> int:
        """`max(version) + 1` del proyecto.

        ⚠ NO es segura por sí sola frente a concurrencia: dos congelados simultáneos
        leerían el mismo máximo. La serialización la da el advisory lock que `freeze()`
        toma en la misma transacción, igual que hace `ClassRepository.create`.
        """
        stmt = text(
            f"SELECT coalesce(max(version), 0) + 1 FROM {self.qualified_name} "  # noqa: S608
            "WHERE project_id = CAST(:pid AS uuid)"
        )
        return int((await self._session.execute(stmt, {"pid": str(project_id)})).scalar_one())

    # ── Escritura ─────────────────────────────────────────────────────────────
    async def freeze(
        self,
        project_id: UUID,
        *,
        version: int,
        name: str | None,
        notes: str | None,
        class_snapshot: Sequence[ClaseCongelada],
        reparto: Sequence[tuple[UUID, str]],
        counts: tuple[int, int, int],
        split_seed: int,
        created_by: UUID,
    ) -> DatasetVersion:
        """Crea la versión y sus items en una sola transacción.

        Si la inserción de los items fallara, la versión no debe quedar: sería una
        instantánea que dice tener 17 imágenes y no tiene ninguna, y el CHECK
        `chk_dsv_suma` no lo detectaría porque los recuentos son columnas, no un
        `count(*)`. La transacción de la petición lo garantiza.
        """
        train, val, test = counts

        fila = (
            await self._session.execute(
                text(
                    f"INSERT INTO {self.qualified_name} "  # noqa: S608
                    "(project_id, version, name, notes, class_snapshot, image_count, "
                    " train_count, val_count, test_count, split_seed, created_by) "
                    "VALUES (CAST(:pid AS uuid), :version, :name, :notes, "
                    "        CAST(:snapshot AS jsonb), :image_count, :train, :val, :test, "
                    "        :seed, CAST(:by AS uuid)) "
                    f"RETURNING {_COLUMNS}"
                ),
                {
                    "pid": str(project_id),
                    "version": version,
                    "name": name,
                    "notes": notes,
                    "snapshot": json.dumps([c.as_json() for c in class_snapshot]),
                    "image_count": len(reparto),
                    "train": train,
                    "val": val,
                    "test": test,
                    "seed": split_seed,
                    "by": str(created_by),
                },
            )
        ).mappings().one()

        version_id = fila["id"]

        # Los items van en UNA sentencia con `unnest`: con 17 imágenes la diferencia
        # es despreciable, pero con 5.000 serían 5.000 viajes de 260 ms contra el
        # pooler — media hora para congelar un dataset.
        if reparto:
            await self._session.execute(
                text(
                    "INSERT INTO ai.dataset_items "
                    "(dataset_version_id, image_id, project_id, split) "
                    "SELECT CAST(:vid AS uuid), CAST(t.image_id AS uuid), "
                    "       CAST(:pid AS uuid), t.split "
                    "FROM unnest(CAST(:ids AS text[]), CAST(:splits AS text[])) "
                    "     AS t(image_id, split)"
                ),
                {
                    "vid": str(version_id),
                    "pid": str(project_id),
                    "ids": [str(i) for i, _ in reparto],
                    "splits": [s for _, s in reparto],
                },
            )

        return self._to_entity(fila)

    async def lock_project(self, project_id: UUID) -> None:
        """Serializa los congelados del mismo proyecto.

        Mismo patrón y mismo namespace que `ClassRepository.create`: el lock es por
        proyecto —dos proyectos congelan en paralelo— y se libera con la transacción,
        así que no hay `unlock` que olvidar en el camino de error.
        """
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock(:ns, hashtext(:pid))"),
            {"ns": 4243, "pid": str(project_id)},
        )

    # ── Exportación ───────────────────────────────────────────────────────────
    async def export_rows(self, version_id: UUID) -> Sequence[RowMapping]:
        """Todo lo que hace falta para escribir el dataset en disco, en UNA consulta.

        Devuelve una fila por ANOTACIÓN, más una fila por imagen sin anotaciones
        (`LEFT JOIN`), porque una imagen negativa también tiene que aparecer en el
        export: YOLO espera su `.txt` vacío y sin él la trataría como no vista.

        El `class_index` sale de `ai.classes` y no del snapshot: son el mismo número
        —el snapshot se toma de ahí al congelar— y traerlo en el JOIN evita cruzar
        dos estructuras en Python para cada caja.
        """
        stmt = text(
            "SELECT di.split, i.id AS image_id, a.id AS asset_id, "
            "       a.object_path, a.original_filename, a.content_type, "
            "       an.cx, an.cy, an.w, an.h, c.class_index "
            "FROM ai.dataset_items di "
            "JOIN ai.images i  ON i.id = di.image_id "
            "JOIN ai.assets a  ON a.id = i.asset_id "
            "LEFT JOIN ai.annotations an ON an.image_id = i.id AND an.deleted_at IS NULL "
            "LEFT JOIN ai.classes c ON c.id = an.class_id "
            "WHERE di.dataset_version_id = CAST(:vid AS uuid) "
            "ORDER BY di.split, i.created_at, an.created_at"
        )
        return (await self._session.execute(stmt, {"vid": str(version_id)})).mappings().all()
