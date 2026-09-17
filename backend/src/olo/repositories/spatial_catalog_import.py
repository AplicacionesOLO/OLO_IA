"""Repositorio del importador del catálogo espacial, por API.

Mismas sentencias que `tools/import_spatial_catalog.py`, traducidas de `asyncpg`
a `AsyncSession` — el importador de terminal corre como `postgres`; este corre
como `olo_app`, con RLS activo, dentro de la transacción de la petición que abre
`tenant_session()`. No hay `async with conn.transaction()` propio: si algo falla
a mitad, la petición entera se revierte sola, incluida la fila de
`import_batches` que se hubiera insertado — igual que en el script, donde un
`SystemExit` a mitad deshace también el lote.

Como el resto de repositorios, no filtra por `tenant_id` en los SELECT: lo hace
RLS. Sí lo pasa en los INSERT porque las columnas son `NOT NULL` y la policy lo
comprueba con `WITH CHECK`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession


class SpatialCatalogImportRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def warehouse_by_id(self, warehouse_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, tenant_id, name FROM core.warehouses "
                    "WHERE id = CAST(:wh AS uuid) AND deleted_at IS NULL"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def capacity_ceiling(self, kind: str) -> int | None:
        fila = (
            await self._session.execute(
                text("SELECT core.capacity_ceiling(:kind) AS techo"), {"kind": kind}
            )
        ).first()
        return int(fila[0]) if fila and fila[0] is not None else None

    async def already_completed(self, tenant_id: UUID, warehouse_id: UUID, sha256: str) -> bool:
        n = (
            await self._session.execute(
                text(
                    "SELECT count(1) FROM spatial.import_batches "
                    "WHERE tenant_id = CAST(:tid AS uuid) AND warehouse_id = CAST(:wh AS uuid) "
                    "  AND file_sha256 = :sha AND status = 'completed'"
                ),
                {"tid": str(tenant_id), "wh": str(warehouse_id), "sha": sha256},
            )
        ).scalar_one()
        return bool(n)

    async def retire_previous_completed(
        self, tenant_id: UUID, warehouse_id: UUID, sha256: str
    ) -> None:
        """Marca el lote `completed` anterior con este mismo sha256 como `failed`.

        El índice único de lotes es PARCIAL sobre `completed`: un segundo lote
        completado con el mismo sha lo violaría. Solo se llama con `force=True`,
        para reejecutar los upserts sobre datos ya presentes.
        """
        await self._session.execute(
            text(
                "UPDATE spatial.import_batches SET status = 'failed', "
                "  finished_at = coalesce(finished_at, now()) "
                "WHERE tenant_id = CAST(:tid AS uuid) AND warehouse_id = CAST(:wh AS uuid) "
                "  AND file_sha256 = :sha AND status = 'completed'"
            ),
            {"tid": str(tenant_id), "wh": str(warehouse_id), "sha": sha256},
        )

    async def create_batch(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        source_name: str,
        sha256: str,
        rows_read: int,
        rows_rejected: int,
    ) -> UUID:
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO spatial.import_batches "
                    "(tenant_id, warehouse_id, source_name, file_sha256, rows_read, "
                    " rows_rejected, status) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :src, :sha, :read, "
                    "        :rej, 'running') "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id), "wh": str(warehouse_id), "src": source_name,
                    "sha": sha256, "read": rows_read, "rej": rows_rejected,
                },
            )
        ).scalar_one()
        return UUID(str(fila))

    async def insert_rejections(
        self, batch_id: UUID, tenant_id: UUID, rechazos: Sequence[dict[str, Any]]
    ) -> None:
        if not rechazos:
            return
        await self._session.execute(
            text(
                "INSERT INTO spatial.import_row_errors "
                "(batch_id, tenant_id, row_number, reason_code, field_name, raw_row) "
                "SELECT CAST(:bid AS uuid), CAST(:tid AS uuid), t.fila, t.motivo, t.campo, t.crudo "
                "FROM unnest(CAST(:filas AS int[]), CAST(:motivos AS text[]), "
                "            CAST(:campos AS text[]), CAST(:crudos AS text[])) "
                "       AS t(fila, motivo, campo, crudo)"
            ),
            {
                "bid": str(batch_id),
                "tid": str(tenant_id),
                "filas": [r["fila"] for r in rechazos],
                "motivos": [r["motivo"][:60] for r in rechazos],
                "campos": [r["campo"][:40] for r in rechazos],
                "crudos": [r["crudo"] for r in rechazos],
            },
        )

    async def upsert_site(self, tenant_id: UUID, warehouse_id: UUID, raw_source: str) -> UUID:
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO spatial.sites "
                    "(tenant_id, warehouse_id, name, code, is_validated, raw_source) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), "
                    "        'Sitio unico (sin validar)', 'DEFAULT', false, CAST(:src AS jsonb)) "
                    "ON CONFLICT (tenant_id, warehouse_id, code) WHERE deleted_at IS NULL "
                    "  DO UPDATE SET updated_at = now() "
                    "RETURNING id"
                ),
                {"tid": str(tenant_id), "wh": str(warehouse_id), "src": raw_source},
            )
        ).scalar_one()
        return UUID(str(fila))

    async def upsert_rack_nodes(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        site_id: UUID,
        codes: Sequence[str],
        externos: Sequence[str],
        indices: Sequence[int | None],
        preambulos: Sequence[str | None],
        storage_ids: Sequence[str | None],
        tipos_wms: Sequence[str | None],
        raw_sources: Sequence[str],
    ) -> None:
        """347 nodos principales · RAÍZ, sin pasillo — una sola sentencia de conjunto.

        La primera versión probada hacía un `fetchval` por nodo: 275 ms por fila
        contra el pooler de AWS, 14 minutos sin terminar 3.048 nodos. Con `unnest`
        son dos sentencias en total.
        """
        await self._session.execute(
            text(
                "INSERT INTO spatial.nodes "
                "(tenant_id, warehouse_id, site_id, parent_node_id, node_type, "
                " node_function, node_code, external_code, name, logical_index, "
                " external_site_code, external_storage_id, raw_source) "
                "SELECT CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:site AS uuid), NULL, "
                "       'rack', nf.code, t.code, t.externo, t.externo, t.indice, "
                "       t.preambulo, t.storage_id, CAST(t.crudo AS jsonb) "
                "  FROM unnest(CAST(:codes AS text[]), CAST(:externos AS text[]), "
                "              CAST(:indices AS int[]), CAST(:preambulos AS text[]), "
                "              CAST(:storage_ids AS text[]), CAST(:tipos AS text[]), "
                "              CAST(:crudos AS text[])) "
                "         AS t(code, externo, indice, preambulo, storage_id, tipo_wms, crudo) "
                "  LEFT JOIN spatial.node_functions nf ON nf.wms_type_code = t.tipo_wms "
                "ON CONFLICT (tenant_id, warehouse_id, node_code) WHERE deleted_at IS NULL "
                "DO UPDATE SET external_code = EXCLUDED.external_code, "
                "              logical_index = EXCLUDED.logical_index, "
                "              node_function = EXCLUDED.node_function, "
                "              raw_source = EXCLUDED.raw_source, updated_at = now()"
            ),
            {
                "tid": str(tenant_id), "wh": str(warehouse_id), "site": str(site_id),
                "codes": list(codes), "externos": list(externos), "indices": list(indices),
                "preambulos": list(preambulos), "storage_ids": list(storage_ids),
                "tipos": list(tipos_wms), "crudos": list(raw_sources),
            },
        )

    async def map_rack_nodes(self, warehouse_id: UUID) -> dict[str, str]:
        filas = (
            await self._session.execute(
                text(
                    "SELECT id, node_code FROM spatial.nodes "
                    "WHERE warehouse_id = CAST(:wh AS uuid) AND node_type = 'rack' "
                    "  AND deleted_at IS NULL"
                ),
                {"wh": str(warehouse_id)},
            )
        ).all()
        return {f[1]: str(f[0]) for f in filas}

    async def upsert_bay_nodes(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        site_id: UUID,
        refs: Sequence[str],
        cols: Sequence[int],
    ) -> None:
        """2.701 cuerpos · una sola sentencia, resolviendo el padre por JOIN."""
        await self._session.execute(
            text(
                "INSERT INTO spatial.nodes "
                "(tenant_id, warehouse_id, site_id, parent_node_id, node_type, "
                " node_code, name, logical_index) "
                "SELECT CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:site AS uuid), r.id, 'bay', "
                "       t.ref || '-C' || lpad(t.col::text, 3, '0'), "
                "       'Cuerpo C' || lpad(t.col::text, 3, '0') || ' de ' || t.ref, t.col "
                "  FROM unnest(CAST(:refs AS text[]), CAST(:cols AS int[])) AS t(ref, col) "
                "  JOIN spatial.nodes r ON r.warehouse_id = CAST(:wh AS uuid) "
                "                      AND r.node_code = t.ref "
                "                      AND r.node_type = 'rack' AND r.deleted_at IS NULL "
                "ON CONFLICT (tenant_id, warehouse_id, node_code) WHERE deleted_at IS NULL "
                "DO UPDATE SET logical_index = EXCLUDED.logical_index, updated_at = now()"
            ),
            {
                "tid": str(tenant_id), "wh": str(warehouse_id), "site": str(site_id),
                "refs": list(refs), "cols": list(cols),
            },
        )

    async def map_bay_nodes(self, warehouse_id: UUID) -> dict[tuple[str, int], str]:
        """Clave (id_del_padre, índice), no `node_code` partido: el código
        normalizado admite guiones, así que un `rsplit('-C')` sería frágil."""
        filas = (
            await self._session.execute(
                text(
                    "SELECT id, parent_node_id, logical_index FROM spatial.nodes "
                    "WHERE warehouse_id = CAST(:wh AS uuid) AND node_type = 'bay' "
                    "  AND deleted_at IS NULL"
                ),
                {"wh": str(warehouse_id)},
            )
        ).all()
        return {(str(f[1]), f[2]): str(f[0]) for f in filas}

    async def upsert_locations_batch(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        node_ids: Sequence[str],
        codes: Sequence[str],
        external_codes: Sequence[str | None],
        external_location_ids: Sequence[str | None],
        formas: Sequence[str],
        cols: Sequence[int],
        nivs: Sequence[int],
        poss: Sequence[int],
        lxs: Sequence[int | None],
        lys: Sequence[int | None],
        lzs: Sequence[int | None],
        pesos: Sequence[int | None],
        estados: Sequence[str],
        situaciones: Sequence[str | None],
        raw_sources: Sequence[str],
    ) -> None:
        """29.310 ubicaciones · inserción de conjunto, en lotes de la llamante.

        Un `executemany` de 29.310 filas sigue siendo 29.310 ejecuciones del plan.
        `unnest` de columnas paralelas lo convierte en una sentencia por lote.
        """
        await self._session.execute(
            text(
                "INSERT INTO spatial.locations "
                "(tenant_id, warehouse_id, node_id, code, external_code, "
                " external_location_id, type, code_form, logical_column, "
                " logical_level, logical_position, logical_x, logical_y, logical_z, "
                " max_weight_kg, status, location_situation, origin, raw_source) "
                "SELECT CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(u.node_id AS uuid), "
                "       u.code, u.ext_code, u.ext_id, 'rack', u.forma, "
                "       u.col, u.niv, u.pos, u.lx, u.ly, u.lz, u.peso, u.estado, "
                "       u.situacion, 'catalog', CAST(u.crudo AS jsonb) "
                "  FROM unnest(CAST(:node_ids AS uuid[]), CAST(:codes AS text[]), "
                "              CAST(:ext_codes AS text[]), CAST(:ext_ids AS text[]), "
                "              CAST(:formas AS text[]), CAST(:cols AS smallint[]), "
                "              CAST(:nivs AS smallint[]), CAST(:poss AS smallint[]), "
                "              CAST(:lxs AS int[]), CAST(:lys AS int[]), CAST(:lzs AS int[]), "
                "              CAST(:pesos AS numeric[]), CAST(:estados AS text[]), "
                "              CAST(:situaciones AS text[]), CAST(:crudos AS text[])) "
                "         AS u(node_id, code, ext_code, ext_id, forma, col, niv, pos, "
                "              lx, ly, lz, peso, estado, situacion, crudo) "
                "ON CONFLICT (tenant_id, warehouse_id, external_code) "
                "  WHERE external_code IS NOT NULL AND deleted_at IS NULL "
                "DO UPDATE SET status = EXCLUDED.status, "
                "              location_situation = EXCLUDED.location_situation, "
                "              max_weight_kg = EXCLUDED.max_weight_kg, "
                "              logical_x = EXCLUDED.logical_x, "
                "              logical_y = EXCLUDED.logical_y, "
                "              logical_z = EXCLUDED.logical_z, "
                "              raw_source = EXCLUDED.raw_source, "
                "              updated_at = now()"
            ),
            {
                "tid": str(tenant_id), "wh": str(warehouse_id),
                "node_ids": list(node_ids), "codes": list(codes),
                "ext_codes": list(external_codes), "ext_ids": list(external_location_ids),
                "formas": list(formas), "cols": list(cols), "nivs": list(nivs),
                "poss": list(poss), "lxs": list(lxs), "lys": list(lys), "lzs": list(lzs),
                "pesos": list(pesos), "estados": list(estados),
                "situaciones": list(situaciones), "crudos": list(raw_sources),
            },
        )

    async def complete_batch(
        self, batch_id: UUID, *, nodes_created: int, bays_created: int, locations_created: int
    ) -> None:
        await self._session.execute(
            text(
                "UPDATE spatial.import_batches SET status = 'completed', "
                "  finished_at = now(), nodes_created = :nodes, bays_created = :bays, "
                "  locations_created = :locs "
                "WHERE id = CAST(:bid AS uuid)"
            ),
            {
                "bid": str(batch_id), "nodes": nodes_created, "bays": bays_created,
                "locs": locations_created,
            },
        )

    async def verify_counts(self, warehouse_id: UUID) -> dict[str, int]:
        """Misma verificación DENTRO de la transacción que hace el script de terminal."""
        fila = (
            await self._session.execute(
                text(
                    "SELECT "
                    "  (SELECT count(1) FROM spatial.nodes "
                    "     WHERE warehouse_id = CAST(:wh AS uuid) "
                    "     AND node_type = 'rack' AND deleted_at IS NULL) AS n_rack, "
                    "  (SELECT count(1) FROM spatial.nodes "
                    "     WHERE warehouse_id = CAST(:wh AS uuid) "
                    "     AND node_type = 'bay' AND deleted_at IS NULL) AS n_bay, "
                    "  (SELECT count(1) FROM spatial.locations "
                    "     WHERE warehouse_id = CAST(:wh AS uuid) "
                    "     AND deleted_at IS NULL) AS n_loc, "
                    "  (SELECT count(1) FROM spatial.locations "
                    "     WHERE warehouse_id = CAST(:wh AS uuid) AND (world_position IS NOT NULL "
                    "     OR world_frame_id IS NOT NULL)) AS n_world, "
                    "  (SELECT count(1) FROM spatial.nodes "
                    "     WHERE warehouse_id = CAST(:wh AS uuid) "
                    "     AND node_type = 'aisle') AS n_aisle"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().one()
        return dict(fila)

    async def list_batches(self, warehouse_id: UUID, limit: int) -> list[dict[str, Any]]:
        """Los últimos lotes de este almacén, del más al menos reciente.

        Sin cursor: es el historial de una operación rara —importar el catálogo
        entero—, no una tabla que crezca sin límite por almacén.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT id, source_name, file_sha256, status, rows_read, rows_rejected, "
                    "       nodes_created, bays_created, locations_created, "
                    "       started_at, finished_at "
                    "FROM spatial.import_batches "
                    "WHERE warehouse_id = CAST(:wh AS uuid) "
                    "ORDER BY started_at DESC LIMIT :n"
                ),
                {"wh": str(warehouse_id), "n": limit},
            )
        ).mappings().all()
        return [dict(f) for f in filas]
