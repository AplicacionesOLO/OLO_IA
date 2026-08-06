"""Registro de workers (0075): quién está vivo para coger trabajo encolado.

Un repositorio propio y no una función dentro de `perception` ni de `ai` porque la
tabla sirve a los dos, y el que pregunta «¿hay quien entrene?» no debería tener que
importar el repositorio de percepción para averiguarlo.

── EL LATIDO ES UN UPSERT, NO UN INSERT ────────────────────────────────────

Un worker que se reinicia es el MISMO worker: misma máquina, mismo trabajo que coger.
Con un INSERT por arranque, un portátil que se reinicia diez veces en una tarde
dejaría diez filas y la lista diría que hay diez workers cuando hay uno. La unicidad
`(tenant_id, kind, name)` de 0075 lo absorbe.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


class WorkerRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def esta_vivo(self, kind: str) -> bool:
        """Si hay algún worker de ese tipo con latido reciente.

        Va por `core.worker_esta_vivo()` y no por una consulta propia: la ventana de
        90 s es una decisión y vive en un solo sitio. Ver 0075.
        """
        fila = (
            await self._session.execute(
                text("SELECT core.worker_esta_vivo(CAST(:k AS text)) AS vivo"),
                {"k": kind},
            )
        ).first()
        return bool(fila and fila[0])

    async def latir(
        self,
        *,
        tenant_id: UUID,
        kind: str,
        name: str,
        capabilities: list[str],
        agent_version: str | None,
        device: str | None,
        current_job: UUID | None,
    ) -> dict[str, Any]:
        """Registra el worker o refresca su latido. Devuelve la fila resultante."""
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO core.workers "
                    "  (tenant_id, kind, name, capabilities, agent_version, device, "
                    "   current_job) "
                    "VALUES (CAST(:tid AS uuid), CAST(:kind AS varchar), "
                    "        CAST(:name AS varchar), CAST(:cap AS jsonb), "
                    "        CAST(:ver AS varchar), CAST(:dev AS varchar), "
                    "        CAST(:job AS uuid)) "
                    "ON CONFLICT (tenant_id, kind, name) DO UPDATE "
                    "   SET last_seen_at  = now(), "
                    "       capabilities  = CAST(:cap AS jsonb), "
                    "       agent_version = CAST(:ver AS varchar), "
                    "       device        = CAST(:dev AS varchar), "
                    "       current_job   = CAST(:job AS uuid) "
                    "RETURNING id, kind, name, capabilities, agent_version, device, "
                    "          registered_at, last_seen_at, current_job"
                ),
                {
                    "tid": str(tenant_id),
                    "kind": kind,
                    "name": name,
                    "cap": json.dumps(capabilities),
                    "ver": agent_version,
                    "dev": device,
                    "job": str(current_job) if current_job else None,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def listar(self, kind: str | None = None) -> list[dict[str, Any]]:
        """Los workers registrados, vivos o no, con si lo están.

        Se devuelven también los muertos a propósito: «hubo un worker y dejó de
        responder hace dos horas» es información distinta de «nunca hubo ninguno», y
        es la que hace falta para saber si hay que ir a mirar una máquina.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT id, kind, name, capabilities, agent_version, device, "
                    "       registered_at, last_seen_at, current_job, "
                    "       (last_seen_at > now() - interval '90 seconds') AS alive, "
                    "       round(extract(epoch FROM (now() - last_seen_at)))::int "
                    "         AS seconds_since "
                    "  FROM core.workers "
                    # La casta va en las DOS apariciones. Sin ella, `:k IS NULL` deja a
                    # asyncpg sin forma de deducir el tipo del parámetro y responde
                    # `AmbiguousParameterError: could not determine data type of
                    # parameter $1`, que llega como un 500 genérico. Es el mismo fallo
                    # que costó una vuelta en `repositories/perception.py`.
                    " WHERE (CAST(:k AS varchar) IS NULL "
                    "        OR kind = CAST(:k AS varchar)) "
                    " ORDER BY last_seen_at DESC"
                ),
                {"k": kind},
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def retirar(self, worker_id: UUID) -> int:
        r: Any = await self._session.execute(
            text("DELETE FROM core.workers WHERE id = CAST(:wid AS uuid)"),
            {"wid": str(worker_id)},
        )
        # `rowcount` vive en `CursorResult` y `execute()` está anotado como `Result`.
        # El `Any` de arriba es lo que evita el aviso; en ejecución siempre está, esto
        # es DML. Mismo caso que `_filas()` en `repositories/olobot.py`.
        return int(r.rowcount or 0)
