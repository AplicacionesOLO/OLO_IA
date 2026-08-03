"""Repositorio base.

Deliberadamente delgado. Aquí NO hay lógica de negocio: solo el patrón de
acceso común y el manejo de optimistic locking, que es infraestructura.

Sobre el aislamiento: los repositorios **no añaden `WHERE tenant_id = ...`**.
Lo hace RLS en el motor. Filtrar también aquí daría una falsa sensación de
seguridad —invitaría a confiar en el filtro de la aplicación— y ocultaría un
fallo de política RLS en vez de dejarlo a la vista. El único filtro que sí
corresponde a esta capa es el de soft delete, que es negocio, no seguridad.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from olo.core.errors import NotFoundError, VersionConflictError

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


class BaseRepository[T]:
    """Base para repositorios de una tabla concreta.

    Subclases deben definir `schema`, `table` y `_to_entity`.
    """

    schema: str
    table: str
    soft_delete: bool = True

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Identificador cualificado, validado ───────────────────────────────
    @property
    def qualified_name(self) -> str:
        # Los nombres vienen de constantes de clase, nunca de entrada de
        # usuario. La comprobación protege frente a una subclase mal escrita.
        for part in (self.schema, self.table):
            if not part.replace("_", "").isalnum():
                msg = f"Identificador de tabla no válido: {part!r}"
                raise ValueError(msg)
        return f"{self.schema}.{self.table}"

    def _to_entity(self, row: Any) -> T:
        raise NotImplementedError

    # ── Lectura ───────────────────────────────────────────────────────────
    async def get_by_id(self, entity_id: UUID) -> T | None:
        alive = " AND deleted_at IS NULL" if self.soft_delete else ""
        stmt = text(f"SELECT * FROM {self.qualified_name} WHERE id = :id{alive}")  # noqa: S608
        row = (await self._session.execute(stmt, {"id": str(entity_id)})).mappings().first()
        return self._to_entity(row) if row else None

    async def require_by_id(self, entity_id: UUID) -> T:
        """Igual que `get_by_id`, pero lanza 404 si no hay fila.

        Un recurso de otro tenant es invisible por RLS, así que llega aquí como
        «no existe» y produce 404. Es lo correcto: un 403 confirmaría su
        existencia y sería una fuga por canal lateral.
        """
        entity = await self.get_by_id(entity_id)
        if entity is None:
            raise NotFoundError(f"{self.table} not found", resource_id=str(entity_id))
        return entity

    async def exists(self, entity_id: UUID) -> bool:
        alive = " AND deleted_at IS NULL" if self.soft_delete else ""
        stmt = text(f"SELECT 1 FROM {self.qualified_name} WHERE id = :id{alive}")  # noqa: S608
        return (await self._session.execute(stmt, {"id": str(entity_id)})).first() is not None

    # ── Escritura con optimistic locking ──────────────────────────────────
    async def bump_version(self, entity_id: UUID, expected_version: int) -> int:
        """Incrementa `version` si coincide con la esperada.

        `version` la incrementa la SENTENCIA de la aplicación, nunca el trigger
        `set_updated_at`: si lo hiciera, cualquier escritura de sistema
        invalidaría la versión que el cliente tiene en mano y produciría 412
        sin causa real.
        """
        stmt = text(
            f"UPDATE {self.qualified_name} "  # noqa: S608
            "SET version = version + 1, updated_at = now() "
            "WHERE id = :id AND version = :expected RETURNING version"
        )
        row = (
            await self._session.execute(
                stmt, {"id": str(entity_id), "expected": expected_version}
            )
        ).first()
        if row is None:
            raise VersionConflictError(
                "Version mismatch", resource_id=str(entity_id), expected=expected_version
            )
        return int(row[0])

    async def soft_delete_by_id(self, entity_id: UUID, *, expected_version: int) -> None:
        """Borrado lógico explícito.

        NUNCA por trigger: se verificó que un trigger de soft delete en
        BEFORE UPDATE marca `deleted_at` en cualquier actualización —renombrar
        una entidad la eliminaba— y que en BEFORE DELETE no hace nada mientras
        el borrado físico ocurre en silencio.
        """
        if not self.soft_delete:
            msg = f"{self.qualified_name} no admite soft delete"
            raise NotImplementedError(msg)
        stmt = text(
            f"UPDATE {self.qualified_name} "  # noqa: S608
            "SET deleted_at = now(), version = version + 1, updated_at = now() "
            "WHERE id = :id AND version = :expected AND deleted_at IS NULL"
        )
        result = await self._session.execute(
            stmt, {"id": str(entity_id), "expected": expected_version}
        )
        if result.rowcount == 0:
            raise VersionConflictError("Version mismatch or already deleted",
                                       resource_id=str(entity_id))
