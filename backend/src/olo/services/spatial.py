"""Servicio del dominio espacial. Solo lectura.

Lo que corresponde a esta capa: construir y validar cursores, decidir cuándo se
paga un `count`, y traducir «no hay fila» a 404. Las reglas de forma están en la
base (CHECK, guardianes) y los agregados en las vistas.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.repositories.spatial import SpatialRepository

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50

# Profundidad máxima del árbol que se puede pedir de una vez. 4 cubre
# site → rack → bay → (hoja) con margen; pedir más de golpe devolvería los 2.701
# cuerpos del almacén real, que es justo lo que la navegación por niveles evita.
MAX_TREE_DEPTH = 6
DEFAULT_TREE_DEPTH = 2

# Tope de `page` para el modo por número de página. Sin él, `page=1000000` con
# `page_size=200` produce un `OFFSET 200000000` que la base intenta ejecutar.
MAX_PAGE = 10_000


# Lo que se devuelve cuando una ubicacion no tiene extras. Antes estaba escrito dos
# veces en el modulo, y anadir `world_x_m` habria dejado uno de los dos caminos
# —lista y detalle— devolviendo un campo menos que el otro sin que nada fallara.
_EXTRAS_VACIO: dict[str, Any] = {
    "capacity_declared_unlimited": False,
    "logical_column": None,
    "world_x_m": None,
    "world_y_m": None,
    "world_z_m": None,
}


@dataclass(frozen=True, slots=True)
class Page:
    items: Sequence[dict[str, Any]]
    next_cursor: str | None
    total: int | None
    page: int | None
    total_pages: int | None


def _encode_cursor(code: str, entity_id: UUID) -> str:
    raw = f"{code}\x00{entity_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        code, _, raw_id = base64.urlsafe_b64decode(padded).decode().partition("\x00")
        return code, UUID(raw_id)
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise BusinessRuleError("El cursor de paginación no es válido") from exc


def _encode_code_cursor(code: str) -> str:
    return base64.urlsafe_b64encode(code.encode()).decode().rstrip("=")


def _decode_code_cursor(cursor: str) -> str:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        return base64.urlsafe_b64decode(padded).decode()
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise BusinessRuleError("El cursor de paginación no es válido") from exc


class SpatialService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._session = session
        self._ctx = ctx
        self._repo = SpatialRepository(session)

    # ── Resumen ───────────────────────────────────────────────────────────
    async def list_summaries(self) -> list[dict[str, Any]]:
        return await self._repo.summaries()

    async def get_summary(self, warehouse_id: UUID) -> dict[str, Any]:
        row = await self._repo.summary(warehouse_id)
        if row is None:
            # Un almacén de otro tenant es invisible por RLS y llega aquí como
            # «no existe». 404, no 403: un 403 confirmaría que existe.
            raise NotFoundError(f"No existe el almacén {warehouse_id}")
        return row

    # ── Árbol ─────────────────────────────────────────────────────────────
    async def get_tree(
        self,
        warehouse_id: UUID,
        *,
        depth: int = DEFAULT_TREE_DEPTH,
        parent_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        # El almacén debe existir y ser accesible ANTES de recorrer el árbol: si
        # no, un almacén inexistente devolvería una lista vacía y el cliente no
        # podría distinguirlo de un almacén sin nodos.
        await self.get_summary(warehouse_id)
        profundidad = max(0, min(depth, MAX_TREE_DEPTH))
        return await self._repo.tree(
            warehouse_id, max_depth=profundidad, parent_id=parent_id
        )

    async def get_node(self, node_id: UUID) -> dict[str, Any]:
        row = await self._repo.node(node_id)
        if row is None:
            raise NotFoundError(f"No existe el nodo {node_id}")
        return row

    async def get_children(
        self,
        node_id: UUID,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        with_total: bool = False,
    ) -> Page:
        await self.get_node(node_id)
        size = max(1, min(limit, MAX_PAGE_SIZE))
        code = _decode_code_cursor(cursor) if cursor else None

        rows = await self._repo.children(node_id, limit=size + 1, cursor_code=code)
        items, siguiente = self._recortar_por_codigo(rows, size, "node_code")
        total = await self._repo.count_children(node_id) if with_total else None
        return Page(
            items=items,
            next_cursor=siguiente,
            total=total,
            page=None,
            total_pages=self._paginas(total, size),
        )

    # ── Plano de planta ───────────────────────────────────────────────────
    async def get_floor_plan(
        self,
        warehouse_id: UUID,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        node_function: str | None = None,
        search: str | None = None,
        with_total: bool = False,
    ) -> Page:
        await self.get_summary(warehouse_id)
        size = max(1, min(limit, MAX_PAGE_SIZE))
        code = _decode_code_cursor(cursor) if cursor else None

        rows = await self._repo.floor_plan(
            warehouse_id,
            limit=size + 1,
            cursor_code=code,
            node_function=node_function,
            search=search,
        )
        items, siguiente = self._recortar_por_codigo(rows, size, "rack_code")
        # El total de racks es un `count` sobre 3.048 nodos, no sobre 29.310
        # ubicaciones: 4,7 ms medidos. Aquí sí se puede pagar siempre... pero no
        # se paga, porque el cliente que dibuja el plano no lo usa y el que
        # pagina sí. Se pide.
        total = await self._repo.count_floor_plan(warehouse_id) if with_total else None
        return Page(
            items=items,
            next_cursor=siguiente,
            total=total,
            page=None,
            total_pages=self._paginas(total, size),
        )

    # ── Alzado ────────────────────────────────────────────────────────────
    async def get_rack_front_view(self, rack_id: UUID) -> dict[str, Any]:
        nodo = await self.get_node(rack_id)
        celdas = await self._repo.rack_front_view(rack_id)

        # Las dimensiones se calculan aquí, una vez, en lugar de dejar que el
        # cliente haga `max()` sobre las celdas para dimensionar la rejilla.
        niveles = [c["level"] for c in celdas if c["level"] is not None]
        posiciones = [c["position"] for c in celdas if c["position"] is not None]
        cuerpos = {c["bay_id"] for c in celdas}

        return {
            "rack_id": nodo["node_id"],
            "rack_code": nodo["node_code"],
            "rack_external_code": nodo["external_code"],
            "node_function": nodo["node_function"],
            "function_label": nodo["function_label"],
            "bay_count": len(cuerpos),
            "max_level": max(niveles) if niveles else None,
            "max_position": max(posiciones) if posiciones else None,
            "cells": celdas,
        }

    # ── La capa «Inspección» del visor ────────────────────────────────────
    async def get_estado_observado(
        self, warehouse_id: UUID, rack_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Lo último que se vio en cada hueco, frente a lo que el WMS declara.

        Es lo que le faltaba al mapa. El visor pintaba el catálogo y la ocupación
        DECLARADA; lo que la cámara había visto se quedaba en la pantalla de
        reconciliación, en una tabla, sin llegar nunca al sitio donde se mira el almacén.

        Que el almacén exista se comprueba antes de consultar: sin eso, un almacén de otro
        tenant —invisible por RLS— devolvería una lista vacía y el cliente lo leería como
        «aquí no se ha inspeccionado nada», que es una conclusión muy distinta.
        """
        await self.get_summary(warehouse_id)
        if rack_id is not None:
            await self.get_node(rack_id)
        return await self._repo.estado_observado(warehouse_id, rack_id)

    async def get_cobertura_inspeccion(self, warehouse_id: UUID) -> dict[str, Any]:
        """Cuanto del almacen se ha mirado, y cuando.

        Sin este numero, «cero discrepancias» significa dos cosas a la vez —«todo cuadra»
        y «no has mirado»— y son la conclusion contraria. Medido hoy: 4 huecos con lectura
        de 29.312.
        """
        await self.get_summary(warehouse_id)
        return await self._repo.cobertura_inspeccion(warehouse_id)

    #: Que estados cuentan como «no cuadra». Misma lista que la que genera incidencias:
    #: si cambiara solo aqui, la pantalla diria «resuelto» de algo que sigue abierto.
    _DISCREPAN = frozenset(
        {"unexpected_pallet", "unexpected_empty", "location_unknown"}
    )

    async def get_cambios_inspeccion(
        self, warehouse_id: UUID, rack_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Que cambio entre el ultimo recorrido y el anterior, hueco a hueco.

        ── LOS CUATRO VEREDICTOS, Y POR QUE IMPORTAN ─────────────────────────────

            resuelto     antes no cuadraba y ahora si    → el trabajo sirvio
            persiste     no cuadraba y sigue igual       → nadie lo esta arreglando
            nuevo        cuadraba y ahora no             → paso algo desde el ultimo vuelo
            cambio       el pallet observado es otro     → se movio mercancia

        El segundo es el que nadie mide y el que mas dice: una discrepancia que aguanta
        tres vuelos no es un hallazgo, es un proceso roto.

        Lo que sigue cuadrando NO sale. Un listado de «cambios» donde la mayoria de las
        filas dicen «igual que antes» es una tabla que nadie lee dos veces.
        """
        await self.get_summary(warehouse_id)
        if rack_id is not None:
            await self.get_node(rack_id)

        filas = await self._repo.cambios_entre_recorridos(warehouse_id, rack_id)
        salida: list[dict[str, Any]] = []
        for f in filas:
            antes_mal = f["status_before"] in self._DISCREPAN
            ahora_mal = f["status_now"] in self._DISCREPAN
            cambio_pallet = f["pallet_before"] != f["pallet_now"]

            if antes_mal and not ahora_mal:
                veredicto = "resuelto"
            elif not antes_mal and ahora_mal:
                veredicto = "nuevo"
            elif antes_mal and ahora_mal:
                #  Sigue mal. Que el pallet sea OTRO es una variante que merece decirse:
                #  no es la misma discrepancia aguantando, es una nueva encima.
                veredicto = "cambio" if cambio_pallet else "persiste"
            elif cambio_pallet:
                #  Cuadraba y cuadra, pero el pallet es otro: hubo movimiento y el WMS lo
                #  siguió. Es la única forma barata de ver que el almacén se mueve bien.
                veredicto = "cambio"
            else:
                #  Igual que antes y bien. No sale: ver la nota de arriba.
                continue
            salida.append({**f, "verdict": veredicto})
        return salida

    # ── Ubicaciones ───────────────────────────────────────────────────────
    async def list_locations(
        self,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        page: int | None = None,
        warehouse_id: UUID | None = None,
        rack_id: UUID | None = None,
        bay_id: UUID | None = None,
        status: str | None = None,
        situation: str | None = None,
        code_form: str | None = None,
        level: int | None = None,
        search: str | None = None,
        with_total: bool = False,
    ) -> Page:
        size = max(1, min(limit, MAX_PAGE_SIZE))

        if cursor and page:
            # Los dos a la vez es ambiguo: ¿la página 5 desde el cursor, o la 5
            # absoluta? Se rechaza en lugar de elegir en silencio.
            raise BusinessRuleError(
                "Use `cursor` o `page`, no los dos: son dos formas de decir dónde "
                "empezar y juntas no significan nada"
            )
        if page is not None and page > MAX_PAGE:
            raise BusinessRuleError(
                f"`page` no puede pasar de {MAX_PAGE}: use `cursor` para recorridos "
                "profundos, cuyo coste no crece con la profundidad"
            )

        cursor_code: str | None = None
        cursor_id: UUID | None = None
        if cursor:
            cursor_code, cursor_id = _decode_cursor(cursor)

        offset = (page - 1) * size if page and page > 1 else None

        rows = await self._repo.locations(
            limit=size + 1,
            cursor_code=cursor_code,
            cursor_id=cursor_id,
            offset=offset,
            warehouse_id=warehouse_id,
            rack_id=rack_id,
            bay_id=bay_id,
            status=status,
            situation=situation,
            code_form=code_form,
            level=level,
            search=search,
        )

        hay_mas = len(rows) > size
        items = list(rows[:size])
        siguiente = (
            _encode_cursor(items[-1]["full_code"], items[-1]["location_id"])
            if hay_mas and items
            else None
        )

        # Los dos campos que la vista no expone, en UNA consulta por página y no
        # una por fila: con `page_size=200` la diferencia son 200 viajes al
        # pooler, y cada viaje son 260 ms medidos.
        extras = await self._repo.location_extras([i["location_id"] for i in items])
        vacio = _EXTRAS_VACIO
        enriquecidas = [{**dict(i), **extras.get(i["location_id"], vacio)} for i in items]

        total = None
        if with_total:
            total = await self._repo.count_locations(
                warehouse_id=warehouse_id,
                rack_id=rack_id,
                bay_id=bay_id,
                status=status,
                situation=situation,
                code_form=code_form,
                level=level,
                search=search,
            )

        return Page(
            items=enriquecidas,
            next_cursor=siguiente,
            total=total,
            page=page,
            total_pages=self._paginas(total, size),
        )

    async def get_location(self, location_id: UUID) -> dict[str, Any]:
        row = await self._repo.location(location_id)
        if row is None:
            raise NotFoundError(f"No existe la ubicación {location_id}")
        extras = await self._repo.location_extras([row["location_id"]])
        return {
            **dict(row),
            **extras.get(
                row["location_id"],
                _EXTRAS_VACIO,
            ),
        }

    # ── Auxiliares ────────────────────────────────────────────────────────
    @staticmethod
    def _recortar_por_codigo(
        rows: Sequence[dict[str, Any]], size: int, campo: str
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Recorta la fila extra y devuelve el cursor de la siguiente página.

        Se pide `size + 1` fila para saber si hay más SIN un `count`. La fila
        extra no se devuelve: es solo la respuesta a «¿hay más?».
        """
        hay_mas = len(rows) > size
        items = list(rows[:size])
        siguiente = _encode_code_cursor(items[-1][campo]) if hay_mas and items else None
        return items, siguiente

    @staticmethod
    def _paginas(total: int | None, size: int) -> int | None:
        if total is None:
            return None
        return max(1, -(-total // size))
