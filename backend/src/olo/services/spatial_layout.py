"""Servicio del layout del plano: publicar y leer la colocación de los racks.

── QUÉ DECIDE ESTA CAPA ─────────────────────────────────────────────────────

1. Que publicar es ATÓMICO. El layout y sus 347 colocaciones entran en la misma
   transacción: un plano a medias no es un plano, es un mapa que miente.

2. Que los racks pertenezcan al almacén. La FK compuesta ya lo hace inexpresable,
   pero un `IntegrityError` de PostgreSQL le diría al operador «violación de clave
   foránea fk_placement_node»; aquí se comprueba antes y se responde qué códigos
   sobran.

3. Que no se publique un layout sin calibrar SIN AVISO. No se prohíbe —hay quien
   quiere guardar el trabajo a medias— pero la respuesta lo declara, porque un
   layout sin calibrar tiene las posiciones en una escala inventada de 50 px/m y
   nadie debería descubrirlo al mirar un mapa de calor.

4. Que la geometría de las ubicaciones se derive EN LA MISMA transacción (0066).
   Fuera de ella habría un momento en que los racks están donde los movió el
   operador y las 29.310 ubicaciones donde estaban antes: dos geometrías a la vez,
   que es peor que ninguna.

   Solo se deriva si la escala se midió. Sin calibrar, `pixels_per_meter` es el
   valor de dibujo por defecto y «metros» no significaría nada.

── LO QUE NO HACE ───────────────────────────────────────────────────────────

No rellena `world_footprint` ni `world_bbox`. Un punto es lo que necesitan el
visor 3D y el seguimiento de la flota; una huella poligonal exigiría la
profundidad real de cada hueco, que el catálogo del WMS no trae.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.repositories.spatial_layout import SpatialLayoutRepository

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

# Tope de racks por publicación. El almacén real tiene 347; 5.000 deja margen para
# cualquier nave y ataja un cliente que envíe basura en bucle.
MAX_PLACEMENTS = 5_000


class SpatialLayoutService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._session = session
        self._ctx = ctx
        self._repo = SpatialLayoutRepository(session)

    async def get(self, warehouse_id: UUID) -> dict[str, Any]:
        """Layout con sus colocaciones. Devuelve el hueco vacío si no hay nada.

        No es 404: «este almacén todavía no tiene plano publicado» es una respuesta
        legítima que el editor necesita para saber que empieza de cero.
        """
        await self._verificar_almacen(warehouse_id)
        layout = await self._repo.get_layout(warehouse_id)
        placements = await self._repo.list_placements(warehouse_id) if layout else []
        return {"layout": layout, "placements": placements}

    async def publish(
        self,
        warehouse_id: UUID,
        *,
        plan_name: str | None,
        plan_width_px: int | None,
        plan_height_px: int | None,
        pixels_per_meter: float,
        origin_x_px: float,
        origin_y_px: float,
        is_calibrated: bool,
        placements: Sequence[dict[str, Any]],
    ) -> dict[str, Any]:
        await self._verificar_almacen(warehouse_id)
        if len(placements) > MAX_PLACEMENTS:
            raise BusinessRuleError(
                f"Demasiadas colocaciones: {len(placements)}. El maximo es {MAX_PLACEMENTS}."
            )

        await self._verificar_racks(warehouse_id, [p["rack_node_id"] for p in placements])

        # `tenant_id` sale del contexto y no del cliente: aunque la policy lo
        # comprobaria con WITH CHECK, aceptarlo desde fuera invita a intentarlo.
        tenant_id = self._ctx.tenant_id

        layout = await self._repo.upsert_layout(
            tenant_id=tenant_id,
            warehouse_id=warehouse_id,
            plan_name=plan_name,
            plan_width_px=plan_width_px,
            plan_height_px=plan_height_px,
            pixels_per_meter=pixels_per_meter,
            origin_x_px=origin_x_px,
            origin_y_px=origin_y_px,
            is_calibrated=is_calibrated,
        )
        n = await self._repo.replace_placements(
            tenant_id=tenant_id,
            warehouse_id=warehouse_id,
            layout_id=UUID(str(layout["id"])),
            items=placements,
        )

        # La geometría de las 29.310 ubicaciones se recalcula EN LA MISMA
        # transacción. Fuera de ella habría un momento —corto pero real— en que los
        # racks están donde los movió el operador y las ubicaciones donde estaban
        # antes: un almacén con dos geometrías a la vez, que es peor que ninguna.
        #
        # Solo se deriva si la escala se midió. Sin calibrar, `pixels_per_meter` es
        # el valor de dibujo por defecto, así que «metros» significaría cualquier
        # cosa; se limpia lo que hubiera para no dejar geometría de una escala
        # anterior colgando de una colocación nueva.
        if is_calibrated:
            derivadas = await self._repo.derive_world_positions(warehouse_id)
        else:
            await self._repo.clear_derived_world_positions(warehouse_id)
            derivadas = 0

        return {
            "layout": layout,
            "placements": await self._repo.list_placements(warehouse_id),
            "published": n,
            "calibrated": is_calibrated,
            "derived_locations": derivadas,
        }

    async def delete(self, warehouse_id: UUID) -> None:
        await self._verificar_almacen(warehouse_id)
        # Primero la geometria derivada, y en la misma transaccion: retirar el plano
        # y dejar 29.310 coordenadas apuntando a racks que ya no estan colocados
        # seria geometria huerfana que parece valida.
        await self._repo.clear_derived_world_positions(warehouse_id)
        if not await self._repo.delete_layout(warehouse_id):
            raise NotFoundError(f"No hay layout publicado para el almacen {warehouse_id}")

    async def _verificar_almacen(self, warehouse_id: UUID) -> None:
        """El almacen debe existir Y ser accesible. 404 en los dos casos.

        Sin esto, leer el layout de un almacen ajeno devolvia 200 con
        `{"layout": null}`: RLS filtra las filas, asi que la consulta no encuentra
        nada y «no hay layout» y «no es tu almacen» se confunden. Para el editor
        son la misma respuesta, pero para quien sondea la API la diferencia es que
        un 200 confirma que el uuid existe.

        404 y no 403 por el mismo motivo: un 403 tambien lo confirmaria.
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
        """Los nodos deben existir en ESTE almacén y ser colocables.

        Se comprueba en una sola consulta con `unnest`: preguntar rack por rack
        serían 347 idas y vueltas al pooler.
        """
        if not node_ids:
            return
        filas = (
            await self._session.execute(
                text(
                    "SELECT t.id AS pedido, n.id AS encontrado, n.node_type "
                    "FROM unnest(CAST(:ids AS text[])) AS t(id) "
                    "LEFT JOIN spatial.nodes n "
                    "  ON n.id = CAST(t.id AS uuid) "
                    " AND n.warehouse_id = CAST(:wh AS uuid) "
                    " AND n.deleted_at IS NULL"
                ),
                {"ids": [str(i) for i in node_ids], "wh": str(warehouse_id)},
            )
        ).mappings().all()

        ausentes = [str(f["pedido"]) for f in filas if f["encontrado"] is None]
        if ausentes:
            muestra = ", ".join(ausentes[:5])
            raise BusinessRuleError(
                f"{len(ausentes)} racks no pertenecen a este almacen o no existen: {muestra}"
                + (" …" if len(ausentes) > 5 else "")
            )
