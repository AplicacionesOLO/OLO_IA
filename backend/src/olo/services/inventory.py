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
from sqlalchemy.exc import DBAPIError

from olo.core.errors import BusinessRuleError, ConflictError, NotFoundError
from olo.repositories.inventory import InventoryRepository
from olo.services.ai.errors import translate_pg_error

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

    async def zonas(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Las zonas por nomenclatura. Ver la advertencia del repositorio sobre el sesgo."""
        await self._verificar_almacen(warehouse_id)
        return await self._repo.zonas(warehouse_id)

    async def mismatches(
        self,
        warehouse_id: UUID,
        clase: str | None = None,
        *,
        pagina: int = 1,
        por_pagina: int = 50,
        prefijo: str | None = None,
    ) -> dict[str, Any]:
        """Descuadres del WMS consigo mismo, y stock que apunta a ningún sitio.

        Los dos juntos porque responden a la misma pregunta —«¿cuánto de esto no
        cuadra?»— y separarlos haría que quien mira uno no supiera del otro.

        `clase` acota la LISTA, nunca el recuento: `counts` sigue siendo el total por
        tipo. Si se filtrara también, la interfaz mostraría «716» y al pulsar el filtro
        el número cambiaría a lo que quepa en la página, que es justo la confusión que
        `truncated` existe para evitar.

        `truncated` se calcula contra el total de LA CLASE pedida, no contra la suma de
        todas: con un filtro puesto, comparar contra el total global diría «hay más» aun
        habiendo listado todos los de ese tipo.

        ── TRES TOTALES, Y LOS TRES HACEN FALTA ─────────────────────────────────

            filtered_total   lo que hay que paginar: pasa el filtro de clase Y el de zona
            total            la zona entera, todas las clases. Es lo de las pestañas
            warehouse_total  el almacén entero, sin filtros

        Con `prefijo` puesto los tres se separan —113, 113 y 2.186 midiendo CANT— y
        enseñar solo el primero haría que acotar la vista pareciera reducir el problema.
        """
        await self._verificar_almacen(warehouse_id)
        por_pagina = max(1, min(por_pagina, MAX_DESCUADRES))
        pagina = max(1, pagina)

        filas, conteo = await self._repo.mismatches(
            warehouse_id,
            limite=por_pagina,
            clase=clase,
            desplazamiento=(pagina - 1) * por_pagina,
            prefijo=prefijo,
        )
        huerfano = await self._repo.orphan_stock(warehouse_id)
        # El repositorio devuelve el total del almacén dentro del propio recuento, en la
        # misma pasada. Se saca aquí para que `counts` siga siendo lo que dice ser: un
        # recuento por CLASE. Una clave sintética colada entre las reales acabaría
        # pintada como una pestaña más.
        total_almacen = int(conteo.pop("__almacen__", 0))
        total_global = sum(conteo.values())
        # El alcance —lo que hay que paginar— es el de la clase elegida, no el global:
        # con un filtro puesto, calcular las páginas sobre el total daría más páginas de
        # las que existen y las últimas saldrían vacías.
        alcance = conteo.get(clase, 0) if clase else total_global
        paginas = max(1, -(-alcance // por_pagina))  # techo, sin importar math

        return {
            "counts": conteo,
            # `total` es de la ZONA: acotar a CANT lo baja de 2.186 a 113, que es lo que
            # deben decir las pestañas. `warehouse_total` es el del almacén entero, para
            # que filtrar no parezca haber resuelto el problema.
            "total": total_global,
            "warehouse_total": total_almacen,
            "listed": filas,
            # Se conserva `truncated` porque el contrato ya lo tenía, pero con paginación
            # significa otra cosa: «hay más páginas», no «esto está recortado y no se
            # puede ver el resto».
            "truncated": paginas > 1,
            "page": pagina,
            "page_size": por_pagina,
            "pages": paginas,
            "filtered_total": alcance,
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

    # ── Zonas definidas a mano ────────────────────────────────────────────────
    async def clusters(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        await self._verificar_almacen(warehouse_id)
        return await self._repo.clusters(warehouse_id)

    async def miembros(self, cluster_id: UUID) -> list[dict[str, Any]]:
        if not await self._repo.cluster_existe(cluster_id):
            raise NotFoundError("Zona no encontrada", resource_id=str(cluster_id))
        return await self._repo.miembros(cluster_id)

    async def crear_cluster(
        self, warehouse_id: UUID, nombre: str, notas: str | None, *, actor: UUID
    ) -> dict[str, Any]:
        """Crea una zona vacía. Los miembros se añaden después, uno a uno.

        Nace SIN miembros a propósito: crear y llenar en la misma llamada obligaría a
        decidir qué pasa si el tercer miembro falla —¿se queda la zona a medias, o se
        pierde el trabajo?—. Vacía es un estado legítimo y visible.
        """
        await self._verificar_almacen(warehouse_id)
        limpio = (nombre or "").strip()
        if not limpio:
            raise BusinessRuleError("La zona necesita un nombre para poder elegirla después.")
        try:
            nuevo = await self._repo.crear_cluster(
                warehouse_id, limpio, (notas or "").strip() or None, actor=actor
            )
        except DBAPIError as exc:
            if _es_nombre_repetido(exc):
                raise ConflictError(
                    f"Ya hay una zona llamada «{limpio}» en este almacén. Dos zonas con "
                    "el mismo nombre serían indistinguibles en cualquier lista.",
                    field="name",
                ) from exc
            raise (translate_pg_error(exc) or exc) from exc
        zonas = await self._repo.clusters(warehouse_id)
        return next((z for z in zonas if str(z["id"]) == str(nuevo)), {"id": str(nuevo)})

    async def borrar_cluster(self, cluster_id: UUID) -> None:
        """Borra la zona y sus miembros. El catálogo espacial NO se toca.

        Un cluster es una etiqueta encima del almacén: quitarla deja el edificio, los
        racks y los huecos exactamente como estaban.
        """
        if await self._repo.borrar_cluster(cluster_id) == 0:
            raise NotFoundError("Zona no encontrada", resource_id=str(cluster_id))

    async def anadir_miembro(
        self, cluster_id: UUID, *, prefijo: str | None, rack_id: UUID | None
    ) -> list[dict[str, Any]]:
        if not await self._repo.cluster_existe(cluster_id):
            raise NotFoundError("Zona no encontrada", resource_id=str(cluster_id))

        limpio = (prefijo or "").strip().upper() or None
        if bool(limpio) == bool(rack_id):
            # Los dos o ninguno. El CHECK del motor lo impide igual, pero su mensaje no
            # dice cuál de las dos cosas se esperaba.
            raise BusinessRuleError(
                "Un miembro es un prefijo de nomenclatura O un rack concreto, no las dos "
                "cosas: con las dos no se sabría si la zona incluye ese rack o todos los "
                "de su prefijo."
            )
        try:
            await self._repo.anadir_miembro(cluster_id, prefijo=limpio, rack_id=rack_id)
        except DBAPIError as exc:
            if _es_miembro_repetido(exc):
                raise ConflictError(
                    "Eso ya está en la zona. Añadirlo dos veces duplicaría sus huecos en "
                    "el recuento y la zona diría tener más capacidad de la que tiene."
                ) from exc
            raise (translate_pg_error(exc) or exc) from exc
        return await self._repo.miembros(cluster_id)

    async def quitar_miembro(self, cluster_id: UUID, miembro_id: UUID) -> list[dict[str, Any]]:
        if await self._repo.quitar_miembro(cluster_id, miembro_id) == 0:
            raise NotFoundError("Ese miembro no está en la zona", resource_id=str(miembro_id))
        return await self._repo.miembros(cluster_id)


def _es_nombre_repetido(exc: DBAPIError) -> bool:
    """Choque contra `uq_cluster_nombre`. Por nombre de indice, no por el mensaje."""
    from olo.db.pg_errors import extract_pg_error

    pg = extract_pg_error(exc)
    return bool(pg and pg.constraint == "uq_cluster_nombre")


def _es_miembro_repetido(exc: DBAPIError) -> bool:
    from olo.db.pg_errors import extract_pg_error

    pg = extract_pg_error(exc)
    return bool(pg and pg.constraint in ("uq_miembro_prefijo", "uq_miembro_rack"))
