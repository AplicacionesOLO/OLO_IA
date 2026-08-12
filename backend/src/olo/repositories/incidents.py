"""Lecturas y escrituras de las incidencias.

Ninguna consulta filtra por tenant ni por almacén: lo hace RLS, con dos políticas
RESTRICTIVE —`tenant_isolation` y `solo_su_almacen`— sobre `incidents.incidents`. Un
`WHERE tenant_id = ...` aquí daría falsa sensación de seguridad y ocultaría un fallo de
política en lugar de dejarlo a la vista.

El almacén SÍ va en el WHERE de la bandeja, pero como FILTRO de consulta —«enséñame las
de este almacén»—, no como control de acceso. La diferencia importa: si RLS fallara, ese
WHERE no salvaría nada.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy import RowMapping
    from sqlalchemy.ext.asyncio import AsyncSession


def _uuid_o_nulo(valor: Any) -> str | None:
    """El uuid como texto, o `None`. Evita repetir el ternario en cada parámetro."""
    return str(valor) if valor else None


class IncidentRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _rows(self, sql: str, params: dict[str, Any] | None = None) -> Sequence[RowMapping]:
        return (await self._session.execute(text(sql), params or {})).mappings().all()

    # ── Lectura ───────────────────────────────────────────────────────────────
    async def bandeja(
        self, warehouse_id: UUID, *, estado: str | None, limite: int
    ) -> list[dict[str, Any]]:
        """La bandeja de trabajo, lo más viejo primero.

        ── POR QUE LO MAS VIEJO PRIMERO ──────────────────────────────────────

        Al revés de casi todas las listas del producto. Una incidencia de hace tres
        semanas es peor que una de esta mañana: lleva tres semanas sin que nadie la
        toque, y ordenar por «más reciente» la entierra justo cuando más urge.

        Las cerradas van aparte —se piden con `estado`— porque mezclarlas con las
        abiertas convierte una lista de trabajo en un archivo.
        """
        filas = await self._rows(
            "SELECT b.id, b.warehouse_id, b.location_id, b.location_code, b.kind, "
            "       b.subkind, b.status, b.title, b.details, b.resolution, "
            "       b.created_at, b.resolved_at, b.dias_abierta, b.assigned_to, "
            "       b.assigned_to_name, b.opened_by_name, b.resolved_by_name, "
            "       b.source_snapshot_id, b.snapshot_taken_at, "
            #  ── LO QUE EL ULTIMO RECORRIDO VIO EN ESE MISMO HUECO ─────────────
            #
            #  Sin esto, el bucle no se cierra: se abre trabajo y nadie sabe si se
            #  arreglo hasta que alguien va a mirar otra vez a mano. Con esto, la
            #  bandeja puede decir «el recorrido del 12 ya no ve esto» y quien la
            #  mira decide si cerrarla.
            #
            #  Se DICE, no se cierra sola: cerrar una incidencia es afirmar que una
            #  persona comprobo algo, y una camara no es una persona. Un cierre
            #  automatico convertiria un fallo de deteccion —un pallet que hoy no se
            #  vio— en «arreglado», que es la mentira mas cara que puede contar este
            #  producto.
            "       u.observed_at AS last_seen_at, u.status AS last_seen_status "
            "  FROM incidents.v_bandeja b "
            "  LEFT JOIN LATERAL ( "
            "       SELECT r.observed_at, r.status "
            "         FROM inventory.v_reconciliation r "
            "         JOIN inventory.scans s ON s.id = r.scan_id "
            "        WHERE r.location_id = b.location_id "
            "          AND s.deleted_at IS NULL "
            #  Solo lecturas POSTERIORES a la apertura: una de antes es la que la
            #  origino, y ensenarla como «vuelto a ver» seria absurdo.
            "          AND r.observed_at > b.created_at "
            "        ORDER BY s.started_at DESC NULLS LAST, "
            "                 (r.pallet_qr = 'read') DESC, r.observed_at DESC "
            "        LIMIT 1) u ON b.location_id IS NOT NULL "
            " WHERE b.warehouse_id = CAST(:wh AS uuid) "
            "   AND (CAST(:estado AS text) IS NULL OR b.status = CAST(:estado AS text)) "
            " ORDER BY CASE WHEN b.status IN ('open', 'in_progress') THEN 0 ELSE 1 END, "
            "          b.created_at ASC "
            " LIMIT :lim",
            {"wh": str(warehouse_id), "estado": estado, "lim": limite},
        )
        return [dict(f) for f in filas]

    async def recuento(self, warehouse_id: UUID) -> dict[str, int]:
        """Cuántas hay en cada estado. Sale del TOTAL, no de la página."""
        filas = await self._rows(
            "SELECT status, count(*) AS n FROM incidents.incidents "
            " WHERE warehouse_id = CAST(:wh AS uuid) GROUP BY status",
            {"wh": str(warehouse_id)},
        )
        return {str(f["status"]): int(f["n"]) for f in filas}

    async def abiertas_por_ubicacion(self, warehouse_id: UUID) -> dict[str, str]:
        """`{location_code: incident_id}` de lo que ya está abierto.

        Lo pide la pantalla de inventario para NO ofrecer «abrir incidencia» en un
        hueco que ya la tiene. Sin esto, el botón invita a un clic que va a chocar
        contra `uq_incidencia_abierta` y devolver un 409 que nadie esperaba.
        """
        filas = await self._rows(
            "SELECT location_code, id FROM incidents.incidents "
            " WHERE warehouse_id = CAST(:wh AS uuid) "
            "   AND status IN ('open', 'in_progress') "
            "   AND location_code IS NOT NULL",
            {"wh": str(warehouse_id)},
        )
        return {str(f["location_code"]): str(f["id"]) for f in filas}

    async def una(self, incident_id: UUID) -> dict[str, Any] | None:
        filas = await self._rows(
            "SELECT * FROM incidents.v_bandeja WHERE id = CAST(:i AS uuid)",
            {"i": str(incident_id)},
        )
        return dict(filas[0]) if filas else None

    async def historial(self, incident_id: UUID) -> list[dict[str, Any]]:
        filas = await self._rows(
            "SELECT e.id, e.from_status, e.to_status, e.note, e.occurred_at, "
            "       u.first_name || ' ' || u.last_name AS actor_name "
            "  FROM incidents.events e "
            "  JOIN core.users u ON u.id = e.actor_id "
            " WHERE e.incident_id = CAST(:i AS uuid) "
            " ORDER BY e.occurred_at",
            {"i": str(incident_id)},
        )
        return [dict(f) for f in filas]

    # ── Escritura ─────────────────────────────────────────────────────────────
    async def abrir(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        """Abre una incidencia. `tenant_id` lo pone el motor, nunca Python.

        Es la misma regla que en `repositories/admin.py`: se toma de
        `core.current_tenant_id()` en la propia sentencia, así que es imposible insertar
        una fila que RLS vaya a rechazar —o peor, que acepte por pertenecer a otro
        tenant—.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO incidents.incidents "
                    "(tenant_id, warehouse_id, location_id, location_code, kind, "
                    " subkind, title, details, source_snapshot_id, source_job_id, "
                    " assigned_to, opened_by) "
                    "VALUES (core.current_tenant_id(), CAST(:wh AS uuid), "
                    "        CAST(:loc AS uuid), :code, :kind, :subkind, :title, "
                    "        :details, CAST(:snap AS uuid), CAST(:job AS uuid), "
                    "        CAST(:asig AS uuid), CAST(:by AS uuid)) "
                    "RETURNING id"
                ),
                {
                    "wh": str(datos["warehouse_id"]),
                    "loc": _uuid_o_nulo(datos.get("location_id")),
                    "code": datos.get("location_code"),
                    "kind": datos["kind"],
                    "subkind": datos.get("subkind"),
                    "title": datos["title"],
                    "details": datos.get("details"),
                    "snap": _uuid_o_nulo(datos.get("source_snapshot_id")),
                    "job": _uuid_o_nulo(datos.get("source_job_id")),
                    "asig": _uuid_o_nulo(datos.get("assigned_to")),
                    "by": str(actor),
                },
            )
        ).first()
        return UUID(str(fila[0]))  # type: ignore[index]

    async def estado_actual(self, incident_id: UUID) -> str | None:
        filas = await self._rows(
            "SELECT status FROM incidents.incidents WHERE id = CAST(:i AS uuid)",
            {"i": str(incident_id)},
        )
        return str(filas[0]["status"]) if filas else None

    async def cambiar_estado(
        self, incident_id: UUID, *, nuevo: str, resolucion: str | None, actor: UUID
    ) -> int:
        """Mueve el estado. Al cerrar, exige la explicación —lo impone `chk_inc_cerrada`.

        Al REABRIR se limpian `resolved_*`: si se dejaran, la incidencia diría que está
        abierta y a la vez que alguien la resolvió el martes, y las dos cosas no pueden
        ser ciertas.
        """
        cierra = nuevo in ("resolved", "dismissed")
        res = await self._session.execute(
            text(
                "UPDATE incidents.incidents "
                "   SET status = :nuevo, "
                "       resolved_at = CASE WHEN :cierra THEN now() ELSE NULL END, "
                "       resolved_by = CASE WHEN :cierra THEN CAST(:by AS uuid) ELSE NULL END, "
                "       resolution  = CASE WHEN :cierra THEN :res ELSE NULL END, "
                "       updated_at = now(), version = version + 1 "
                " WHERE id = CAST(:i AS uuid) AND status <> :nuevo"
            ),
            {
                "i": str(incident_id),
                "nuevo": nuevo,
                "cierra": cierra,
                "res": resolucion,
                "by": str(actor),
            },
        )
        return res.rowcount or 0

    async def asignar(self, incident_id: UUID, user_id: UUID | None) -> int:
        res = await self._session.execute(
            text(
                "UPDATE incidents.incidents "
                "   SET assigned_to = CAST(:u AS uuid), updated_at = now(), "
                "       version = version + 1 "
                " WHERE id = CAST(:i AS uuid)"
            ),
            {"i": str(incident_id), "u": str(user_id) if user_id else None},
        )
        return res.rowcount or 0

    async def anotar(
        self,
        incident_id: UUID,
        *,
        desde: str | None,
        hasta: str,
        nota: str | None,
        actor: UUID,
    ) -> None:
        """Escribe en el historial. Nunca se borra ni se edita: no hay GRANT para eso."""
        await self._session.execute(
            text(
                "INSERT INTO incidents.events "
                "(tenant_id, incident_id, from_status, to_status, note, actor_id) "
                "VALUES (core.current_tenant_id(), CAST(:i AS uuid), :desde, :hasta, "
                "        :nota, CAST(:by AS uuid))"
            ),
            {
                "i": str(incident_id),
                "desde": desde,
                "hasta": hasta,
                "nota": nota,
                "by": str(actor),
            },
        )
