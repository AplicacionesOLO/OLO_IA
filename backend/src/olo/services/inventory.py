"""Servicio del inventario y la ocupación.

── QUÉ DECIDE ESTA CAPA ─────────────────────────────────────────────────────

1. Que «sin foto» sea una respuesta y no un error. Un almacén al que nadie ha
   importado inventario devuelve la estructura con todo a cero y `snapshot: null`,
   porque el explorador necesita distinguir «nadie ha subido el inventario» de «no
   puedo leerlo». Un 404 haría que la pantalla mostrara un error sobre un almacén
   perfectamente sano.

2. Que la ocupación se lea siempre de la MISMA foto. La elige la vista
   `v_current_snapshot`; aquí solo se pasa el almacén. Si este servicio pudiera
   elegir otra, el mapa de calor y la tabla podrían discrepar sin que nada fallara.

3. Que el descuadre se devuelva CONTADO además de listado. El recuento sale de la
   base sobre el total; la lista está acotada. Contar la lista daría un número menor
   que el real y nadie lo notaría.

── LO QUE NO HACE ───────────────────────────────────────────────────────────

No escribe. El WMS es el sistema de origen y esto es su espejo de solo lectura
(ADR-009 §3.4): la única escritura del inventario es importar una foto nueva, y eso lo
hace `tools/import_inventory_snapshot.py` por fuera de la API, con auditoría y hash
del archivo. Un endpoint que permitiera «corregir» una cantidad crearía una segunda
verdad sobre lo que hay en un hueco, y sería la equivocada.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from olo.core.errors import NotFoundError
from olo.repositories.inventory import InventoryRepository

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

# Tope de huecos por consulta. 500 es una pantalla de tabla con margen; el mapa de
# calor no los usa —va por rack— así que nadie necesita las 29.312 de una vez.
MAX_UBICACIONES = 500

# Tope de descuadres listados. Con 2.186 medidos, listarlos todos sería una tabla que
# nadie recorre; el recuento por tipo es lo que dice si hay que mirar.
MAX_DESCUADRES = 200


class InventoryService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._session = session
        self._ctx = ctx
        self._repo = InventoryRepository(session)

    async def summary(self, warehouse_id: UUID) -> dict[str, Any]:
        """Cifras de ocupación del almacén, con la foto de la que salen.

        Devuelve la estructura completa aunque no haya inventario: el cliente lee
        `snapshot: null` y dice «nadie ha subido el inventario» en lugar de fallar.
        """
        await self._verificar_almacen(warehouse_id)
        snap = await self._repo.current_snapshot(warehouse_id)
        resumen = await self._repo.summary(warehouse_id)
        return {
            "snapshot": snap,
            **resumen,
            # Sin foto, la ocupación no es 0 %: es DESCONOCIDA. Devolver 0 diría que el
            # almacén está vacío, que es una afirmación sobre el mundo que nadie ha
            # comprobado.
            "occupancy_pct": resumen["occupancy_pct"] if snap else None,
        }

    async def snapshots(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        await self._verificar_almacen(warehouse_id)
        return await self._repo.list_snapshots(warehouse_id)

    async def rack_occupancy(self, warehouse_id: UUID) -> dict[str, Any]:
        """Ocupación de los 347 racks, con la foto y el total.

        Se devuelve envuelto y no como lista plana porque el cliente necesita saber DE
        QUÉ FOTO son esos números para poder decirlo en pantalla. Una lista sin fecha
        obligaría a una segunda petición para contextualizarla.
        """
        await self._verificar_almacen(warehouse_id)
        filas = await self._repo.rack_occupancy(warehouse_id)
        snap = await self._repo.current_snapshot(warehouse_id)
        return {"snapshot": snap, "racks": filas}

    async def location_occupancy(
        self,
        warehouse_id: UUID,
        *,
        rack_id: UUID | None = None,
        occupied: bool | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        await self._verificar_almacen(warehouse_id)
        return await self._repo.location_occupancy(
            warehouse_id,
            rack_id=rack_id,
            solo_ocupadas=occupied,
            limite=min(limit, MAX_UBICACIONES),
        )

    async def location_content(self, warehouse_id: UUID, location_id: UUID) -> dict[str, Any]:
        """Qué hay en un hueco. `lines: []` significa vacío, no «no existe».

        Se comprueba que la ubicación exista para poder distinguir las dos cosas: un
        hueco vacío y un uuid inventado devolverían lo mismo, y quien consulta no
        sabría si el hueco está libre o si se equivocó de identificador.
        """
        await self._verificar_almacen(warehouse_id)
        existe = (
            await self._session.execute(
                text(
                    "SELECT code FROM spatial.locations "
                    " WHERE id = CAST(:loc AS uuid) AND warehouse_id = CAST(:wh AS uuid) "
                    "   AND deleted_at IS NULL"
                ),
                {"loc": str(location_id), "wh": str(warehouse_id)},
            )
        ).first()
        if existe is None:
            raise NotFoundError(f"No existe la ubicacion {location_id} en este almacen")
        lineas = await self._repo.location_lines(location_id)
        return {
            "location_id": location_id,
            "location_code": existe[0],
            "lines": lineas,
            "occupied": len(lineas) > 0,
        }

    async def find(
        self, warehouse_id: UUID, *, pallet: str | None = None, sku: str | None = None
    ) -> dict[str, Any]:
        """Buscar por pallet o por artículo. Es la consulta del pasillo.

        Uno de los dos, no los dos: buscar «el pallet X del artículo Y» es una
        intersección que nadie pide, y aceptarla obligaría a decidir qué significa que
        no coincidan.
        """
        await self._verificar_almacen(warehouse_id)
        if bool(pallet) == bool(sku):
            from olo.core.errors import BusinessRuleError

            raise BusinessRuleError(
                "Indica `pallet` O `sku`, no los dos ni ninguno: son dos busquedas "
                "distintas."
            )
        if pallet:
            return {
                "by": "pallet",
                "term": pallet,
                "hits": await self._repo.find_pallet(warehouse_id, pallet),
            }
        assert sku is not None
        return {"by": "sku", "term": sku, "hits": await self._repo.find_sku(warehouse_id, sku)}

    async def mismatches(self, warehouse_id: UUID) -> dict[str, Any]:
        """Descuadres del WMS consigo mismo, y stock que apunta a ningún sitio.

        Los dos juntos porque responden a la misma pregunta —«¿cuánto de esto no
        cuadra?»— y separarlos haría que quien mira uno no supiera del otro.
        """
        await self._verificar_almacen(warehouse_id)
        filas, conteo = await self._repo.mismatches(warehouse_id, limite=MAX_DESCUADRES)
        huerfano = await self._repo.orphan_stock(warehouse_id)
        return {
            "counts": conteo,
            "total": sum(conteo.values()),
            "listed": filas,
            "truncated": sum(conteo.values()) > len(filas),
            "orphan_stock": huerfano,
            "orphan_lines": sum(int(h["lines"]) for h in huerfano),
        }

    async def _verificar_almacen(self, warehouse_id: UUID) -> None:
        """El almacén debe existir Y ser accesible. 404 en los dos casos.

        Sin esto, consultar el inventario de un almacén ajeno devolvería 200 con todo a
        cero: RLS filtra las filas, así que «no hay inventario» y «no es tu almacén» se
        confunden. Para el operador son la misma respuesta; para quien sondea la API la
        diferencia es que un 200 confirma que el uuid existe.
        """
        existe = (
            await self._session.execute(
                text("SELECT 1 FROM core.warehouses WHERE id = CAST(:wh AS uuid)"),
                {"wh": str(warehouse_id)},
            )
        ).first()
        if existe is None:
            raise NotFoundError(f"No existe el almacen {warehouse_id}")
