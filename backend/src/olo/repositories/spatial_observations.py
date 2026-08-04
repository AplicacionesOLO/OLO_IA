"""Repositorio de observaciones de racks y de las rutas derivadas (0067).

Como el resto de repositorios, NO añade `WHERE tenant_id = ...`: lo hace RLS. Sí
pasa `tenant_id` en los INSERT porque la columna es `NOT NULL` y la policy lo
comprueba con `WITH CHECK`.

── POR QUÉ LA INGESTA ES `ON CONFLICT DO NOTHING` Y NO UN ERROR ─────────────

Un dron sin cobertura sube su vuelo al aterrizar, y si la conexión se corta a
medias reintenta el lote COMPLETO. Sin idempotencia, el segundo intento duplicaría
las observaciones que ya entraron: la ruta pasaría dos veces por los mismos racks
y la distancia recorrida saldría al doble, sin que nada fallara.

La unicidad `(source_id, rack_node_id, observed_at)` lo impide, y `DO NOTHING` hace
que reintentar sea seguro en lugar de un 409 que el dispositivo no sabría resolver.
Lo que sí se devuelve es cuántas entraron de verdad: 400 enviadas y 12 nuevas es una
respuesta útil —«ya lo tenía»— y 400 enviadas y 400 nuevas también.

── POR QUÉ TODO ENTRA EN UNA SENTENCIA ──────────────────────────────────────

Un vuelo de 20 minutos con reconocimiento a 2 fotogramas por segundo son ~2.400
observaciones. Insertarlas de una en una serían 2.400 idas y vueltas al pooler: con
260 ms de latencia medidos, diez minutos. Con `unnest`, una.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

_SOURCE_COLS = (
    "id, warehouse_id, code, name, kind, clock_skew_ms, is_active, metadata, "
    "created_at, updated_at"
)

_ROUTE_COLS = (
    "observation_id, source_id, source_code, source_name, source_kind, "
    "rack_node_id, rack_code, observed_at, confidence, frame_ref, frame_ms, "
    "x_m, y_m, rotation_deg, paso"
)

_OBS_COLS = (
    "observation_id, source_id, source_code, source_kind, rack_node_id, rack_code, "
    "observed_at, ingested_at, confidence, frame_ref, frame_ms, notes, rack_colocado"
)


class SpatialObservationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Fuentes ────────────────────────────────────────────────────────────
    async def list_sources(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_SOURCE_COLS} FROM spatial.observation_sources "  # noqa: S608
                    "WHERE warehouse_id = CAST(:wh AS uuid) AND deleted_at IS NULL "
                    "ORDER BY code"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def get_source(self, warehouse_id: UUID, code: str) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_SOURCE_COLS} FROM spatial.observation_sources "  # noqa: S608
                    "WHERE warehouse_id = CAST(:wh AS uuid) AND code = :code "
                    "  AND deleted_at IS NULL"
                ),
                {"wh": str(warehouse_id), "code": code},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def upsert_source(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        code: str,
        name: str,
        kind: str,
        clock_skew_ms: int,
    ) -> dict[str, Any]:
        """Crea la fuente o actualiza su nombre y su desfase.

        `ON CONFLICT` sobre `(tenant_id, warehouse_id, code)`: un dispositivo se
        registra con el mismo código cada vez que aparece, y el segundo vuelo de
        DRONE-01 no debe crear una fuente nueva —tendría su propia ruta y el
        historial del aparato quedaría partido en dos—.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO spatial.observation_sources "  # noqa: S608
                    "(tenant_id, warehouse_id, code, name, kind, clock_skew_ms, "
                    " created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :code, :name, "
                    "        :kind, :skew, core.current_user_id(), core.current_user_id()) "
                    "ON CONFLICT (tenant_id, warehouse_id, code) DO UPDATE SET "
                    "  name = EXCLUDED.name, "
                    "  kind = EXCLUDED.kind, "
                    "  clock_skew_ms = EXCLUDED.clock_skew_ms, "
                    "  is_active = true, "
                    "  deleted_at = NULL, "
                    "  updated_by = core.current_user_id() "
                    f"RETURNING {_SOURCE_COLS}"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "code": code,
                    "name": name,
                    "kind": kind,
                    "skew": clock_skew_ms,
                },
            )
        ).mappings().one()
        return dict(fila)

    # ── Ingesta ────────────────────────────────────────────────────────────
    async def insert_observations(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        source_id: UUID,
        items: Sequence[dict[str, Any]],
    ) -> int:
        """Inserta el lote y devuelve cuántas eran NUEVAS.

        `ON CONFLICT DO NOTHING` más `RETURNING`: el recuento de filas devueltas es
        el de las que entraron de verdad, así que reintentar un lote ya subido
        responde `0` en lugar de duplicarlo.
        """
        if not items:
            return 0
        res = await self._session.execute(
            text(
                "INSERT INTO spatial.rack_observations "
                "(tenant_id, warehouse_id, source_id, rack_node_id, observed_at, "
                " confidence, frame_ref, frame_ms, notes, created_by) "
                "SELECT CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:sid AS uuid), "
                "       CAST(t.node_id AS uuid), t.observed_at, t.confidence, "
                "       t.frame_ref, t.frame_ms, t.notes, core.current_user_id() "
                "FROM unnest("
                "       CAST(:node_ids AS text[]), "
                "       CAST(:momentos AS timestamptz[]), "
                "       CAST(:confianzas AS double precision[]), "
                "       CAST(:frames AS text[]), "
                "       CAST(:frame_ms AS integer[]), "
                "       CAST(:notas AS text[])"
                "     ) AS t(node_id, observed_at, confidence, frame_ref, frame_ms, notes) "
                "ON CONFLICT (source_id, rack_node_id, observed_at) DO NOTHING "
                "RETURNING id"
            ),
            {
                "tid": str(tenant_id),
                "wh": str(warehouse_id),
                "sid": str(source_id),
                "node_ids": [str(i["rack_node_id"]) for i in items],
                "momentos": [i["observed_at"] for i in items],
                "confianzas": [i.get("confidence") for i in items],
                "frames": [i.get("frame_ref") for i in items],
                "frame_ms": [i.get("frame_ms") for i in items],
                "notas": [i.get("notes") for i in items],
            },
        )
        return len(res.fetchall())

    # ── Lectura ────────────────────────────────────────────────────────────
    async def route(
        self,
        warehouse_id: UUID,
        *,
        source_id: UUID | None = None,
        desde: datetime | None = None,
        hasta: datetime | None = None,
        limite: int = 5000,
    ) -> list[dict[str, Any]]:
        """Los puntos de la ruta, en orden.

        El `WHERE` se compone de literales de este módulo, nunca de entrada del
        cliente: los valores viajan enlazados. `ORDER BY source_id, observed_at`
        agrupa cada recorrido consigo mismo; ordenar solo por tiempo intercalaría
        dos drones en la misma lista y el cliente tendría que separarlos.
        """
        clausulas = ["warehouse_id = CAST(:wh AS uuid)"]
        params: dict[str, Any] = {"wh": str(warehouse_id), "lim": limite}
        if source_id is not None:
            clausulas.append("source_id = CAST(:sid AS uuid)")
            params["sid"] = str(source_id)
        if desde is not None:
            clausulas.append("observed_at >= :desde")
            params["desde"] = desde
        if hasta is not None:
            clausulas.append("observed_at <= :hasta")
            params["hasta"] = hasta

        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_ROUTE_COLS} FROM spatial.v_observation_route "  # noqa: S608
                    f"WHERE {' AND '.join(clausulas)} "
                    "ORDER BY source_id, observed_at, observation_id "
                    "LIMIT :lim"
                ),
                params,
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def list_observations(
        self,
        warehouse_id: UUID,
        *,
        source_id: UUID | None = None,
        limite: int = 500,
    ) -> list[dict[str, Any]]:
        clausulas = ["warehouse_id = CAST(:wh AS uuid)"]
        params: dict[str, Any] = {"wh": str(warehouse_id), "lim": limite}
        if source_id is not None:
            clausulas.append("source_id = CAST(:sid AS uuid)")
            params["sid"] = str(source_id)
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_OBS_COLS} FROM spatial.v_rack_observations "  # noqa: S608
                    f"WHERE {' AND '.join(clausulas)} "
                    "ORDER BY observed_at DESC, observation_id "
                    "LIMIT :lim"
                ),
                params,
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def coverage(self, warehouse_id: UUID) -> dict[str, Any]:
        """Cuánto del almacén se ha visto, y cuándo.

        Una sola consulta con agregados: son las cifras de la cabecera del panel y
        pedirlas por separado serían cuatro viajes al pooler para pintar una línea.

        `sin_colocar` es la cifra incómoda y la que hay que dar: observaciones de
        racks que nadie ha situado en el plano. No salen en la ruta —no tienen
        punto— y sin este número desaparecerían sin dejar rastro.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*)                                   AS total, "
                    "       count(DISTINCT rack_node_id)               AS racks_vistos, "
                    "       count(DISTINCT source_id)                  AS fuentes, "
                    "       count(*) FILTER (WHERE NOT rack_colocado)  AS sin_colocar, "
                    "       min(observed_at)                           AS primera, "
                    "       max(observed_at)                           AS ultima "
                    "  FROM spatial.v_rack_observations "
                    " WHERE warehouse_id = CAST(:wh AS uuid)"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().one()
        return dict(fila)

    async def delete_source_observations(self, warehouse_id: UUID, source_id: UUID) -> int:
        """Borra las observaciones de una fuente. La fuente y los racks no se tocan."""
        res = await self._session.execute(
            text(
                "DELETE FROM spatial.rack_observations "
                " WHERE warehouse_id = CAST(:wh AS uuid) AND source_id = CAST(:sid AS uuid)"
            ),
            {"wh": str(warehouse_id), "sid": str(source_id)},
        )
        return res.rowcount or 0
