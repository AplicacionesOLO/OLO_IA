"""Servicio de la flota de dispositivos de borde (0110). Ver ADR-015."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from olo.core.errors import NotFoundError
from olo.repositories.fleet import FleetRepository

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext


class FleetService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._repo = FleetRepository(session)
        self._ctx = ctx

    async def heartbeat(
        self,
        *,
        device_key: str,
        kind: str,
        name: str,
        warehouse_id: UUID,
        app_version: str | None,
        device_model: str | None,
        current_job_id: UUID | None,
    ) -> dict[str, Any]:
        """Registra el dispositivo o refresca su latido.

        No hace falta un `can_access_warehouse` aparte: la FK compuesta
        `(tenant_id, warehouse_id)` de 0110 contra `core.warehouses` ya
        rechaza un almacen de otro tenant, y RLS acota el resto -- el mismo
        criterio que ya sigue `PerceptionService.start_live`.
        """
        return await self._repo.latir(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            device_key=device_key,
            kind=kind,
            name=name,
            app_version=app_version,
            device_model=device_model,
            current_job_id=current_job_id,
        )

    async def list_devices(self, *, warehouse_id: UUID | None) -> dict[str, Any]:
        """La flota, con cuantos estan operativos AHORA.

        "Operativo" es `connected` o `live` -- lo contrario de `offline` (sin
        latido reciente) u `out_of_service` (retirado a mano). Contarlo aqui
        y no en el cliente es el mismo criterio que `alive` en
        `PerceptionService.list_workers`: una sola forma de contar lo mismo.
        """
        dispositivos = await self._repo.listar(warehouse_id=warehouse_id)
        online = sum(1 for d in dispositivos if d["status"] in ("connected", "live"))
        return {"devices": dispositivos, "online": online}

    async def retire(self, device_id: UUID, *, reason: str | None) -> dict[str, Any]:
        fila = await self._repo.retirar(device_id, motivo=reason)
        if fila is None:
            raise NotFoundError(f"dispositivo {device_id} no encontrado")
        return fila

    async def reactivate(self, device_id: UUID) -> dict[str, Any]:
        fila = await self._repo.reactivar(device_id)
        if fila is None:
            raise NotFoundError(f"dispositivo {device_id} no encontrado")
        return fila
