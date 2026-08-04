"""Repositorio del inventario: la foto del WMS y la ocupación que se deriva de ella.

Como el resto de repositorios, NO añade `WHERE tenant_id = ...`: lo hace RLS.

── POR QUÉ TODO SALE DE VISTAS Y NO DE LAS TABLAS ───────────────────────────

Porque la elección de QUÉ foto es la vigente tiene que ser una sola en todo el
sistema. `inventory.v_current_snapshot` la toma —la más reciente en estado `ready`— y
todo lo demás cuelga de ella. Si cada consulta eligiera por su cuenta, el mapa de
calor podría estar pintando la foto de ayer mientras la tabla muestra la de hoy, y las
dos parecerían correctas.

── LOS AGREGADOS SE HACEN EN LA BASE ────────────────────────────────────────

`rack_occupancy` devuelve 347 filas, no 29.312. Traer las ubicaciones para agrupar en
Python serían 29.312 filas por el cable con 260 ms de latencia por delante, y el
cliente tendría que reagruparlas en cada fotograma del giro de la cámara.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

_SNAP_COLS = "snapshot_id, taken_at, received_at, source, row_count, notes"

# `snapshot_id` y `taken_at` NO se seleccionan aunque la vista los traiga: son los
# mismos en las 347 filas, y viajan UNA vez en el envoltorio de la respuesta. Repetir
# la fecha de la foto 347 veces son 347 copias del mismo dato, y además abre la puerta a
# que el cliente lea la de una fila y crea que puede diferir de la de otra.
_RACK_COLS = (
    "rack_id, rack_code, node_function, locations, "
    "occupied, free, occupancy_pct, units, pallets, blocked, first_expiry"
)

# Igual aqui, y por el mismo motivo. El contexto de la foto lo da `/summary`, que es
# lo que la pantalla pide primero para su cabecera.
_LOC_COLS = (
    "location_id, location_code, level, spatial_status, wms_situation, "
    "lines, occupied, pallets, skus, clients, units, first_expiry"
)

_LINEA_COLS = (
    "id, location_id, location_code, pallet_code, sku, description, qty, uom, "
    "client_id, lot, expires_at"
)


class InventoryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── La foto ────────────────────────────────────────────────────────────
    async def current_snapshot(self, warehouse_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_SNAP_COLS} FROM inventory.v_current_snapshot "  # noqa: S608
                    "WHERE warehouse_id = CAST(:wh AS uuid)"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def list_snapshots(self, warehouse_id: UUID, limite: int = 30) -> list[dict[str, Any]]:
        """El histórico de fotos, lo más reciente primero.

        Incluye las que están `loading` y `failed` a propósito: una importación que
        falló es información —alguien lo intentó y no salió— y esconderla haría que
        el operador repitiera el intento sin saber que ya había fallado.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT id AS snapshot_id, taken_at, received_at, source, row_count, "
                    "       status, notes, external_ref "
                    "  FROM inventory.wms_snapshots "
                    " WHERE warehouse_id = CAST(:wh AS uuid) AND deleted_at IS NULL "
                    " ORDER BY taken_at DESC, received_at DESC LIMIT :lim"
                ),
                {"wh": str(warehouse_id), "lim": limite},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ── Ocupación ──────────────────────────────────────────────────────────
    async def rack_occupancy(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Los 347 racks con su ocupación. Sin paginar, y es correcto.

        El mapa de calor y el visor 3D necesitan TODOS para colorear: paginar
        obligaría a pintar el almacén por trozos, y un mapa de calor a medias colorea
        de «vacío» lo que todavía no ha llegado.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_RACK_COLS} FROM inventory.v_rack_occupancy "  # noqa: S608
                    "WHERE warehouse_id = CAST(:wh AS uuid) ORDER BY rack_code"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def location_occupancy(
        self,
        warehouse_id: UUID,
        *,
        rack_id: UUID | None = None,
        solo_ocupadas: bool | None = None,
        limite: int = 500,
    ) -> list[dict[str, Any]]:
        """Ocupación hueco a hueco. Acotada por rack, porque son 29.312.

        El `WHERE` se compone de literales de este módulo; los valores viajan
        enlazados.
        """
        clausulas = ["o.warehouse_id = CAST(:wh AS uuid)"]
        params: dict[str, Any] = {"wh": str(warehouse_id), "lim": limite}
        union = ""
        if rack_id is not None:
            # El rack es el ABUELO de la ubicación: ubicación → cuerpo → rack. Se une
            # en lugar de guardar `rack_id` en la ubicación porque esa jerarquía ya
            # existe en `spatial.nodes` y duplicarla crearía dos verdades.
            union = (
                " JOIN spatial.nodes b ON b.id = o.bay_id "
                " JOIN spatial.nodes r ON r.id = b.parent_node_id "
            )
            clausulas.append("r.id = CAST(:rack AS uuid)")
            params["rack"] = str(rack_id)
        if solo_ocupadas is True:
            clausulas.append("o.occupied")
        elif solo_ocupadas is False:
            clausulas.append("NOT o.occupied")

        filas = (
            await self._session.execute(
                text(
                    f"SELECT {', '.join('o.' + c.strip() for c in _LOC_COLS.split(','))} "  # noqa: S608
                    "  FROM inventory.v_location_occupancy o"
                    f"{union}"
                    f" WHERE {' AND '.join(clausulas)} "
                    " ORDER BY o.location_code LIMIT :lim"
                ),
                params,
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def location_lines(self, location_id: UUID) -> list[dict[str, Any]]:
        """Qué hay en un hueco, según la foto vigente.

        Se une contra `v_current_snapshot` en lugar de traer todas las líneas
        históricas de esa ubicación: preguntar «qué hay aquí» es preguntar por el
        presente, y mezclar fotos daría un hueco con el contenido de dos días.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {', '.join('st.' + c.strip() for c in _LINEA_COLS.split(','))} "  # noqa: S608
                    "  FROM inventory.wms_stock st "
                    "  JOIN inventory.v_current_snapshot cs "
                    "       ON cs.snapshot_id = st.snapshot_id "
                    " WHERE st.location_id = CAST(:loc AS uuid) "
                    " ORDER BY st.pallet_code, st.sku"
                ),
                {"loc": str(location_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ── Búsquedas que hace quien está en el pasillo ────────────────────────
    async def find_pallet(self, warehouse_id: UUID, pallet_code: str) -> list[dict[str, Any]]:
        """«¿Dónde está este pallet?». La pregunta del que lo está buscando."""
        filas = (
            await self._session.execute(
                text(
                    "SELECT st.location_id, st.location_code, st.pallet_code, st.sku, "
                    "       st.description, st.qty, st.uom, st.lot, st.expires_at, "
                    "       cs.taken_at "
                    "  FROM inventory.wms_stock st "
                    "  JOIN inventory.v_current_snapshot cs "
                    "       ON cs.snapshot_id = st.snapshot_id "
                    " WHERE st.warehouse_id = CAST(:wh AS uuid) "
                    "   AND upper(st.pallet_code) = upper(:pal) "
                    " ORDER BY st.location_code"
                ),
                {"wh": str(warehouse_id), "pal": pallet_code},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def find_sku(
        self, warehouse_id: UUID, sku: str, limite: int = 200
    ) -> list[dict[str, Any]]:
        """«¿En qué huecos está este artículo?». Agrupado por hueco.

        Agrupado y no línea a línea: un artículo puede tener varias líneas en el mismo
        hueco —lotes distintos— y para quien va a buscarlo eso es un solo sitio.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT st.location_id, st.location_code, "
                    "       count(*) AS lines, sum(st.qty) AS qty, "
                    "       min(st.description) AS description, "
                    "       count(DISTINCT st.pallet_code) AS pallets, "
                    "       min(st.expires_at) AS first_expiry "
                    "  FROM inventory.wms_stock st "
                    "  JOIN inventory.v_current_snapshot cs "
                    "       ON cs.snapshot_id = st.snapshot_id "
                    " WHERE st.warehouse_id = CAST(:wh AS uuid) "
                    "   AND upper(st.sku) = upper(:sku) "
                    " GROUP BY st.location_id, st.location_code "
                    " ORDER BY st.location_code LIMIT :lim"
                ),
                {"wh": str(warehouse_id), "sku": sku, "lim": limite},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ── Lo que no cuadra ───────────────────────────────────────────────────
    async def mismatches(
        self, warehouse_id: UUID, limite: int = 200
    ) -> tuple[list[dict[str, Any]], dict[str, int]]:
        """Descuadres del WMS consigo mismo, con su recuento por tipo.

        Se devuelven las dos cosas porque son dos preguntas: «¿cuántos hay?» decide si
        merece la pena mirar, y «¿cuáles?» es para mirarlos. Contar en el cliente
        sobre una lista acotada a 200 daría un total equivocado.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT location_id, location_code, wms_situation, spatial_status, "
                    "       lines, units, mismatch "
                    "  FROM inventory.v_occupancy_mismatch "
                    " WHERE warehouse_id = CAST(:wh AS uuid) "
                    " ORDER BY mismatch, location_code LIMIT :lim"
                ),
                {"wh": str(warehouse_id), "lim": limite},
            )
        ).mappings().all()
        conteo = (
            await self._session.execute(
                text(
                    "SELECT mismatch, count(*) AS n FROM inventory.v_occupancy_mismatch "
                    " WHERE warehouse_id = CAST(:wh AS uuid) GROUP BY mismatch"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas], {str(c["mismatch"]): int(c["n"]) for c in conteo}

    async def orphan_stock(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Líneas cuyo hueco no existe en el catálogo. Agrupadas por código."""
        filas = (
            await self._session.execute(
                text(
                    "SELECT o.location_code, o.lines, o.pallets, o.units "
                    "  FROM inventory.v_orphan_stock o "
                    "  JOIN inventory.v_current_snapshot cs "
                    "       ON cs.snapshot_id = o.snapshot_id "
                    " WHERE o.warehouse_id = CAST(:wh AS uuid) "
                    " ORDER BY o.lines DESC"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def summary(self, warehouse_id: UUID) -> dict[str, Any]:
        """Las cifras de cabecera, en UNA consulta.

        Cuatro consultas separadas serían cuatro viajes al pooler para pintar una
        línea de resumen.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*)                                  AS locations, "
                    "       count(*) FILTER (WHERE occupied)           AS occupied, "
                    "       count(*) FILTER (WHERE NOT occupied)       AS free, "
                    "       round(100.0 * count(*) FILTER (WHERE occupied) "
                    "             / nullif(count(*), 0), 1)            AS occupancy_pct, "
                    "       sum(units)                                 AS units, "
                    "       sum(pallets)                               AS pallets, "
                    "       max(taken_at)                              AS taken_at, "
                    "       min(first_expiry)                          AS first_expiry "
                    "  FROM inventory.v_location_occupancy "
                    " WHERE warehouse_id = CAST(:wh AS uuid)"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().one()
        return dict(fila)
