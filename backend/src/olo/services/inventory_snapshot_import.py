"""Servicio del importador de inventario, por API.

Hace lo mismo que `tools/import_inventory_snapshot.py` — mismo parser
(`inventory_snapshot_parser`), mismas reglas, misma idempotencia por
`sha256` — disparado por un archivo subido en una petición HTTP en lugar de
una ruta de archivo en un terminal con credenciales de `postgres`.

── QUÉ ES UN SNAPSHOT Y POR QUÉ NO SE «ACTUALIZA» ───────────────────────────

Un snapshot es una FOTO del inventario en un instante, y las fotos no se
editan: llega una nueva. El WMS es el sistema de origen y esto es su espejo de
solo lectura — si aquí se pudiera «corregir» una cantidad, habría dos verdades
sobre lo que hay en un hueco, y la de este lado sería la equivocada.

── IDEMPOTENCIA ─────────────────────────────────────────────────────────────

Por `sha256` del archivo, igual que el catálogo espacial: reimportar el mismo
archivo se detecta antes de leer una fila y responde `skipped_duplicate`. Con
`force`, se borra la foto anterior con el mismo hash (su `wms_stock` cae por
`ON DELETE CASCADE`) y se reemplaza — dos snapshots idénticos no serían dos
medidas, serían la misma contada dos veces.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from io import BytesIO
from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.repositories.inventory_snapshot_import import InventorySnapshotImportRepository
from olo.services.inventory_snapshot_parser import ColumnaFaltanteError, leer_inventario

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

# El reporte real (41.055 filas, 77 columnas) pesa unos pocos MB como xlsx.
# El limite es una cota de sanidad, no una suposicion sobre el almacen mas
# grande.
MAX_UPLOAD_BYTES = 40 * 1024 * 1024

# Mismo tamano de lote que el script de terminal.
LOTE = 2_000


def _resumir_rechazos(rechazos: list[dict[str, Any]]) -> dict[str, Any]:
    conteo = Counter(r["motivo"] for r in rechazos)
    return {
        "by_reason": dict(conteo.most_common()),
        "sample": [{"row_number": r["fila"], "reason": r["motivo"]} for r in rechazos[:20]],
    }


class InventorySnapshotImportService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._session = session
        self._ctx = ctx
        self._repo = InventorySnapshotImportRepository(session)

    async def importar(
        self,
        warehouse_id: UUID,
        *,
        source_name: str,
        file_bytes: bytes,
        dry_run: bool,
        force: bool,
    ) -> dict[str, Any]:
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise BusinessRuleError(
                f"El archivo pesa {len(file_bytes) / 1_048_576:.1f} MB; "
                f"el maximo es {MAX_UPLOAD_BYTES // 1_048_576} MB."
            )

        wh = await self._repo.warehouse_by_id(warehouse_id)
        if wh is None:
            raise NotFoundError(f"No existe el almacen {warehouse_id}")
        tenant_id, wid = UUID(str(wh["tenant_id"])), UUID(str(wh["id"]))

        sha = hashlib.sha256(file_bytes).hexdigest()

        try:
            lineas, rechazos, tomada = leer_inventario(BytesIO(file_bytes))
        except ColumnaFaltanteError as exc:
            raise BusinessRuleError(str(exc)) from exc

        resumen = {
            "file_sha256": sha,
            "rows_read": len(lineas),
            "rows_rejected": len(rechazos),
            "rejections": _resumir_rechazos(rechazos),
        }

        if dry_run:
            return {"status": "dry_run", **resumen}

        existente = await self._repo.find_ready_snapshot(tenant_id, wid, sha)
        if existente and not force:
            return {"status": "skipped_duplicate", **resumen}
        if existente:
            await self._repo.delete_snapshot(existente)

        snapshot_id = await self._repo.create_snapshot(
            tenant_id=tenant_id,
            warehouse_id=wid,
            taken_at=tomada or datetime.now(UTC),
            sha256=sha,
            row_count=len(lineas),
            notes=f"Importado de {source_name} por la API",
        )

        mapa_ubic = await self._repo.map_locations(wid)
        mapa_cli = await self._repo.map_clients(tenant_id)

        escritas = 0
        for i in range(0, len(lineas), LOTE):
            trozo = lineas[i : i + LOTE]
            await self._repo.insert_stock_batch(
                tenant_id=tenant_id,
                snapshot_id=snapshot_id,
                warehouse_id=wid,
                location_ids=[mapa_ubic.get(ln["codigo"]) for ln in trozo],
                location_codes=[ln["codigo"] for ln in trozo],
                pallet_codes=[ln["pallet"] for ln in trozo],
                skus=[ln["sku"] for ln in trozo],
                descriptions=[ln["descripcion"] for ln in trozo],
                qtys=[ln["qty"] for ln in trozo],
                uoms=[ln["uom"] for ln in trozo],
                client_ids=[mapa_cli.get((ln["compania"] or "").upper()) for ln in trozo],
                lots=[ln["lote"] for ln in trozo],
                expires_ats=[ln["caduca"] for ln in trozo],
                raws=[json.dumps(ln["raw"], ensure_ascii=False, default=str) for ln in trozo],
            )
            escritas += len(trozo)

        await self._repo.complete_snapshot(snapshot_id, escritas)
        verif = await self._repo.verify_counts(snapshot_id)

        companias_sin_cliente = sorted(
            {
                ln["compania"]
                for ln in lineas
                if ln["compania"] and ln["compania"].upper() not in mapa_cli
            }
        )

        return {
            "status": "completed",
            **resumen,
            "snapshot_id": snapshot_id,
            "taken_at": tomada,
            "rows_written": escritas,
            "locations_occupied": verif["huecos"],
            "rows_without_location": verif["huerfanas"],
            "pallets": verif["pallets"],
            "units": float(verif["unidades"]) if verif["unidades"] is not None else None,
            "clients_unmatched": companias_sin_cliente[:10],
        }
