"""Repositorio del catálogo: frameworks y arquitecturas.

Solo lectura en el Bloque 1. Añadir o desactivar arquitecturas exige
`ai_architectures:write` y llegará cuando haya interfaz para administrarlo; el
trigger `ai.protect_architecture_contract()` ya limita qué se puede cambiar.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from olo.domain.ai.catalog import Architecture, Framework
from olo.domain.ai.model import InputType, Task

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy import RowMapping
    from sqlalchemy.ext.asyncio import AsyncSession

_ARCH_COLUMNS = (
    "code, framework_code, display_name, family, "
    "supported_tasks, supported_input_types, supported_annotation_kinds, "
    "requires_training, requires_annotations, weights_extension, "
    "default_hyperparams, hyperparam_schema, min_images_recommended, "
    "approx_weights_mb, is_active, notes"
)


class CatalogRepository:
    """No hereda de `BaseRepository`: estas tablas no tienen `id`, `version` ni
    `deleted_at`. Su clave primaria es el `code`, y se desactivan con `is_active`
    en lugar de borrarse — un catálogo con una fila menos dejaría huérfano a todo
    modelo que la referenciara, así que la FK lo impide.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Frameworks ─────────────────────────────────────────────────────────
    async def list_frameworks(self, *, only_active: bool = True) -> Sequence[Framework]:
        """Sin paginar: son seis y no van a ser cientos.

        Un endpoint paginado para seis filas obligaría al cliente a manejar un cursor
        que nunca tendrá segunda página.
        """
        condicion = "WHERE is_active" if only_active else ""
        stmt = text(
            "SELECT code, display_name, adapter, is_active, notes "  # noqa: S608
            f"FROM ai.frameworks {condicion} ORDER BY display_name"
        )
        rows = (await self._session.execute(stmt)).mappings().all()
        return [
            Framework(
                code=r["code"],
                display_name=r["display_name"],
                adapter=r["adapter"],
                is_active=r["is_active"],
                notes=r["notes"],
            )
            for r in rows
        ]

    # ── Arquitecturas ──────────────────────────────────────────────────────
    def _to_architecture(self, row: RowMapping) -> Architecture:
        return Architecture(
            code=row["code"],
            framework_code=row["framework_code"],
            display_name=row["display_name"],
            family=row["family"],
            # Los dominios `ai.task[]` y `ai.input_type[]` llegan como listas de str.
            # Se convierten a los enums del dominio para que un valor que la base
            # tenga y Python no falle AQUÍ, con el nombre del valor, en lugar de
            # producir un comportamiento raro más adelante.
            supported_tasks=frozenset(Task(t) for t in row["supported_tasks"]),
            supported_input_types=frozenset(
                InputType(i) for i in row["supported_input_types"]
            ),
            supported_annotation_kinds=frozenset(row["supported_annotation_kinds"] or ()),
            requires_training=row["requires_training"],
            requires_annotations=row["requires_annotations"],
            weights_extension=row["weights_extension"],
            default_hyperparams=row["default_hyperparams"] or {},
            hyperparam_schema=row["hyperparam_schema"] or {},
            min_images_recommended=row["min_images_recommended"],
            approx_weights_mb=row["approx_weights_mb"],
            is_active=row["is_active"],
            notes=row["notes"],
        )

    async def get_architecture(self, code: str) -> Architecture | None:
        stmt = text(
            f"SELECT {_ARCH_COLUMNS} FROM ai.architectures WHERE code = :code"  # noqa: S608
        )
        row = (await self._session.execute(stmt, {"code": code})).mappings().first()
        return self._to_architecture(row) if row else None

    async def list_architectures(
        self,
        *,
        framework: str | None = None,
        task: Task | None = None,
        only_active: bool = True,
    ) -> Sequence[Architecture]:
        """Dieciséis hoy, quizá cincuenta en dos años. Tampoco se pagina.

        El filtro por `task` usa el operador de contención de arrays sobre
        `supported_tasks`, que es lo que permite responder «¿qué arquitecturas
        sirven para OCR?» sin traerlas todas y filtrar en Python.
        """
        condiciones: list[str] = []
        params: dict[str, Any] = {}

        if only_active:
            condiciones.append("is_active")
        if framework:
            condiciones.append("framework_code = :framework")
            params["framework"] = framework
        if task is not None:
            condiciones.append("CAST(:task AS ai.task) = ANY(supported_tasks)")
            params["task"] = task.value

        where = f"WHERE {' AND '.join(condiciones)}" if condiciones else ""
        stmt = text(
            f"SELECT {_ARCH_COLUMNS} FROM ai.architectures {where} "  # noqa: S608
            "ORDER BY family, code"
        )
        rows = (await self._session.execute(stmt, params)).mappings().all()
        return [self._to_architecture(r) for r in rows]
