"""Repositorio del layout del plano: el espacio de trabajo y la colocación.

Como el resto de repositorios, NO añade `WHERE tenant_id = ...`: lo hace RLS. Sí
pasa `tenant_id` en los INSERT porque la columna es `NOT NULL` y la policy lo
comprueba con `WITH CHECK`.

── POR QUÉ REEMPLAZAR Y NO SINCRONIZAR ──────────────────────────────────────

`replace_placements` borra las colocaciones del almacén y las vuelve a insertar en
la misma transacción. La alternativa —comparar lo que hay con lo que llega y emitir
altas, bajas y cambios— es más código para el mismo resultado observable, y abre un
caso que no sabríamos resolver: si el editor envía 340 de 347 racks, ¿los 7 que
faltan se borraron o se perdieron en la red? Publicar es «este es el layout
completo», así que la operación completa es la unidad.

Las 347 filas entran en UNA sentencia con `unnest`. Insertarlas de una en una serían
347 idas y vueltas al pooler: con 260 ms de latencia medidos, 90 segundos.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

_LAYOUT_COLS = (
    "id, warehouse_id, plan_name, plan_width_px, plan_height_px, "
    "pixels_per_meter, origin_x_px, origin_y_px, is_calibrated, "
    "published_at, published_by, updated_at"
)

_PLACEMENT_COLS = (
    "id, rack_node_id, rack_code, node_type, node_function, "
    "x_m, y_m, rotation_deg, width_m, length_m, height_m, color, is_locked, updated_at"
)


class SpatialLayoutRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Lectura ────────────────────────────────────────────────────────────
    async def get_layout(self, warehouse_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_LAYOUT_COLS} FROM spatial.warehouse_layouts "  # noqa: S608
                    "WHERE warehouse_id = CAST(:wh AS uuid)"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def list_placements(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Todas las colocaciones del almacén.

        Sin paginar, y es correcto: son 347 filas por almacén —una por rack— y el
        editor y el visor 3D las necesitan TODAS para dibujar. Paginar aquí
        obligaría a componer el plano por trozos.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_PLACEMENT_COLS} FROM spatial.v_rack_placements "  # noqa: S608
                    "WHERE warehouse_id = CAST(:wh AS uuid) ORDER BY rack_code"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ── Escritura ──────────────────────────────────────────────────────────
    async def upsert_layout(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        plan_name: str | None,
        plan_width_px: int | None,
        plan_height_px: int | None,
        pixels_per_meter: float,
        origin_x_px: float,
        origin_y_px: float,
        is_calibrated: bool,
    ) -> dict[str, Any]:
        """Crea o actualiza el espacio de trabajo del almacén.

        `ON CONFLICT` sobre la unicidad por almacén: el editor publica muchas veces
        sobre el mismo layout y cada publicación no debe crear una versión nueva.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO spatial.warehouse_layouts "  # noqa: S608
                    "(tenant_id, warehouse_id, plan_name, plan_width_px, plan_height_px, "
                    " pixels_per_meter, origin_x_px, origin_y_px, is_calibrated, "
                    " published_at, published_by, created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :name, :w, :h, "
                    "        :ppm, :ox, :oy, :cal, now(), core.current_user_id(), "
                    "        core.current_user_id(), core.current_user_id()) "
                    "ON CONFLICT (tenant_id, warehouse_id) DO UPDATE SET "
                    "  plan_name = EXCLUDED.plan_name, "
                    "  plan_width_px = EXCLUDED.plan_width_px, "
                    "  plan_height_px = EXCLUDED.plan_height_px, "
                    "  pixels_per_meter = EXCLUDED.pixels_per_meter, "
                    "  origin_x_px = EXCLUDED.origin_x_px, "
                    "  origin_y_px = EXCLUDED.origin_y_px, "
                    "  is_calibrated = EXCLUDED.is_calibrated, "
                    "  published_at = now(), "
                    "  published_by = core.current_user_id(), "
                    "  updated_by = core.current_user_id(), "
                    "  version = spatial.warehouse_layouts.version + 1 "
                    f"RETURNING {_LAYOUT_COLS}"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "name": plan_name,
                    "w": plan_width_px,
                    "h": plan_height_px,
                    "ppm": pixels_per_meter,
                    "ox": origin_x_px,
                    "oy": origin_y_px,
                    "cal": is_calibrated,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def replace_placements(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        layout_id: UUID,
        items: Sequence[dict[str, Any]],
    ) -> int:
        await self._session.execute(
            text("DELETE FROM spatial.rack_placements WHERE warehouse_id = CAST(:wh AS uuid)"),
            {"wh": str(warehouse_id)},
        )
        if not items:
            return 0

        await self._session.execute(
            text(
                "INSERT INTO spatial.rack_placements "
                "(tenant_id, warehouse_id, layout_id, rack_node_id, x_m, y_m, "
                " rotation_deg, width_m, length_m, height_m, color, is_locked, "
                " created_by, updated_by) "
                "SELECT CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:lid AS uuid), "
                "       CAST(t.node_id AS uuid), t.x, t.y, t.rot, t.w, t.l, t.h, "
                "       t.color, t.locked, core.current_user_id(), core.current_user_id() "
                "FROM unnest("
                "       CAST(:node_ids AS text[]), CAST(:xs AS double precision[]), "
                "       CAST(:ys AS double precision[]), CAST(:rots AS double precision[]), "
                "       CAST(:ws AS double precision[]), CAST(:ls AS double precision[]), "
                "       CAST(:hs AS double precision[]), CAST(:colors AS text[]), "
                "       CAST(:lockeds AS boolean[])"
                "     ) AS t(node_id, x, y, rot, w, l, h, color, locked)"
            ),
            {
                "tid": str(tenant_id),
                "wh": str(warehouse_id),
                "lid": str(layout_id),
                "node_ids": [str(i["rack_node_id"]) for i in items],
                "xs": [float(i["x_m"]) for i in items],
                "ys": [float(i["y_m"]) for i in items],
                "rots": [float(i["rotation_deg"]) for i in items],
                "ws": [float(i["width_m"]) for i in items],
                "ls": [float(i["length_m"]) for i in items],
                "hs": [float(i["height_m"]) for i in items],
                "colors": [i.get("color") for i in items],
                "lockeds": [bool(i.get("is_locked", False)) for i in items],
            },
        )
        return len(items)

    # ── Geometría derivada (0066) ──────────────────────────────────────────
    async def derive_world_positions(self, warehouse_id: UUID) -> int:
        """Rellena `locations.world_position` desde la colocación de los racks.

        La cuenta la hace PostgreSQL en una sentencia: son 29.310 ubicaciones y
        traerlas para calcular en Python serían 29.310 filas por el cable y otras
        tantas de vuelta, con 260 ms de latencia por delante.

        Devuelve las filas escritas. `0` no es un error: significa que ningún rack
        colocado tiene cuerpos, que es lo que pasa en un almacén sin catálogo.
        """
        fila = (
            await self._session.execute(
                text("SELECT spatial.derive_world_positions(CAST(:wh AS uuid)) AS n"),
                {"wh": str(warehouse_id)},
            )
        ).first()
        return int(fila[0]) if fila else 0

    async def clear_derived_world_positions(self, warehouse_id: UUID) -> int:
        """Borra SOLO la geometría derivada. Lo importado o medido no se toca."""
        fila = (
            await self._session.execute(
                text("SELECT spatial.clear_derived_world_positions(CAST(:wh AS uuid)) AS n"),
                {"wh": str(warehouse_id)},
            )
        ).first()
        return int(fila[0]) if fila else 0

    async def delete_layout(self, warehouse_id: UUID) -> bool:
        """Borra el layout del almacén. Las colocaciones caen por CASCADE."""
        res = await self._session.execute(
            text("DELETE FROM spatial.warehouse_layouts WHERE warehouse_id = CAST(:wh AS uuid)"),
            {"wh": str(warehouse_id)},
        )
        return (res.rowcount or 0) > 0
