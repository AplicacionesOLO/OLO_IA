"""Repositorios de clases y del vocabulario de cada modelo."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from olo.db.repository import BaseRepository
from olo.domain.ai.klass import AiClass, ModelClass, siguiente_class_index

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from sqlalchemy import RowMapping

_COLUMNS = (
    "id, project_id, name, class_index, color, description, is_active, "
    "created_at, created_by, updated_at, updated_by, version, deleted_at"
)

# Namespace del advisory lock. Un entero arbitrario pero FIJO: separa nuestros
# bloqueos de cualquier otro uso de `hashtext` sobre el mismo UUID en la base, que
# de otro modo colisionaría por casualidad y produciría esperas inexplicables.
_LOCK_NAMESPACE = 4243


class ClassRepository(BaseRepository[AiClass]):
    schema = "ai"
    table = "classes"
    soft_delete = True

    def _to_entity(self, row: RowMapping) -> AiClass:
        return AiClass(
            id=row["id"],
            project_id=row["project_id"],
            name=row["name"],
            class_index=row["class_index"],
            color=row["color"],
            description=row["description"],
            is_active=row["is_active"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
        )

    async def list_for_project(
        self, project_id: UUID, *, only_active: bool = False
    ) -> Sequence[AiClass]:
        """Todas las clases del proyecto, ordenadas por su índice.

        Sin paginar: un proyecto tiene decenas de clases, no miles, y el anotador
        las necesita todas a la vez para dibujar su paleta. Paginarlas obligaría al
        cliente a recomponer la lista antes de poder pintar nada.
        """
        condiciones = ["project_id = CAST(:project_id AS uuid)", "deleted_at IS NULL"]
        if only_active:
            condiciones.append("is_active")

        stmt = text(
            f"SELECT {_COLUMNS} FROM {self.qualified_name} "  # noqa: S608
            f"WHERE {' AND '.join(condiciones)} ORDER BY class_index ASC"
        )
        rows = (
            await self._session.execute(stmt, {"project_id": str(project_id)})
        ).mappings().all()
        return [self._to_entity(r) for r in rows]

    async def create(
        self, project_id: UUID, datos: dict[str, Any], *, created_by: UUID
    ) -> AiClass:
        """Crea la clase asignando `class_index` de forma SEGURA ante concurrencia.

        ── LA ESTRATEGIA, Y POR QUÉ ESTA ────────────────────────────────────

        `pg_advisory_xact_lock(4243, hashtext(project_id))` antes de calcular el
        siguiente índice, en la MISMA transacción que el INSERT. El lock se libera
        con la transacción, así que no hay `unlock` que se pueda olvidar ni en el
        camino de error.

        Sin él, dos peticiones simultáneas leerían el mismo `max(class_index)`,
        calcularían el mismo valor y una violaría `uq_class_indice`. Con él, la
        segunda espera a que la primera confirme y ve el índice ya usado.

        Descarté las tres alternativas por motivos concretos:

          · **contador por proyecto** — añade una columna que puede desincronizarse
            del máximo real, y entonces hay dos verdades sobre cuál es el siguiente;
          · **secuencia** — es global, así que dejaría huecos entre proyectos, y no
            se puede crear una por proyecto sin DDL dinámico;
          · **SELECT ... FOR UPDATE** sobre las clases existentes — no protege el
            caso de la PRIMERA clase, cuando no hay filas que bloquear. Y ese es
            justamente el caso de carrera más probable, porque ocurre al crear el
            proyecto.

        El bloqueo es por proyecto, no global: dos proyectos distintos crean clases
        en paralelo sin esperarse.
        """
        await self._session.execute(
            text("SELECT pg_advisory_xact_lock(:ns, hashtext(:pid))"),
            {"ns": _LOCK_NAMESPACE, "pid": str(project_id)},
        )

        # Se leen TODOS los índices, incluidos los de clases borradas: `class_index`
        # no se reutiliza nunca. Reutilizar el 2 de una clase eliminada haría que un
        # modelo entrenado con la antigua interpretara la nueva con esa etiqueta.
        indices = (
            await self._session.execute(
                text(
                    f"SELECT class_index FROM {self.qualified_name} "  # noqa: S608
                    "WHERE project_id = CAST(:pid AS uuid)"
                ),
                {"pid": str(project_id)},
            )
        ).scalars().all()

        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(project_id, name, class_index, color, description, is_active, created_by) "
            "VALUES (CAST(:project_id AS uuid), :name, :class_index, :color, "
            "        :description, :is_active, CAST(:created_by AS uuid)) "
            f"RETURNING {_COLUMNS}"
        )
        row = (
            await self._session.execute(
                stmt,
                {
                    "project_id": str(project_id),
                    "name": datos["name"],
                    "class_index": siguiente_class_index(list(indices)),
                    "color": datos["color"],
                    "description": datos.get("description"),
                    "is_active": datos.get("is_active", True),
                    "created_by": str(created_by),
                },
            )
        ).mappings().one()
        return self._to_entity(row)

    async def update(
        self,
        class_id: UUID,
        cambios: dict[str, Any],
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiClass | None:
        """Nombre, color, descripción y `is_active`. NUNCA `class_index`.

        Si `cambios` trajera `class_index`, el trigger
        `ai.prevent_class_index_change()` abortaría. El esquema Pydantic no lo
        acepta, así que llegar aquí con él sería un error de programación — y es
        correcto que el motor lo rechace en lugar de que esta capa lo filtre en
        silencio.
        """
        if not cambios:
            return await self.get_by_id(class_id)

        sets: list[str] = []
        params: dict[str, Any] = {
            "id": str(class_id),
            "expected": expected_version,
            "updated_by": str(updated_by),
        }
        for clave, valor in cambios.items():
            sets.append(f"{clave} = :{clave}")
            params[clave] = valor

        stmt = text(
            f"UPDATE {self.qualified_name} SET {', '.join(sets)}, "  # noqa: S608
            "version = version + 1, updated_at = now(), "
            "updated_by = CAST(:updated_by AS uuid) "
            "WHERE id = :id AND version = :expected AND deleted_at IS NULL "
            f"RETURNING {_COLUMNS}"
        )
        row = (await self._session.execute(stmt, params)).mappings().first()
        return self._to_entity(row) if row else None

    async def name_taken(
        self, project_id: UUID, name: str, *, excluding: UUID | None = None
    ) -> bool:
        condiciones = [
            "project_id = CAST(:project_id AS uuid)",
            "lower(name) = lower(:name)",
            "deleted_at IS NULL",
        ]
        params: dict[str, Any] = {"project_id": str(project_id), "name": name}
        if excluding is not None:
            condiciones.append("id <> CAST(:excluding AS uuid)")
            params["excluding"] = str(excluding)

        stmt = text(
            f"SELECT EXISTS (SELECT 1 FROM {self.qualified_name} "  # noqa: S608
            f"WHERE {' AND '.join(condiciones)}) AS tomado"
        )
        return bool((await self._session.execute(stmt, params)).scalar_one())


class ModelClassRepository:
    """Vocabulario de un modelo. No hereda de `BaseRepository`.

    `ai.model_classes` tiene clave primaria compuesta `(model_id, class_id)`, sin
    `id`, sin `version` y sin `deleted_at`. Heredar de `BaseRepository` traería
    `get_by_id`, `bump_version` y `soft_delete_by_id`, que no significan nada aquí y
    fallarían con un error de columna inexistente si alguien los llamara.
    """

    def __init__(self, session: Any) -> None:
        self._session = session

    async def list_for_model(self, model_id: UUID) -> Sequence[ModelClass]:
        """El vocabulario en orden de `training_index`, con la clase resuelta.

        El JOIN evita una segunda consulta: quien pinta el vocabulario necesita el
        nombre y el color, no solo los identificadores.
        """
        stmt = text(
            "SELECT mc.model_id, mc.class_id, mc.project_id, mc.training_index, "
            "       mc.created_at, "
            "       c.name AS class_name, c.color AS class_color, "
            "       c.class_index, c.is_active AS class_is_active "
            "FROM ai.model_classes mc "
            "JOIN ai.classes c ON c.id = mc.class_id "
            "WHERE mc.model_id = CAST(:model_id AS uuid) "
            "ORDER BY mc.training_index ASC"
        )
        rows = (
            await self._session.execute(stmt, {"model_id": str(model_id)})
        ).mappings().all()
        return [
            ModelClass(
                model_id=r["model_id"],
                class_id=r["class_id"],
                project_id=r["project_id"],
                training_index=r["training_index"],
                created_at=r["created_at"],
                class_name=r["class_name"],
                class_color=r["class_color"],
                class_index=r["class_index"],
                class_is_active=r["class_is_active"],
            )
            for r in rows
        ]

    async def replace(
        self,
        model_id: UUID,
        project_id: UUID,
        asignaciones: Sequence[tuple[UUID, int]],
        *,
        created_by: UUID,
    ) -> None:
        """Reemplazo COMPLETO del vocabulario, en una sola transacción.

        DELETE + INSERT y no `UPDATE` fila a fila. El motivo es concreto: reemplazar
        `[a,b,c]` por `[c,a,b]` con actualizaciones individuales viola
        `uq_mc_indice` a mitad de camino, porque durante un instante dos clases
        tendrían el mismo `training_index`. Borrar todo y reinsertar no pasa por
        ningún estado intermedio inválido.

        Se pierde `created_at` de las filas que sobreviven al reemplazo. Es
        aceptable: `ai.model_classes` no es un registro histórico —para eso está
        `platform.privileged_operation_log`— y conservarlo exigiría un
        `UPDATE ... FROM` con los índices finales precalculados, más complejo por un
        dato que nadie consulta.

        Si el modelo ya tiene versiones, el trigger `trg_mc_inmutable` aborta en el
        DELETE y la transacción entera se deshace. El vocabulario NO queda a medias.
        """
        await self._session.execute(
            text("DELETE FROM ai.model_classes WHERE model_id = CAST(:model_id AS uuid)"),
            {"model_id": str(model_id)},
        )

        if not asignaciones:
            return

        # executemany: una sola ida y vuelta para las N clases.
        await self._session.execute(
            text(
                "INSERT INTO ai.model_classes "
                "(model_id, class_id, project_id, training_index, created_by) "
                "VALUES (CAST(:model_id AS uuid), CAST(:class_id AS uuid), "
                "        CAST(:project_id AS uuid), :training_index, "
                "        CAST(:created_by AS uuid))"
            ),
            [
                {
                    "model_id": str(model_id),
                    "class_id": str(class_id),
                    "project_id": str(project_id),
                    "training_index": indice,
                    "created_by": str(created_by),
                }
                for class_id, indice in asignaciones
            ],
        )

    async def inactive_class_ids(
        self, project_id: UUID, class_ids: Sequence[UUID]
    ) -> Sequence[UUID]:
        """Cuáles de esas clases están desactivadas o no son del proyecto.

        Una sola consulta para las dos comprobaciones, porque el mensaje de error las
        trata igual: la clase no se puede usar. Distinguirlas obligaría a dos viajes
        para decir lo mismo.
        """
        if not class_ids:
            return []

        stmt = text(
            "SELECT c.id FROM ai.classes c "
            "WHERE c.id = ANY(CAST(:ids AS uuid[])) "
            "  AND (c.project_id <> CAST(:pid AS uuid) "
            "       OR NOT c.is_active OR c.deleted_at IS NOT NULL)"
        )
        filas = (
            await self._session.execute(
                stmt,
                {"ids": [str(c) for c in class_ids], "pid": str(project_id)},
            )
        ).scalars().all()
        return list(filas)

    async def missing_class_ids(
        self, project_id: UUID, class_ids: Sequence[UUID]
    ) -> Sequence[UUID]:
        """Las que no existen en el proyecto en absoluto.

        Se separa de `inactive_class_ids` porque el código HTTP difiere: una clase
        inexistente es 422 por referencia inválida, una desactivada es 422 por regla
        de negocio, y el mensaje tiene que decir cuál de las dos cosas pasa.
        """
        if not class_ids:
            return []

        stmt = text(
            "SELECT x.id FROM unnest(CAST(:ids AS uuid[])) AS x(id) "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM ai.classes c "
            "   WHERE c.id = x.id AND c.project_id = CAST(:pid AS uuid) "
            "     AND c.deleted_at IS NULL)"
        )
        filas = (
            await self._session.execute(
                stmt,
                {"ids": [str(c) for c in class_ids], "pid": str(project_id)},
            )
        ).scalars().all()
        return list(filas)
