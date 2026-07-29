"""Repositorio de almacenes.

No filtra por `tenant_id` ni por almacén accesible: lo hace RLS en el motor.
Filtrar también aquí ocultaría un fallo de política en lugar de dejarlo a la
vista, y daría una falsa sensación de seguridad.

El único filtro de esta capa es `deleted_at IS NULL`, que es negocio.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

from olo.db.repository import BaseRepository
from olo.domain.warehouse import Warehouse, WarehouseStatus

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

_COLUMNS = (
    "id, tenant_id, company_id, name, code, status, timezone, locale, "
    "currency_code, latitude, longitude, address, settings, version, "
    "created_at, updated_at, deleted_at"
)

# Orden total y estable: `code` es único por company y `id` desempata. Sin un
# orden determinista la paginación por cursor repetiría o se saltaría filas.
_ORDER = "code ASC, id ASC"


class WarehouseRepository(BaseRepository[Warehouse]):
    schema = "core"
    table = "warehouses"
    soft_delete = True

    def _to_entity(self, row: Mapping[str, Any]) -> Warehouse:
        return Warehouse(
            id=row["id"],
            tenant_id=row["tenant_id"],
            company_id=row["company_id"],
            name=row["name"],
            code=row["code"],
            status=WarehouseStatus(row["status"]),
            timezone=row["timezone"],
            locale=row["locale"],
            currency_code=row["currency_code"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            address=row["address"],
            settings=row["settings"] or {},
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
        )

    async def list_page(
        self,
        *,
        limit: int,
        cursor_code: str | None = None,
        cursor_id: UUID | None = None,
        company_id: UUID | None = None,
        status: WarehouseStatus | None = None,
        search: str | None = None,
    ) -> Sequence[Warehouse]:
        """Página por keyset, no por offset.

        Con `OFFSET` alto PostgreSQL recorre y descarta todas las filas
        anteriores en cada página. El keyset usa el índice directamente y su
        coste no crece con la profundidad.
        """
        clauses = ["deleted_at IS NULL"]
        params: dict[str, Any] = {"limit": limit}

        if cursor_code is not None and cursor_id is not None:
            clauses.append("(code, id) > (:cursor_code, :cursor_id)")
            params["cursor_code"] = cursor_code
            params["cursor_id"] = str(cursor_id)
        if company_id is not None:
            clauses.append("company_id = :company_id")
            params["company_id"] = str(company_id)
        if status is not None:
            clauses.append("status = :status")
            params["status"] = status.value
        if search:
            # ILIKE con comodín por delante no usa índice; aceptable para el
            # volumen de almacenes (decenas por tenant). En `products`, que
            # llega a millones, habrá que usar el índice GIN.
            clauses.append("(name ILIKE :search OR code ILIKE :search)")
            params["search"] = f"%{search}%"

        where = " AND ".join(clauses)
        stmt = text(
            f"SELECT {_COLUMNS} FROM {self.qualified_name} "  # noqa: S608
            f"WHERE {where} ORDER BY {_ORDER} LIMIT :limit"
        )
        rows = (await self._session.execute(stmt, params)).mappings().all()
        return [self._to_entity(r) for r in rows]

    async def get_by_id(self, entity_id: UUID) -> Warehouse | None:
        stmt = text(
            f"SELECT {_COLUMNS} FROM {self.qualified_name} "  # noqa: S608
            "WHERE id = :id AND deleted_at IS NULL"
        )
        row = (await self._session.execute(stmt, {"id": str(entity_id)})).mappings().first()
        return self._to_entity(row) if row else None

    async def get_by_code(self, company_id: UUID, code: str) -> Warehouse | None:
        stmt = text(
            f"SELECT {_COLUMNS} FROM {self.qualified_name} "  # noqa: S608
            "WHERE company_id = :company_id AND code = :code AND deleted_at IS NULL"
        )
        row = (
            await self._session.execute(stmt, {"company_id": str(company_id), "code": code})
        ).mappings().first()
        return self._to_entity(row) if row else None

    async def insert(self, wh: Warehouse, *, created_by: UUID | None) -> Warehouse:
        """Inserta y devuelve la fila tal como quedó en la base.

        `tenant_id` se toma de la entidad, que a su vez viene del contexto: el
        `WITH CHECK` de la política lo verifica de todos modos, así que una
        discrepancia se traduce en violación de RLS y no en un dato mal escrito.
        """
        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(tenant_id, company_id, name, code, status, timezone, locale, "
            " currency_code, latitude, longitude, address, settings, created_by, updated_by) "
            "VALUES (:tenant_id, :company_id, :name, :code, :status, :timezone, :locale, "
            " :currency_code, :latitude, :longitude, "
            " CAST(:address AS jsonb), CAST(:settings AS jsonb), :created_by, :created_by) "
            f"RETURNING {_COLUMNS}"
        )
        import json

        row = (
            await self._session.execute(
                stmt,
                {
                    "tenant_id": str(wh.tenant_id),
                    "company_id": str(wh.company_id),
                    "name": wh.name.strip(),
                    "code": wh.code,
                    "status": wh.status.value,
                    "timezone": wh.timezone,
                    "locale": wh.locale,
                    "currency_code": wh.currency_code,
                    "latitude": wh.latitude,
                    "longitude": wh.longitude,
                    "address": json.dumps(wh.address) if wh.address is not None else None,
                    "settings": json.dumps(wh.settings),
                    "created_by": str(created_by) if created_by else None,
                },
            )
        ).mappings().one()
        return self._to_entity(row)

    async def count_active(self) -> int:
        stmt = text(
            f"SELECT count(1) FROM {self.qualified_name} WHERE deleted_at IS NULL"  # noqa: S608
        )
        return int((await self._session.execute(stmt)).scalar_one())

    # Campos actualizables. Lista blanca explícita: `code`, `company_id` y
    # `tenant_id` quedan fuera a propósito, así que ni un error de programación
    # ni un payload inesperado pueden moverlos.
    _UPDATABLE = frozenset({
        "name", "status", "timezone", "locale", "currency_code",
        "latitude", "longitude", "address",
    })

    async def update(
        self, warehouse_id: UUID, changes: dict[str, Any], *, expected_version: int
    ) -> Warehouse | None:
        """Actualiza con optimistic locking. Devuelve None si la versión no coincide.

        `version` la incrementa esta sentencia, NO el trigger set_updated_at: si
        lo hiciera el trigger, cualquier escritura de sistema invalidaría la
        versión que el cliente tiene en mano y produciría 412 sin causa real.
        """
        applied = {k: v for k, v in changes.items() if k in self._UPDATABLE}
        if not applied:
            return await self.get_by_id(warehouse_id)

        import json

        sets: list[str] = []
        params: dict[str, Any] = {"id": str(warehouse_id), "expected": expected_version}
        for key, value in applied.items():
            if key == "address":
                sets.append("address = CAST(:address AS jsonb)")
                params["address"] = json.dumps(value) if value is not None else None
            else:
                sets.append(f"{key} = :{key}")
                params[key] = value

        stmt = text(
            f"UPDATE {self.qualified_name} SET {', '.join(sets)}, "  # noqa: S608
            "version = version + 1, updated_at = now() "
            "WHERE id = :id AND version = :expected AND deleted_at IS NULL "
            f"RETURNING {_COLUMNS}"
        )
        row = (await self._session.execute(stmt, params)).mappings().first()
        return self._to_entity(row) if row else None

    async def mark_deleted(self, warehouse_id: UUID, *, expected_version: int) -> bool:
        """Borrado lógico explícito. NUNCA por trigger.

        Se verificó que un trigger de soft delete en BEFORE UPDATE marca
        deleted_at en cualquier actualización —renombrar un almacén lo
        eliminaba— y que en BEFORE DELETE no hace nada mientras el borrado
        físico ocurre en silencio.

        ⚠ Se llamaba `soft_delete`, y así SOBRESCRIBÍA el atributo de clase
        `soft_delete: bool` de `BaseRepository`, que es la bandera que decide si
        `get_by_id`, `exists` y `soft_delete_by_id` añaden `deleted_at IS NULL`.

        Funcionaba, pero por accidente: un método enlazado es truthy, así que
        `if self.soft_delete` daba True y el filtro se aplicaba igual. Habría
        dejado de funcionar en silencio en cuanto la bandera se comprobara con
        `is True`, o habría hecho imposible un repositorio con
        `soft_delete = False` que tuviera este método. Se renombra para que la
        bandera y la operación dejen de compartir nombre.

        A diferencia de `soft_delete_by_id` de la clase base, esta además pasa el
        almacén a `inactive` y devuelve un booleano en lugar de lanzar, porque
        quien llama distingue «no coincide la versión» de «no existe».
        """
        stmt = text(
            f"UPDATE {self.qualified_name} "  # noqa: S608
            "SET deleted_at = now(), status = 'inactive', "
            "    version = version + 1, updated_at = now() "
            "WHERE id = :id AND version = :expected AND deleted_at IS NULL"
        )
        result = await self._session.execute(
            stmt, {"id": str(warehouse_id), "expected": expected_version}
        )
        return result.rowcount > 0

    async def has_dependencies(self, warehouse_id: UUID) -> bool:
        """¿Tiene áreas o ubicaciones vivas?

        Se comprueba en la aplicación porque la base no puede: las FK impiden
        borrar filas, pero aquí el borrado es lógico y las FK no lo ven.
        """
        stmt = text(
            "SELECT EXISTS ("
            " SELECT 1 FROM core.areas WHERE warehouse_id = :id AND deleted_at IS NULL"
            " UNION ALL"
            " SELECT 1 FROM core.locations WHERE warehouse_id = :id AND deleted_at IS NULL"
            ") AS dep"
        )
        return bool((await self._session.execute(stmt, {"id": str(warehouse_id)})).scalar_one())