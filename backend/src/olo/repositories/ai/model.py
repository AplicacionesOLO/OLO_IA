"""Repositorio de modelos lógicos.

⚠ ESCRIBE CONTRA `ai.models`, LEE DE `ai.models_resolved`.

La vista es un READ MODEL, no el contrato del dominio (migración 0044). Toda
escritura va contra la tabla; la vista solo enriquece lecturas con el framework y el
adaptador resueltos por JOIN. Que la vista no sea insertable lo comprueba la propia
migración, para que nadie la convierta en una segunda puerta de escritura con sus
propias invariantes.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from olo.db.repository import BaseRepository
from olo.domain.ai.model import AiModel, InputType, ModelStatus, Task

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from sqlalchemy import RowMapping

# Columnas de la TABLA, para escrituras y para el RETURNING.
_COLUMNS = (
    "id, project_id, name, slug, description, purpose, architecture_code, "
    "task, input_type, status, requires_training, config, "
    "created_at, created_by, updated_at, updated_by, version, deleted_at"
)

# Columnas de la VISTA: las de la tabla más las derivadas. Se enumeran en lugar de
# usar `*` para que añadir una columna derivada a la vista no cambie en silencio la
# forma de lo que este repositorio devuelve.
_VIEW_COLUMNS = (
    _COLUMNS
    + ", framework_code, framework_name, framework_adapter, "
    "architecture_name, weights_extension"
)


class ModelRepository(BaseRepository[AiModel]):
    schema = "ai"
    table = "models"
    soft_delete = True

    def _to_entity(self, row: RowMapping) -> AiModel:
        # `.get()` en los derivados: la misma función sirve para filas de la tabla
        # (sin ellos) y de la vista (con ellos). Un KeyError aquí obligaría a tener
        # dos constructores casi idénticos.
        return AiModel(
            id=row["id"],
            project_id=row["project_id"],
            name=row["name"],
            slug=row["slug"],
            description=row["description"],
            purpose=row["purpose"],
            architecture_code=row["architecture_code"],
            task=Task(row["task"]),
            input_type=InputType(row["input_type"]),
            status=ModelStatus(row["status"]),
            requires_training=row["requires_training"],
            config=row["config"] or {},
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
            framework_code=row.get("framework_code"),
            framework_name=row.get("framework_name"),
            framework_adapter=row.get("framework_adapter"),
            architecture_name=row.get("architecture_name"),
            weights_extension=row.get("weights_extension"),
            published_version_id=row.get("published_version_id"),
            version_count=row.get("version_count"),
        )

    # ── Lectura enriquecida ────────────────────────────────────────────────
    async def get_resolved(self, model_id: UUID) -> AiModel | None:
        """El modelo con framework resuelto, conteo de versiones y publicada.

        Las dos subconsultas van aquí y no en la vista a propósito: la vista es del
        catálogo de modelos y añadirle agregados sobre `model_versions` la haría
        más caro para todo listado que no los necesite. Aquí se pagan solo al pedir
        el detalle.

        `published_version_id` es lo que sustituye a la columna que 0043 eliminó: una
        sonda al índice único `uq_mv_publicada`.
        """
        stmt = text(
            f"SELECT {_VIEW_COLUMNS}, "  # noqa: S608
            " (SELECT count(1) FROM ai.model_versions mv "
            "   WHERE mv.model_id = v.id AND mv.deleted_at IS NULL) AS version_count, "
            " (SELECT mv.id FROM ai.model_versions mv "
            "   WHERE mv.model_id = v.id AND mv.status = 'published' "
            "     AND mv.deleted_at IS NULL) AS published_version_id "
            "FROM ai.models_resolved v "
            "WHERE v.id = CAST(:id AS uuid) AND v.deleted_at IS NULL"
        )
        row = (await self._session.execute(stmt, {"id": str(model_id)})).mappings().first()
        return self._to_entity(row) if row else None

    async def list_page(
        self,
        *,
        project_id: UUID,
        limit: int,
        cursor: tuple[str, UUID] | None = None,
        task: Task | None = None,
        status: ModelStatus | None = None,
        search: str | None = None,
    ) -> Sequence[AiModel]:
        condiciones = ["project_id = CAST(:project_id AS uuid)", "deleted_at IS NULL"]
        params: dict[str, Any] = {"project_id": str(project_id), "limit": limit + 1}

        if cursor is not None:
            condiciones.append("(slug, id) > (:cursor_slug, CAST(:cursor_id AS uuid))")
            params["cursor_slug"], params["cursor_id"] = cursor[0], str(cursor[1])

        if task is not None:
            condiciones.append("task = :task")
            params["task"] = task.value

        if status is not None:
            condiciones.append("status = :status")
            params["status"] = status.value

        if search:
            condiciones.append("(name ILIKE :search OR slug ILIKE :search)")
            params["search"] = f"%{search}%"

        """
        ── EL LISTADO CUENTA LAS VERSIONES, IGUAL QUE EL DETALLE ─────────────────────

        No lo hacía, y la pantalla las enseña: TODOS los modelos aparecían con «0
        versiones», incluido el que estaba publicado y ejecutándose. Alguien mirando el
        Motor de IA concluía, con toda lógica, que ninguno de esos modelos era el que
        analiza sus vídeos — cuando `Detector de alturas` tenía cuatro versiones y una
        publicada—.

        El detalle sí las contaba, así que la lista y la ficha del mismo modelo decían cosas
        distintas. Eso es peor que no enseñar el número: obliga a decidir a cuál creer.

        Las subconsultas se pagan por página —como mucho unas decenas de modelos— y no en
        la vista, que es del catálogo y la usan listados que no las necesitan.
        """
        stmt = text(
            f"SELECT {_VIEW_COLUMNS}, "  # noqa: S608
            " (SELECT count(1) FROM ai.model_versions mv "
            "   WHERE mv.model_id = v.id AND mv.deleted_at IS NULL) AS version_count, "
            " (SELECT mv.id FROM ai.model_versions mv "
            "   WHERE mv.model_id = v.id AND mv.status = 'published' "
            "     AND mv.deleted_at IS NULL) AS published_version_id "
            "FROM ai.models_resolved v "
            f"WHERE {' AND '.join(condiciones)} "
            "ORDER BY v.slug ASC, v.id ASC LIMIT :limit"
        )
        rows = (await self._session.execute(stmt, params)).mappings().all()
        return [self._to_entity(r) for r in rows]

    # ── Escritura, siempre contra la tabla ─────────────────────────────────
    async def create(
        self, project_id: UUID, datos: dict[str, Any], *, created_by: UUID
    ) -> AiModel:
        """Crea el modelo. `requires_training` lo pone el TRIGGER, no nosotros.

        Se envía un valor porque la columna es NOT NULL, pero
        `ai.validate_model_against_architecture()` lo sobrescribe con el de la
        arquitectura en el INSERT. Mandar `false` en lugar de adivinar deja claro en
        el código que el valor no es nuestro.
        """
        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(project_id, name, slug, description, purpose, architecture_code, "
            " task, input_type, status, requires_training, config, created_by) "
            "VALUES (CAST(:project_id AS uuid), :name, :slug, :description, :purpose, "
            "        :architecture_code, :task, :input_type, :status, false, "
            "        CAST(:config AS jsonb), CAST(:created_by AS uuid)) "
            f"RETURNING {_COLUMNS}"
        )
        import json

        row = (
            await self._session.execute(
                stmt,
                {
                    "project_id": str(project_id),
                    "name": datos["name"],
                    "slug": datos["slug"],
                    "description": datos.get("description"),
                    "purpose": datos.get("purpose"),
                    "architecture_code": datos["architecture_code"],
                    "task": datos["task"],
                    "input_type": datos["input_type"],
                    "status": datos.get("status", ModelStatus.DRAFT.value),
                    "config": json.dumps(datos.get("config") or {}),
                    "created_by": str(created_by),
                },
            )
        ).mappings().one()
        return self._to_entity(row)

    async def update(
        self,
        model_id: UUID,
        cambios: dict[str, Any],
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiModel | None:
        if not cambios:
            return await self.get_by_id(model_id)

        import json

        sets: list[str] = []
        params: dict[str, Any] = {
            "id": str(model_id),
            "expected": expected_version,
            "updated_by": str(updated_by),
        }
        for clave, valor in cambios.items():
            if clave == "config":
                sets.append("config = CAST(:config AS jsonb)")
                params["config"] = json.dumps(valor or {})
            else:
                sets.append(f"{clave} = :{clave}")
                params[clave] = valor.value if hasattr(valor, "value") else valor

        stmt = text(
            f"UPDATE {self.qualified_name} SET {', '.join(sets)}, "  # noqa: S608
            "version = version + 1, updated_at = now(), "
            "updated_by = CAST(:updated_by AS uuid) "
            "WHERE id = :id AND version = :expected AND deleted_at IS NULL "
            f"RETURNING {_COLUMNS}"
        )
        row = (await self._session.execute(stmt, params)).mappings().first()
        return self._to_entity(row) if row else None

    async def count_versions(self, model_id: UUID) -> int:
        """Cuántas versiones no eliminadas tiene.

        Es lo que determina si su contrato está congelado. Se consulta ANTES de
        intentar un PATCH que toque campos inmutables, para responder con un mensaje
        que nombre los campos en lugar de dejar que el trigger produzca un 409 seco.
        """
        stmt = text(
            "SELECT count(1) FROM ai.model_versions "
            "WHERE model_id = CAST(:id AS uuid) AND deleted_at IS NULL"
        )
        return int((await self._session.execute(stmt, {"id": str(model_id)})).scalar_one())

    async def slug_taken(
        self, project_id: UUID, slug: str, *, excluding: UUID | None = None
    ) -> bool:
        """Comprobación previa, no la garantía.

        La garantía es `uq_model_slug`. Esto solo permite responder 409 con un
        mensaje útil en el caso normal; en una carrera gana el índice y el servicio
        traduce la violación de unicidad igualmente.
        """
        condiciones = [
            "project_id = CAST(:project_id AS uuid)",
            "slug = :slug",
            "deleted_at IS NULL",
        ]
        params: dict[str, Any] = {"project_id": str(project_id), "slug": slug}
        if excluding is not None:
            condiciones.append("id <> CAST(:excluding AS uuid)")
            params["excluding"] = str(excluding)

        stmt = text(
            f"SELECT EXISTS (SELECT 1 FROM {self.qualified_name} "  # noqa: S608
            f"WHERE {' AND '.join(condiciones)}) AS tomado"
        )
        return bool((await self._session.execute(stmt, params)).scalar_one())
