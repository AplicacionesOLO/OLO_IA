"""Incidencias: de «esto no cuadra» a «alguien lo está resolviendo».

═══════════════════════════════════════════════════════════════════════════════
LAS TRANSICIONES SON EXPLICITAS, Y NO TODAS VALEN

    open ──▶ in_progress ──▶ resolved
      │           │      └─▶ dismissed
      └───────────┴─────────▶ dismissed

    resolved / dismissed ──▶ open      (reabrir, si el problema vuelve)

Lo que NO se permite es saltar de `resolved` a `in_progress`: una incidencia cerrada
que reaparece se REABRE, y esa reapertura queda en el historial. Dejarla pasar a
«en curso» borraría la señal de que ya se dio por resuelta una vez, que es justo el
dato que dice que algo se está arreglando mal.

═══════════════════════════════════════════════════════════════════════════════
CERRAR NO ARREGLA EL INVENTARIO

Resolver una incidencia registra que una persona fue al pasillo y decidió algo. NO
cambia el stock: el WMS es el sistema de origen (ADR-009 §3.4) y esto es su espejo.

Si el operario encontró el hueco vacío, quien tiene que corregirse es el WMS. Esta
tabla recuerda que se comprobó, no sustituye la corrección.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.exc import DBAPIError

from olo.core.errors import BusinessRuleError, ConflictError, NotFoundError
from olo.repositories.incidents import IncidentRepository
from olo.services.ai.errors import translate_pg_error

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

#: Qué se puede hacer desde cada estado. Ver la cabecera.
TRANSICIONES: dict[str, set[str]] = {
    "open": {"in_progress", "resolved", "dismissed"},
    "in_progress": {"open", "resolved", "dismissed"},
    "resolved": {"open"},
    "dismissed": {"open"},
}

CIERRAN = {"resolved", "dismissed"}


class IncidentService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._repo = IncidentRepository(session)
        self._ctx = ctx

    async def bandeja(
        self, warehouse_id: UUID, *, estado: str | None = None, limite: int = 200
    ) -> dict[str, Any]:
        """La lista y los recuentos, juntos y a propósito.

        El recuento sale del TOTAL y la lista está acotada: sin los dos, contar las
        filas de la pantalla daría un número menor que el real y nadie lo notaría. Es la
        misma lección que los descuadres del inventario.
        """
        filas = await self._repo.bandeja(warehouse_id, estado=estado, limite=limite)
        conteo = await self._repo.recuento(warehouse_id)
        abiertas = conteo.get("open", 0) + conteo.get("in_progress", 0)
        return {
            "items": filas,
            "counts": conteo,
            "open_total": abiertas,
            "truncated": len(filas) >= limite,
        }

    async def abiertas_por_ubicacion(self, warehouse_id: UUID) -> dict[str, str]:
        return await self._repo.abiertas_por_ubicacion(warehouse_id)

    async def abrir(self, datos: dict[str, Any], *, actor: UUID) -> dict[str, Any]:
        """Abre una incidencia y anota la apertura en el historial.

        ⚠ Responde **409** si ya hay una abierta para ese hueco y motivo, con el id de
          la que ya existe. Sin ese id, la interfaz solo podría decir «ya existe» y la
          persona tendría que buscarla a mano en una lista de cientos.
        """
        titulo = str(datos.get("title") or "").strip()
        if not titulo:
            raise BusinessRuleError("Una incidencia necesita un título que diga qué pasa.")
        datos["title"] = titulo

        if not datos.get("location_id") and not datos.get("location_code") \
                and datos.get("kind") != "manual":
            raise BusinessRuleError(
                "Falta la ubicación: una incidencia de inventario tiene que decir de qué "
                "hueco habla, o no se puede ir a comprobar."
            )

        # ── Se mira ANTES de insertar, y no despues de que falle ──────────────
        #
        # `uq_incidencia_abierta` protege igual, pero una violacion de unicidad ABORTA
        # la transaccion: cualquier consulta posterior muere con «current transaction is
        # aborted» y el 409 se convierte en un 500. Medido — el intento de averiguar
        # cual era la incidencia existente era justo lo que reventaba.
        #
        # Mirando antes se responde con el id de la que ya hay, que es lo que permite a
        # la interfaz llevar allí en vez de dejar a la persona buscando en una lista de
        # cientos.
        codigo = str(datos.get("location_code") or "")
        if codigo:
            abiertas = await self._repo.abiertas_por_ubicacion(
                UUID(str(datos["warehouse_id"]))
            )
            existente = abiertas.get(codigo)
            if existente:
                raise ConflictError(
                    "Ese hueco ya tiene una incidencia abierta. Ábrela en lugar de crear "
                    "otra: dos incidencias del mismo problema convierten la bandeja en "
                    "una lista de clics.",
                    resource_id=existente,
                )

        try:
            nuevo = await self._repo.abrir(datos, actor=actor)
        except DBAPIError as exc:
            # Sigue habiendo carrera: dos personas mirando la misma lista pueden pulsar a
            # la vez. Aquí ya NO se puede consultar nada —la transacción está abortada—,
            # así que el 409 va sin id y con un mensaje que lo explica.
            if _es_duplicado(exc):
                raise ConflictError(
                    "Alguien acaba de abrir una incidencia para ese hueco. Recarga la "
                    "lista y la verás."
                ) from exc
            raise (translate_pg_error(exc) or exc) from exc

        await self._repo.anotar(
            nuevo, desde=None, hasta="open", nota=datos.get("details"), actor=actor
        )
        creada = await self._repo.una(nuevo)
        return creada or {"id": str(nuevo)}

    async def cambiar_estado(
        self, incident_id: UUID, *, nuevo: str, nota: str | None, actor: UUID
    ) -> dict[str, Any]:
        actual = await self._repo.estado_actual(incident_id)
        if actual is None:
            raise NotFoundError("Incidencia no encontrada", resource_id=str(incident_id))

        if nuevo == actual:
            # Idempotente: con dos pestañas abiertas esto pasa, y no es un error.
            devuelta = await self._repo.una(incident_id)
            return devuelta or {}

        permitidas = TRANSICIONES.get(actual, set())
        if nuevo not in permitidas:
            raise BusinessRuleError(
                f"Una incidencia «{actual}» no puede pasar a «{nuevo}». "
                + (
                    "Una incidencia cerrada que vuelve a dar problemas se REABRE, y esa "
                    "reapertura queda registrada: es lo que delata algo que se está "
                    "arreglando mal una y otra vez."
                    if actual in CIERRAN
                    else f"Desde «{actual}» solo se puede ir a: {', '.join(sorted(permitidas))}."
                )
            )

        limpia = (nota or "").strip()
        if nuevo in CIERRAN and not limpia:
            raise BusinessRuleError(
                "Para cerrar hay que decir qué pasó. Una incidencia resuelta sin "
                "explicación no sirve de nada dentro de un mes: nadie puede saber si el "
                "trabajo se hizo."
            )

        try:
            n = await self._repo.cambiar_estado(
                incident_id, nuevo=nuevo, resolucion=limpia or None, actor=actor
            )
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        if n == 0:
            raise NotFoundError("Incidencia no encontrada", resource_id=str(incident_id))

        await self._repo.anotar(
            incident_id, desde=actual, hasta=nuevo, nota=limpia or None, actor=actor
        )
        devuelta = await self._repo.una(incident_id)
        return devuelta or {}

    async def asignar(
        self, incident_id: UUID, user_id: UUID | None, *, actor: UUID
    ) -> dict[str, Any]:
        actual = await self._repo.estado_actual(incident_id)
        if actual is None:
            raise NotFoundError("Incidencia no encontrada", resource_id=str(incident_id))
        try:
            await self._repo.asignar(incident_id, user_id)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

        # La asignación también va al historial: «¿quién se lo dio a quién?» es una de
        # las preguntas que se hacen cuando algo lleva semanas sin moverse.
        await self._repo.anotar(
            incident_id,
            desde=actual,
            hasta=actual,
            nota="Asignada" if user_id else "Sin asignar",
            actor=actor,
        )
        devuelta = await self._repo.una(incident_id)
        return devuelta or {}

    async def historial(self, incident_id: UUID) -> list[dict[str, Any]]:
        if await self._repo.estado_actual(incident_id) is None:
            raise NotFoundError("Incidencia no encontrada", resource_id=str(incident_id))
        return await self._repo.historial(incident_id)


def _es_duplicado(exc: DBAPIError) -> bool:
    """`true` si el motor rechazó por `uq_incidencia_abierta`.

    Se mira el nombre de la restricción y no el texto del mensaje: el texto lo
    reescribe PostgreSQL entre versiones, el nombre lo pusimos nosotros.
    """
    from olo.db.pg_errors import extract_pg_error

    pg = extract_pg_error(exc)
    return bool(pg and pg.constraint == "uq_incidencia_abierta")
