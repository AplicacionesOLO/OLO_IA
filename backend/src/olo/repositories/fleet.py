"""Registro de flota (0110): dispositivos de borde que producen sus propias
detecciones -- ver ADR-015.

Mismo patron que `repositories/workers.py` (0075): el latido es un UPSERT, no
un INSERT, porque un dispositivo que reinicia la app es el MISMO dispositivo.
La diferencia es la identidad: un worker se identifica por `(tenant, kind,
name)`; un dispositivo de flota trae su propio `device_key` persistente (ver
la cabecera de la migracion 0110) porque el nombre SI puede cambiar (alguien
lo renombra desde el modulo de Flota) sin que deje de ser el mismo aparato.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

#  `status_override` NO va en esta lista a proposito: `DeviceOut` no lo expone
#  -- el campo `status` calculado ya lo refleja, y duplicarlo obligaria a
#  `DeviceOut` a declarar un campo que nadie necesita leer aparte.
_COLS = (
    "id, warehouse_id, device_key, kind, name, app_version, device_model, "
    "registered_at, last_seen_at, current_job_id, "
    "retired_at, retired_reason, "
    "core.fleet_device_status(status_override, last_seen_at, current_job_id) AS status"
)


class FleetRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def latir(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        device_key: str,
        kind: str,
        name: str,
        app_version: str | None,
        device_model: str | None,
        current_job_id: UUID | None,
    ) -> dict[str, Any]:
        """Registra el dispositivo o refresca su latido. Devuelve la fila resultante.

        `kind` NO se actualiza en el `DO UPDATE` a proposito: es de que CLASE de
        hardware es, y no deberia poder cambiar de un latido a otro por un dato
        mal mandado -- si de verdad cambia de tipo, es un dispositivo distinto.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO core.fleet_devices "
                    "  (tenant_id, warehouse_id, device_key, kind, name, "
                    "   app_version, device_model, current_job_id) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :dkey, :kind, :name, "
                    "        :ver, :model, CAST(:job AS uuid)) "
                    "ON CONFLICT (tenant_id, device_key) DO UPDATE "
                    "   SET last_seen_at   = now(), "
                    "       warehouse_id   = CAST(:wh AS uuid), "
                    "       name           = :name, "
                    "       app_version    = :ver, "
                    "       device_model   = :model, "
                    "       current_job_id = CAST(:job AS uuid) "
                    f"RETURNING {_COLS}"  # noqa: S608
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "dkey": device_key,
                    "kind": kind,
                    "name": name,
                    "ver": app_version,
                    "model": device_model,
                    "job": str(current_job_id) if current_job_id else None,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def listar(
        self, *, warehouse_id: UUID | None, incluir_retirados: bool = True
    ) -> list[dict[str, Any]]:
        """La flota, la mas reciente primero -- retirados incluidos por defecto.

        Igual que `WorkerRepository.listar`: "este telefono se dio de baja hace
        dos meses" es informacion distinta de "nunca hubo tal telefono", y
        filtrar los retirados en silencio confundiria las dos.
        """
        clausulas = ["1 = 1"]
        params: dict[str, Any] = {}
        if warehouse_id is not None:
            clausulas.append("warehouse_id = CAST(:wh AS uuid)")
            params["wh"] = str(warehouse_id)
        if not incluir_retirados:
            clausulas.append("status_override IS NULL")
        donde = " AND ".join(clausulas)

        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_COLS} FROM core.fleet_devices "  # noqa: S608
                    f"WHERE {donde} "
                    "ORDER BY last_seen_at DESC"
                ),
                params,
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def obtener(self, device_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_COLS} FROM core.fleet_devices "  # noqa: S608
                    "WHERE id = CAST(:did AS uuid)"
                ),
                {"did": str(device_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def retirar(self, device_id: UUID, *, motivo: str | None) -> dict[str, Any] | None:
        """`core.current_user_id()` y no un parametro de Python -- mismo criterio
        que `created_by` en `create_job` (repositories/perception.py): quien
        retira lo resuelve el motor a partir de la sesion autenticada, no un
        UUID que el llamador podria pasar equivocado."""
        fila = (
            await self._session.execute(
                text(
                    "UPDATE core.fleet_devices SET "
                    "  status_override = 'out_of_service', "
                    "  retired_at = now(), "
                    "  retired_by = core.current_user_id(), "
                    "  retired_reason = :motivo "
                    "WHERE id = CAST(:did AS uuid) "
                    f"RETURNING {_COLS}"  # noqa: S608
                ),
                {"did": str(device_id), "motivo": motivo},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def reactivar(self, device_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "UPDATE core.fleet_devices SET "
                    "  status_override = NULL, retired_at = NULL, "
                    "  retired_by = NULL, retired_reason = NULL "
                    "WHERE id = CAST(:did AS uuid) "
                    f"RETURNING {_COLS}"  # noqa: S608
                ),
                {"did": str(device_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None
