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

        datos = await self._escribir(
            tenant_id, wid, lineas, sha=sha, tomada=tomada,
            notes=f"Importado de {source_name} por la API", source="xlsx",
        )
        return {"status": "completed", **resumen, **datos}

    async def _escribir(
        self,
        tenant_id: UUID,
        wid: UUID,
        lineas: list[dict[str, Any]],
        *,
        sha: str,
        tomada: datetime | None,
        notes: str,
        source: str,
    ) -> dict[str, Any]:
        """Escribe la foto (cabecera + lineas por lotes) y la cuenta desde la base.
        Comun al xlsx subido y a la sincronizacion directa con el WMS."""
        snapshot_id = await self._repo.create_snapshot(
            tenant_id=tenant_id,
            warehouse_id=wid,
            taken_at=tomada or datetime.now(UTC),
            sha256=sha,
            row_count=len(lineas),
            notes=notes,
            source=source,
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
            "snapshot_id": snapshot_id,
            "taken_at": tomada,
            "rows_written": escritas,
            "locations_occupied": verif["huecos"],
            "rows_without_location": verif["huerfanas"],
            "pallets": verif["pallets"],
            "units": float(verif["unidades"]) if verif["unidades"] is not None else None,
            "clients_unmatched": companias_sin_cliente[:10],
        }

    async def sincronizar(
        self,
        warehouse_id: UUID,
        lineas: list[dict[str, Any]],
        *,
        origen: str,
    ) -> dict[str, Any]:
        """Foto del inventario leida DIRECTO de la base del WMS (no de un xlsx).

        La manda el worker que esta dentro de la red de la empresa: la base del WMS
        (SQL Server) no es alcanzable desde la nube. Mismas lineas que el reporte, asi
        que el resto del sistema —ocupacion, 3D, reconciliacion— no distingue el origen.

        Si el WMS no cambio desde el ultimo corte (mismo sha), no se escribe nada: con un
        corte cada pocos minutos, la mayoria de las veces no hay movimiento. Despues de
        escribir uno nuevo se borran los cortes sincronizados viejos que nadie cita.
        """
        wh = await self._repo.warehouse_by_id(warehouse_id)
        if wh is None:
            raise NotFoundError(f"No existe el almacen {warehouse_id}")
        tenant_id, wid = UUID(str(wh["tenant_id"])), UUID(str(wh["id"]))

        for ln in lineas:
            ln["codigo"] = str(ln["codigo"]).strip().upper()
        canon = json.dumps(
            sorted(lineas, key=lambda x: (x["codigo"], x.get("pallet") or "", x.get("sku") or "")),
            ensure_ascii=False, sort_keys=True, default=str,
        )
        sha = hashlib.sha256(canon.encode("utf-8")).hexdigest()
        resumen = {"file_sha256": sha, "rows_read": len(lineas), "rows_rejected": 0,
                   "rejections": _resumir_rechazos([])}

        if await self._repo.latest_snapshot_sha(wid) == sha:
            return {"status": "skipped_duplicate", **resumen}

        datos = await self._escribir(
            tenant_id, wid, lineas, sha=sha, tomada=datetime.now(UTC),
            notes=f"Sincronizado de la base del WMS ({origen})", source="wms_api",
        )
        await self._repo.prune_synced_snapshots(wid, keep=datos["snapshot_id"])
        return {"status": "completed", **resumen, **datos}
