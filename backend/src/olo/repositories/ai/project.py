"""Repositorio de proyectos de IA."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from olo.db.repository import BaseRepository
from olo.domain.ai.project import AiProject, ProjectStatus

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from sqlalchemy import RowMapping

# Orden total y estable: `slug` es único entre los vivos y `id` desempata. Sin un
# orden determinista la paginación por cursor repetiría o se saltaría filas.
_COLUMNS = (
    "id, name, slug, description, status, "
    "frame_interval_seconds, max_frames_per_video, max_video_duration_secs, "
    "created_at, created_by, updated_at, updated_by, version, deleted_at"
)


class ProjectRepository(BaseRepository[AiProject]):
    schema = "ai"
    table = "projects"
    soft_delete = True

    def _to_entity(self, row: RowMapping) -> AiProject:
        return AiProject(
            id=row["id"],
            name=row["name"],
            slug=row["slug"],
            description=row["description"],
            status=ProjectStatus(row["status"]),
            # numeric(6,3) llega como Decimal; el dominio lo quiere float.
            frame_interval_seconds=float(row["frame_interval_seconds"]),
            max_frames_per_video=row["max_frames_per_video"],
            max_video_duration_secs=row["max_video_duration_secs"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
        )

    async def list_page(
        self,
        *,
        limit: int,
        cursor: tuple[str, UUID] | None = None,
        status: ProjectStatus | None = None,
        search: str | None = None,
    ) -> Sequence[AiProject]:
        """Una página por keyset, pidiendo `limit + 1` para saber si hay más.

        Sin `OFFSET`: con offset, insertar una fila mientras alguien pagina desplaza
        el resto y produce duplicados o huecos. El cursor apunta a la última fila
        vista, así que es estable ante inserciones.
        """
        condiciones = ["deleted_at IS NULL"]
        params: dict[str, Any] = {"limit": limit + 1}

        if cursor is not None:
            # Comparación de tuplas: es lo que hace que el keyset funcione con un
            # orden compuesto sin escribir el OR anidado a mano.
            condiciones.append("(slug, id) > (:cursor_slug, CAST(:cursor_id AS uuid))")
            params["cursor_slug"], params["cursor_id"] = cursor[0], str(cursor[1])

        if status is not None:
            condiciones.append("status = :status")
            params["status"] = status.value

        if search:
            condiciones.append("(name ILIKE :search OR slug ILIKE :search)")
            params["search"] = f"%{search}%"

        stmt = text(
            f"SELECT {_COLUMNS} FROM {self.qualified_name} "  # noqa: S608
            f"WHERE {' AND '.join(condiciones)} "
            "ORDER BY slug ASC, id ASC LIMIT :limit"
        )
        rows = (await self._session.execute(stmt, params)).mappings().all()
        return [self._to_entity(r) for r in rows]

    async def create(self, datos: dict[str, Any], *, created_by: UUID) -> AiProject:
        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(name, slug, description, status, frame_interval_seconds, "
            " max_frames_per_video, max_video_duration_secs, created_by) "
            "VALUES (:name, :slug, :description, :status, :frame_interval_seconds, "
            "        :max_frames_per_video, :max_video_duration_secs, "
            "        CAST(:created_by AS uuid)) "
            f"RETURNING {_COLUMNS}"
        )
        row = (
            await self._session.execute(
                stmt,
                {
                    "name": datos["name"],
                    "slug": datos["slug"],
                    "description": datos.get("description"),
                    "status": datos.get("status", ProjectStatus.DRAFT.value),
                    "frame_interval_seconds": datos.get("frame_interval_seconds", 1.0),
                    "max_frames_per_video": datos.get("max_frames_per_video", 1000),
                    "max_video_duration_secs": datos.get("max_video_duration_secs", 1200),
                    "created_by": str(created_by),
                },
            )
        ).mappings().one()
        return self._to_entity(row)

    async def update(
        self,
        project_id: UUID,
        cambios: dict[str, Any],
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiProject | None:
        """Actualización parcial con bloqueo optimista.

        Devuelve `None` si la versión no coincide o la fila ya está borrada. El
        servicio lo traduce a 412 o 404 según lo que encuentre al releer: aquí no se
        puede distinguir, y adivinarlo daría el código equivocado la mitad de las
        veces.
        """
        if not cambios:
            return await self.get_by_id(project_id)

        sets: list[str] = []
        params: dict[str, Any] = {
            "id": str(project_id),
            "expected": expected_version,
            "updated_by": str(updated_by),
        }
        for clave, valor in cambios.items():
            sets.append(f"{clave} = :{clave}")
            params[clave] = valor.value if isinstance(valor, ProjectStatus) else valor

        stmt = text(
            f"UPDATE {self.qualified_name} SET {', '.join(sets)}, "  # noqa: S608
            "version = version + 1, updated_at = now(), "
            "updated_by = CAST(:updated_by AS uuid) "
            "WHERE id = :id AND version = :expected AND deleted_at IS NULL "
            f"RETURNING {_COLUMNS}"
        )
        row = (await self._session.execute(stmt, params)).mappings().first()
        return self._to_entity(row) if row else None

    async def has_models(self, project_id: UUID) -> bool:
        """¿Tiene modelos vivos?

        Se comprueba en la aplicación porque la base no puede: las FK impiden borrar
        filas, pero aquí el borrado es lógico y las FK no lo ven — el mismo
        razonamiento que `WarehouseRepository.has_dependencies`.
        """
        stmt = text(
            "SELECT EXISTS (SELECT 1 FROM ai.models "
            " WHERE project_id = CAST(:id AS uuid) AND deleted_at IS NULL) AS dep"
        )
        return bool(
            (await self._session.execute(stmt, {"id": str(project_id)})).scalar_one()
        )
