"""Servicio de almacenes: orquesta el caso de uso.

Lo que corresponde a esta capa y no al repositorio: validar reglas de negocio
que necesitan más de una consulta, traducir errores del motor a errores de
negocio y construir el cursor de paginación.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from olo.core.errors import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    VersionConflictError,
)
from olo.domain.warehouse import DomainRuleError, Warehouse, WarehouseStatus
from olo.repositories.warehouse import WarehouseRepository

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 20


@dataclass(frozen=True, slots=True)
class Page:
    items: Sequence[Warehouse]
    next_cursor: str | None


def _encode_cursor(code: str, entity_id: UUID) -> str:
    raw = f"{code}\x00{entity_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        code, _, raw_id = base64.urlsafe_b64decode(padded).decode().partition("\x00")
        return code, UUID(raw_id)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise BusinessRuleError("El cursor de paginación no es válido") from exc


class WarehouseService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._session = session
        self._ctx = ctx
        self._repo = WarehouseRepository(session)

    async def list_warehouses(
        self,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        company_id: UUID | None = None,
        status: WarehouseStatus | None = None,
        search: str | None = None,
    ) -> Page:
        size = max(1, min(limit, MAX_PAGE_SIZE))
        cursor_code: str | None = None
        cursor_id: UUID | None = None
        if cursor:
            cursor_code, cursor_id = _decode_cursor(cursor)

        # Se pide una fila extra para saber si hay página siguiente sin
        # necesidad de un COUNT, que sobre tablas grandes es costoso.
        rows = await self._repo.list_page(
            limit=size + 1,
            cursor_code=cursor_code,
            cursor_id=cursor_id,
            company_id=company_id,
            status=status,
            search=search,
        )

        has_more = len(rows) > size
        items = list(rows[:size])
        next_cursor = _encode_cursor(items[-1].code, items[-1].id) if has_more and items else None
        return Page(items=items, next_cursor=next_cursor)

    async def get_warehouse(self, warehouse_id: UUID) -> Warehouse:
        """404 si no existe **o si es de otro tenant o almacén no accesible**.

        RLS lo oculta, así que llega aquí como «no existe». Devolver 403
        confirmaría su existencia y sería una fuga por canal lateral.
        """
        wh = await self._repo.get_by_id(warehouse_id)
        if wh is None:
            raise NotFoundError("Almacén no encontrado", resource_id=str(warehouse_id))
        return wh

    async def create_warehouse(
        self,
        *,
        company_id: UUID,
        name: str,
        code: str,
        timezone: str,
        locale: str = "es",
        currency_code: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        address: dict[str, object] | None = None,
    ) -> Warehouse:
        now = _utcnow()
        try:
            candidate = Warehouse(
                id=uuid4(),
                tenant_id=self._ctx.tenant_id,
                company_id=company_id,
                name=name,
                code=code.upper(),
                status=WarehouseStatus.ACTIVE,
                timezone=timezone,
                locale=locale,
                currency_code=currency_code,
                latitude=latitude,
                longitude=longitude,
                address=address,  # type: ignore[arg-type]
                settings={},
                version=1,
                created_at=now,
                updated_at=now,
            )
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        # Comprobación previa para dar un 409 con mensaje útil. No sustituye al
        # índice único: entre esta consulta y el INSERT cabe una carrera, y es
        # el índice el que la resuelve. Aquí solo se mejora el mensaje del caso
        # habitual.
        if await self._repo.get_by_code(company_id, candidate.code) is not None:
            raise ConflictError(
                f"Ya existe un almacén con el código {candidate.code} en esta compañía",
                code=candidate.code,
            )

        return await self._repo.insert(candidate, created_by=None)


    async def update_warehouse(
        self, warehouse_id: UUID, changes: dict[str, object], *, expected_version: int
    ) -> Warehouse:
        """Actualización parcial con optimistic locking.

        Distingue tres situaciones que el cliente necesita diferenciar:
          • el almacén no existe o no es accesible  → 404
          • existe pero la versión no coincide      → 412
          • los datos violan una regla de dominio   → 422
        """
        current = await self.get_warehouse(warehouse_id)   # 404 si no procede

        # Se valida el resultado ANTES de escribir, construyendo la entidad
        # resultante. Así una regla de dominio da 422 con mensaje claro en lugar
        # de un CHECK del motor traducido a un error genérico.
        merged = {
            "name": changes.get("name", current.name),
            "latitude": changes.get("latitude", current.latitude),
            "longitude": changes.get("longitude", current.longitude),
        }
        try:
            Warehouse(
                id=current.id, tenant_id=current.tenant_id, company_id=current.company_id,
                name=str(merged["name"]), code=current.code, status=current.status,
                timezone=str(changes.get("timezone", current.timezone)),
                locale=str(changes.get("locale", current.locale)),
                version=current.version, created_at=current.created_at,
                updated_at=current.updated_at,
                latitude=merged["latitude"],  # type: ignore[arg-type]
                longitude=merged["longitude"],  # type: ignore[arg-type]
            )
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        updated = await self._repo.update(
            warehouse_id, changes, expected_version=expected_version
        )
        if updated is None:
            raise VersionConflictError(
                "El almacén fue modificado por otra operación. Vuelve a leerlo y reintenta.",
                resource_id=str(warehouse_id),
                expected_version=expected_version,
                current_version=current.version,
            )
        return updated

    async def delete_warehouse(self, warehouse_id: UUID, *, expected_version: int) -> None:
        """Borrado lógico. Rechaza el borrado si el almacén tiene contenido.

        Es una regla de negocio, no una FK: el borrado es lógico y las claves
        foráneas no lo ven. Sin esta comprobación quedarían áreas y ubicaciones
        vivas apuntando a un almacén borrado.
        """
        current = await self.get_warehouse(warehouse_id)

        if await self._repo.has_dependencies(warehouse_id):
            raise ConflictError(
                "El almacén tiene áreas o ubicaciones activas. Elimínalas primero.",
                resource_id=str(warehouse_id),
            )

        if not await self._repo.mark_deleted(warehouse_id, expected_version=expected_version):
            raise VersionConflictError(
                "El almacén fue modificado por otra operación. Vuelve a leerlo y reintenta.",
                resource_id=str(warehouse_id),
                expected_version=expected_version,
                current_version=current.version,
            )

def _utcnow() -> datetime:
    from datetime import UTC, datetime

    return datetime.now(UTC)
