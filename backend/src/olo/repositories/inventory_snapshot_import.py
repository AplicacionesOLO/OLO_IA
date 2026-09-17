"""Repositorio del importador de inventario, por API.

Mismas sentencias que `tools/import_inventory_snapshot.py`, traducidas de
`asyncpg` a `AsyncSession` — el importador de terminal corre como `postgres`;
este corre como `olo_app`, con RLS activo, dentro de la transacción de la
petición que abre `tenant_session()`.

Como el resto de repositorios, no filtra por `tenant_id` en los SELECT: lo hace
RLS. Sí lo pasa en los INSERT porque las columnas son `NOT NULL` y la policy lo
comprueba con `WITH CHECK`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import date, datetime

    from sqlalchemy.ext.asyncio import AsyncSession


class InventorySnapshotImportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def warehouse_by_id(self, warehouse_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, tenant_id, name FROM core.warehouses "
                    "WHERE id = CAST(:wh AS uuid) AND deleted_at IS NULL"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def find_ready_snapshot(
        self, tenant_id: UUID, warehouse_id: UUID, sha256: str
    ) -> UUID | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT id FROM inventory.wms_snapshots "
                    "WHERE tenant_id = CAST(:tid AS uuid) AND warehouse_id = CAST(:wh AS uuid) "
                    "  AND external_ref = :sha AND status = 'ready' AND deleted_at IS NULL"
                ),
                {"tid": str(tenant_id), "wh": str(warehouse_id), "sha": sha256},
            )
        ).first()
        return UUID(str(fila[0])) if fila else None

    async def delete_snapshot(self, snapshot_id: UUID) -> int:
        """Borra el snapshot anterior. `wms_stock` cae por `ON DELETE CASCADE`.

        Solo se llama con `force=True`, para reemplazar una foto idéntica en
        lugar de dejar dos snapshots con el mismo origen y el mismo contenido
        —eso no serían dos medidas, sería la misma contada dos veces—.
        """
        borradas = (
            await self._session.execute(
                text(
                    "SELECT count(1) FROM inventory.wms_stock "
                    "WHERE snapshot_id = CAST(:id AS uuid)"
                ),
                {"id": str(snapshot_id)},
            )
        ).scalar_one()
        await self._session.execute(
            text("DELETE FROM inventory.wms_snapshots WHERE id = CAST(:id AS uuid)"),
            {"id": str(snapshot_id)},
        )
        return int(borradas)

    async def create_snapshot(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        taken_at: datetime,
        sha256: str,
        row_count: int,
        notes: str,
    ) -> UUID:
        """Se crea en `loading` y se marca `ready` al terminar (`complete_snapshot`).

        Si el proceso muere a mitad, la foto queda como `loading` y cualquier
        consulta que pida `ready` la ignora: es la diferencia entre una foto
        incompleta y una foto que miente.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO inventory.wms_snapshots "
                    "(tenant_id, warehouse_id, taken_at, source, external_ref, row_count, "
                    " status, notes, created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :taken, 'xlsx', :sha, :rows, "
                    "        'loading', :notes, core.current_user_id(), core.current_user_id()) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id), "wh": str(warehouse_id), "taken": taken_at,
                    "sha": sha256, "rows": row_count, "notes": notes,
                },
            )
        ).scalar_one()
        return UUID(str(fila))

    async def map_locations(self, warehouse_id: UUID) -> dict[str, str]:
        """`code -> id` de las ubicaciones del catálogo. Una consulta para todas.

        29.312 ubicaciones en una consulta en vez de una por línea: 41.055
        viajes al pooler a 260 ms serían tres horas.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT upper(code) AS code, id FROM spatial.locations "
                    "WHERE warehouse_id = CAST(:wh AS uuid) AND deleted_at IS NULL"
                ),
                {"wh": str(warehouse_id)},
            )
        ).all()
        return {f[0]: str(f[1]) for f in filas}

    async def map_clients(self, tenant_id: UUID) -> dict[str, str]:
        """`código o nombre, en mayúsculas -> id`.

        Los nombres del reporte no siempre son el código: «Cofersa» contra
        «COFERSA». Se indexa también por nombre para no perder la relación por
        una diferencia de mayúsculas; el código gana si un nombre coincide con
        el código de otro cliente (`setdefault`, igual que el script).
        """
        mapa: dict[str, str] = {}
        filas = (
            await self._session.execute(
                text(
                    "SELECT code, id FROM core.clients "
                    "WHERE tenant_id = CAST(:tid AS uuid) AND deleted_at IS NULL"
                ),
                {"tid": str(tenant_id)},
            )
        ).all()
        for code, cid in filas:
            if code:
                mapa[str(code).upper()] = str(cid)
        filas = (
            await self._session.execute(
                text(
                    "SELECT name, id FROM core.clients "
                    "WHERE tenant_id = CAST(:tid AS uuid) AND deleted_at IS NULL"
                ),
                {"tid": str(tenant_id)},
            )
        ).all()
        for name, cid in filas:
            if name:
                mapa.setdefault(str(name).upper(), str(cid))
        return mapa

    async def insert_stock_batch(
        self,
        *,
        tenant_id: UUID,
        snapshot_id: UUID,
        warehouse_id: UUID,
        location_ids: Sequence[str | None],
        location_codes: Sequence[str],
        pallet_codes: Sequence[str | None],
        skus: Sequence[str | None],
        descriptions: Sequence[str | None],
        qtys: Sequence[float | None],
        uoms: Sequence[str | None],
        client_ids: Sequence[str | None],
        lots: Sequence[str | None],
        expires_ats: Sequence[date | None],
        raws: Sequence[str],
    ) -> None:
        """Un lote de líneas · inserción de conjunto.

        Un `executemany` de 41.055 filas sigue siendo 41.055 ejecuciones del
        plan. `unnest` de columnas paralelas lo convierte en una sentencia por
        lote — la llamante decide el tamaño del lote.
        """
        await self._session.execute(
            text(
                "INSERT INTO inventory.wms_stock "
                "(tenant_id, snapshot_id, warehouse_id, location_id, location_code, "
                " pallet_code, sku, description, qty, uom, client_id, lot, expires_at, raw) "
                "SELECT CAST(:tid AS uuid), CAST(:snap AS uuid), CAST(:wh AS uuid), "
                "       CAST(t.location_id AS uuid), t.location_code, "
                "       t.pallet_code, t.sku, t.description, t.qty, t.uom, "
                "       CAST(t.client_id AS uuid), t.lot, t.expires_at, CAST(t.raw AS jsonb) "
                "  FROM unnest(CAST(:location_ids AS text[]), CAST(:location_codes AS text[]), "
                "              CAST(:pallet_codes AS text[]), CAST(:skus AS text[]), "
                "              CAST(:descriptions AS text[]), CAST(:qtys AS numeric[]), "
                "              CAST(:uoms AS text[]), CAST(:client_ids AS text[]), "
                "              CAST(:lots AS text[]), CAST(:expires_ats AS date[]), "
                "              CAST(:raws AS text[])) "
                "         AS t(location_id, location_code, pallet_code, sku, description, "
                "              qty, uom, client_id, lot, expires_at, raw)"
            ),
            {
                "tid": str(tenant_id), "snap": str(snapshot_id), "wh": str(warehouse_id),
                "location_ids": list(location_ids), "location_codes": list(location_codes),
                "pallet_codes": list(pallet_codes), "skus": list(skus),
                "descriptions": list(descriptions), "qtys": list(qtys), "uoms": list(uoms),
                "client_ids": list(client_ids), "lots": list(lots),
                "expires_ats": list(expires_ats), "raws": list(raws),
            },
        )

    async def complete_snapshot(self, snapshot_id: UUID, row_count: int) -> None:
        await self._session.execute(
            text(
                "UPDATE inventory.wms_snapshots "
                "   SET status = 'ready', row_count = :rows, updated_by = core.current_user_id() "
                " WHERE id = CAST(:id AS uuid)"
            ),
            {"id": str(snapshot_id), "rows": row_count},
        )

    async def verify_counts(self, snapshot_id: UUID) -> dict[str, Any]:
        """Lo que quedó, contado desde la BASE y no confiando en el contador local.

        Si una restricción hubiera rechazado algo en silencio, el número local
        mentiría.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*) AS lineas, "
                    "       count(DISTINCT location_id) AS huecos, "
                    "       count(*) FILTER (WHERE location_id IS NULL) AS huerfanas, "
                    "       count(DISTINCT pallet_code) AS pallets, "
                    "       sum(qty) AS unidades "
                    "  FROM inventory.wms_stock WHERE snapshot_id = CAST(:id AS uuid)"
                ),
                {"id": str(snapshot_id)},
            )
        ).mappings().one()
        return dict(fila)
