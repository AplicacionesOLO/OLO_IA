"""Servicio de observaciones y rutas.

── QUÉ DECIDE ESTA CAPA ─────────────────────────────────────────────────────

1. Que el desfase del reloj se aplique al LEER, no al escribir. La observación
   conserva la hora que dijo el dispositivo, porque es el dato; la corrección es una
   interpretación y puede cambiar cuando se descubra el desfase real. Aplicarla al
   insertar habría hecho irreversible una conjetura.

2. Que una cámara FIJA no produzca recorrido. Ve siempre el mismo sitio: unir sus
   observaciones con líneas dibujaría un viaje que nadie hizo. Sus observaciones son
   un centinela —«por aquí pasó algo a esta hora»— y se devuelven como puntos.

3. Que la distancia recorrida se declare como lo que es: la suma de las rectas
   ENTRE RACKS OBSERVADOS. No es la trayectoria real —el dron no vuela en línea
   recta de rack a rack, y entre dos observaciones consecutivas puede haber dado la
   vuelta al pasillo— y es una cota INFERIOR del recorrido. Llamarla «distancia
   recorrida» sin más sería una medición inventada.

4. Que los racks se comprueben antes de insertar. La FK compuesta ya hace
   inexpresable observar un rack de otro almacén, pero un `IntegrityError` de
   PostgreSQL le diría al operador «violación de clave foránea fk_obs_node»; aquí se
   responde qué códigos sobran.

── LO QUE NO HACE ───────────────────────────────────────────────────────────

No reconoce nada. No hay modelo, ni fotogramas, ni detección: recibe el resultado de
un reconocimiento hecho fuera. Y no inventa la posición de la fuente: sabe que
estuvo lo bastante cerca de un rack para verlo, que es otra cosa.
"""

from __future__ import annotations

import itertools
import math
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.repositories.spatial_observations import SpatialObservationRepository

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

# Tope por lote. Un vuelo de 20 min reconociendo 2 fotogramas por segundo son
# ~2.400 observaciones; 10.000 deja margen para un turno completo y ataja a un
# cliente que envíe basura en bucle.
MAX_LOTE = 10_000

# Tope de puntos de una ruta. 5.000 vértices ya son más de los que un lienzo
# distingue; por encima hay que acotar la ventana de tiempo, y eso se dice.
MAX_RUTA = 5_000

# Fuentes que NO describen un recorrido. Ver la decisión 2 de la cabecera.
FIJAS = frozenset({"fixed_camera"})


class SpatialObservationService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._session = session
        self._ctx = ctx
        self._repo = SpatialObservationRepository(session)

    # ── Fuentes ────────────────────────────────────────────────────────────
    async def list_sources(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        await self._verificar_almacen(warehouse_id)
        return await self._repo.list_sources(warehouse_id)

    async def register_source(
        self,
        warehouse_id: UUID,
        *,
        code: str,
        name: str,
        kind: str,
        clock_skew_ms: int = 0,
    ) -> dict[str, Any]:
        await self._verificar_almacen(warehouse_id)
        return await self._repo.upsert_source(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            code=code,
            name=name,
            kind=kind,
            clock_skew_ms=clock_skew_ms,
        )

    # ── Ingesta ────────────────────────────────────────────────────────────
    async def ingest(
        self,
        warehouse_id: UUID,
        *,
        source_code: str,
        source_name: str | None,
        source_kind: str | None,
        observations: Sequence[dict[str, Any]],
    ) -> dict[str, Any]:
        """Registra un lote de observaciones. Idempotente.

        La fuente se crea si no existe: un dispositivo nuevo en el pasillo no debe
        tener que darse de alta en otra pantalla antes de poder reportar, porque eso
        significa que su primer vuelo se pierde. Requiere `source_kind` la primera
        vez —sin él no se sabe si sus observaciones forman recorrido— y luego ya no.
        """
        await self._verificar_almacen(warehouse_id)
        if len(observations) > MAX_LOTE:
            raise BusinessRuleError(
                f"Demasiadas observaciones en un lote: {len(observations)}. "
                f"El maximo es {MAX_LOTE}."
            )

        fuente = await self._repo.get_source(warehouse_id, source_code)
        if fuente is None:
            if not source_kind:
                raise BusinessRuleError(
                    f"La fuente '{source_code}' no existe y no se indico su tipo. "
                    "Manda `source_kind` (drone, phone, fixed_camera, forklift o "
                    "manual) para registrarla."
                )
            fuente = await self._repo.upsert_source(
                tenant_id=self._ctx.tenant_id,
                warehouse_id=warehouse_id,
                code=source_code,
                name=source_name or source_code,
                kind=source_kind,
                clock_skew_ms=0,
            )

        await self._verificar_racks(
            warehouse_id, [o["rack_node_id"] for o in observations]
        )

        nuevas = await self._repo.insert_observations(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            source_id=UUID(str(fuente["id"])),
            items=observations,
        )
        return {
            "source": fuente,
            "received": len(observations),
            # Enviadas menos nuevas: lo que ya estaba. Un dron que reintenta un lote
            # ve `duplicates` igual a lo que envio y sabe que no perdio nada.
            "stored": nuevas,
            "duplicates": len(observations) - nuevas,
        }

    # ── Ruta ───────────────────────────────────────────────────────────────
    async def routes(
        self,
        warehouse_id: UUID,
        *,
        source_code: str | None = None,
        desde: datetime | None = None,
        hasta: datetime | None = None,
    ) -> dict[str, Any]:
        """Las rutas del almacén, una por fuente, con sus métricas.

        Devuelve TODAS las fuentes de la ventana y no una lista plana: una polilínea
        por fuente. Aplanarlas dejaría al cliente uniendo el último punto de un dron
        con el primero del siguiente, que es un zigzag que nadie recorrió.
        """
        await self._verificar_almacen(warehouse_id)

        source_id: UUID | None = None
        if source_code:
            fuente = await self._repo.get_source(warehouse_id, source_code)
            if fuente is None:
                raise NotFoundError(
                    f"No existe la fuente '{source_code}' en este almacen"
                )
            source_id = UUID(str(fuente["id"]))

        puntos = await self._repo.route(
            warehouse_id,
            source_id=source_id,
            desde=desde,
            hasta=hasta,
            limite=MAX_RUTA + 1,
        )
        truncada = len(puntos) > MAX_RUTA
        if truncada:
            puntos = puntos[:MAX_RUTA]

        por_fuente: dict[str, dict[str, Any]] = {}
        for p in puntos:
            clave = str(p["source_id"])
            grupo = por_fuente.setdefault(
                clave,
                {
                    "source_id": p["source_id"],
                    "source_code": p["source_code"],
                    "source_name": p["source_name"],
                    "source_kind": p["source_kind"],
                    # Una cámara fija no dibuja recorrido. Se dice en el contrato
                    # para que el cliente no tenga que conocer el vocabulario.
                    "forms_path": p["source_kind"] not in FIJAS,
                    "points": [],
                },
            )
            grupo["points"].append(p)

        rutas = [self._con_metricas(g) for g in por_fuente.values()]
        rutas.sort(key=lambda r: str(r["source_code"]))
        return {"routes": rutas, "truncated": truncada, "max_points": MAX_RUTA}

    def _con_metricas(self, grupo: dict[str, Any]) -> dict[str, Any]:
        """Distancia, duración y velocidad de una ruta.

        La distancia es la suma de las RECTAS entre racks observados consecutivos:
        una cota INFERIOR del recorrido real, porque entre dos observaciones el dron
        pudo dar la vuelta al pasillo. El contrato lo nombra
        `straight_line_distance_m` justamente para que nadie la lea como odometría.

        La velocidad se calcula solo si hay al menos dos observaciones y el tiempo
        avanzó: con una sola, o con dos en el mismo instante, no hay velocidad que
        medir y devolver `0` la habría inventado.
        """
        puntos: list[dict[str, Any]] = grupo["points"]
        distancia = 0.0
        if grupo["forms_path"]:
            for a, b in itertools.pairwise(puntos):
                distancia += math.dist((a["x_m"], a["y_m"]), (b["x_m"], b["y_m"]))

        segundos = None
        if len(puntos) >= 2:
            delta = (puntos[-1]["observed_at"] - puntos[0]["observed_at"]).total_seconds()
            segundos = delta if delta > 0 else None

        return {
            **grupo,
            "point_count": len(puntos),
            "distinct_racks": len({str(p["rack_node_id"]) for p in puntos}),
            "straight_line_distance_m": round(distancia, 3),
            "duration_s": segundos,
            "avg_speed_ms": (
                round(distancia / segundos, 3) if segundos and distancia > 0 else None
            ),
            "first_seen": puntos[0]["observed_at"] if puntos else None,
            "last_seen": puntos[-1]["observed_at"] if puntos else None,
        }

    # ── Historial y cobertura ──────────────────────────────────────────────
    async def observations(
        self, warehouse_id: UUID, *, source_code: str | None = None, limite: int = 500
    ) -> list[dict[str, Any]]:
        await self._verificar_almacen(warehouse_id)
        source_id: UUID | None = None
        if source_code:
            fuente = await self._repo.get_source(warehouse_id, source_code)
            if fuente is None:
                raise NotFoundError(f"No existe la fuente '{source_code}' en este almacen")
            source_id = UUID(str(fuente["id"]))
        return await self._repo.list_observations(
            warehouse_id, source_id=source_id, limite=limite
        )

    async def coverage(self, warehouse_id: UUID) -> dict[str, Any]:
        await self._verificar_almacen(warehouse_id)
        return await self._repo.coverage(warehouse_id)

    async def purge_source(self, warehouse_id: UUID, source_code: str) -> int:
        """Borra las observaciones de una fuente. Ni la fuente ni los racks se tocan."""
        await self._verificar_almacen(warehouse_id)
        fuente = await self._repo.get_source(warehouse_id, source_code)
        if fuente is None:
            raise NotFoundError(f"No existe la fuente '{source_code}' en este almacen")
        return await self._repo.delete_source_observations(
            warehouse_id, UUID(str(fuente["id"]))
        )

    # ── Comprobaciones ─────────────────────────────────────────────────────
    async def _verificar_almacen(self, warehouse_id: UUID) -> None:
        """El almacén debe existir Y ser accesible. 404 en los dos casos.

        Sin esto, consultar la ruta de un almacén ajeno devolvería 200 con una lista
        vacía: RLS filtra las filas, así que «no hay observaciones» y «no es tu
        almacén» se confunden. Para el operador son la misma respuesta; para quien
        sondea la API la diferencia es que un 200 confirma que el uuid existe.
        """
        existe = (
            await self._session.execute(
                text("SELECT 1 FROM core.warehouses WHERE id = CAST(:wh AS uuid)"),
                {"wh": str(warehouse_id)},
            )
        ).first()
        if existe is None:
            raise NotFoundError(f"No existe el almacen {warehouse_id}")

    async def _verificar_racks(self, warehouse_id: UUID, node_ids: Sequence[Any]) -> None:
        """Los racks observados deben existir en ESTE almacén.

        Una sola consulta con `unnest`: preguntar rack por rack serían tantas idas y
        vueltas al pooler como observaciones tenga el lote.
        """
        if not node_ids:
            return
        unicos = {str(i) for i in node_ids}
        filas = (
            await self._session.execute(
                text(
                    "SELECT t.id AS pedido, n.id AS encontrado "
                    "FROM unnest(CAST(:ids AS text[])) AS t(id) "
                    "LEFT JOIN spatial.nodes n "
                    "  ON n.id = CAST(t.id AS uuid) "
                    " AND n.warehouse_id = CAST(:wh AS uuid) "
                    " AND n.deleted_at IS NULL"
                ),
                {"ids": sorted(unicos), "wh": str(warehouse_id)},
            )
        ).mappings().all()

        ausentes = [str(f["pedido"]) for f in filas if f["encontrado"] is None]
        if ausentes:
            muestra = ", ".join(ausentes[:5])
            raise BusinessRuleError(
                f"{len(ausentes)} racks observados no pertenecen a este almacen o no "
                f"existen: {muestra}" + (" …" if len(ausentes) > 5 else "")
            )
