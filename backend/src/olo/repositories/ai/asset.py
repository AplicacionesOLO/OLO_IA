"""Repositorios de assets e imagenes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from olo.db.repository import BaseRepository
from olo.domain.ai.asset import AiAsset, AiImage, AssetKind, ImageStatus

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from sqlalchemy import RowMapping

_ASSET_COLS = (
    "id, project_id, kind, bucket, object_path, original_filename, content_type, "
    "bytes, sha256, width, height, duration_ms, uploaded_at, "
    "created_at, created_by, updated_at, updated_by, version, deleted_at"
)


class AssetRepository(BaseRepository[AiAsset]):
    schema = "ai"
    table = "assets"
    soft_delete = True

    def _to_entity(self, row: RowMapping) -> AiAsset:
        return AiAsset(
            id=row["id"],
            project_id=row["project_id"],
            kind=AssetKind(row["kind"]),
            bucket=row["bucket"],
            object_path=row["object_path"],
            original_filename=row["original_filename"],
            content_type=row["content_type"],
            bytes=row["bytes"],
            sha256=row["sha256"],
            width=row["width"],
            height=row["height"],
            duration_ms=row["duration_ms"],
            uploaded_at=row["uploaded_at"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
        )

    async def create(self, datos: dict[str, Any], *, created_by: UUID) -> AiAsset:
        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(id, project_id, kind, bucket, object_path, original_filename, "
            " content_type, bytes, sha256, width, height, duration_ms, created_by) "
            "VALUES (CAST(:id AS uuid), CAST(:project_id AS uuid), :kind, :bucket, "
            "        :object_path, :original_filename, :content_type, :bytes, :sha256, "
            "        :width, :height, :duration_ms, CAST(:created_by AS uuid)) "
            f"RETURNING {_ASSET_COLS}"
        )
        row = (
            await self._session.execute(
                stmt, {**datos, "created_by": str(created_by)}
            )
        ).mappings().one()
        return self._to_entity(row)

    async def registrar_objeto_existente(
        self, datos: dict[str, Any], *, created_by: UUID
    ) -> AiAsset:
        """Registra como asset del proyecto un objeto que YA esta en Storage.

        ── PARA QUE HACE FALTA ───────────────────────────────────────────────────

        Un fotograma sacado de una inspeccion tiene que decir de que video salio:
        `chk_img_frame_coherente` exige que `source='frame'` traiga
        `source_video_asset_id`, y `fk_img_video` exige que ese asset sea del MISMO
        proyecto. El video de inspeccion, en cambio, vive en `perception.media` y en el
        bucket `perception-media`, que es otro mundo.

        Asi que se registra una fila de asset que apunta al MISMO objeto, sin copiar un
        solo byte: `ai.assets.bucket` es una columna, no una constante, y la exportacion
        del dataset ya elige el bucket por fila.

        ── ES IDEMPOTENTE A PROPOSITO ────────────────────────────────────────────

        `uq_asset_objeto (bucket, object_path)` dice que un objeto se registra una vez.
        Mandar fotogramas del mismo video dos veces es lo NORMAL —se eligen unos hoy y
        otros mañana—, y hacerlo fallar la segunda vez seria tratar el caso corriente
        como un error. Con `ON CONFLICT` la segunda llamada devuelve el asset de la
        primera.

        El `DO NOTHING` no devuelve fila, y por eso hace falta el `SELECT` de despues:
        no es un descuido.
        """
        params = {**datos, "created_by": str(created_by)}
        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(project_id, kind, bucket, object_path, original_filename, "
            " content_type, bytes, sha256, width, height, duration_ms, created_by) "
            "VALUES (CAST(:project_id AS uuid), :kind, :bucket, :object_path, "
            "        :original_filename, :content_type, :bytes, :sha256, "
            "        :width, :height, :duration_ms, CAST(:created_by AS uuid)) "
            "ON CONFLICT (bucket, object_path) DO NOTHING "
            f"RETURNING {_ASSET_COLS}"
        )
        row = (await self._session.execute(stmt, params)).mappings().first()
        if row is not None:
            return self._to_entity(row)

        existente = text(
            f"SELECT {_ASSET_COLS} FROM {self.qualified_name} "  # noqa: S608
            "WHERE bucket = :bucket AND object_path = :object_path"
        )
        fila = (
            await self._session.execute(
                existente,
                {"bucket": datos["bucket"], "object_path": datos["object_path"]},
            )
        ).mappings().one()
        return self._to_entity(fila)

    async def id_en_uso(self, asset_id: UUID) -> bool:
        """Si el id existe, INCLUSO retirado.

        `get_by_id` filtra `deleted_at IS NULL`, asi que un reintento de `confirm`
        sobre un asset ya borrado lo veria como libre y chocaria contra la PK — un
        500 en lugar de un 409. La PK no distingue vivos de retirados.
        """
        stmt = text(
            f"SELECT 1 FROM {self.qualified_name} WHERE id = CAST(:id AS uuid)"  # noqa: S608
        )
        return (
            await self._session.execute(stmt, {"id": str(asset_id)})
        ).first() is not None

    async def by_sha256(self, project_id: UUID, sha256: str) -> AiAsset | None:
        stmt = text(
            f"SELECT {_ASSET_COLS} FROM {self.qualified_name} "  # noqa: S608
            "WHERE project_id = CAST(:pid AS uuid) AND sha256 = :sha "
            "  AND kind IN ('image','frame') AND deleted_at IS NULL"
        )
        row = (
            await self._session.execute(stmt, {"pid": str(project_id), "sha": sha256})
        ).mappings().first()
        return self._to_entity(row) if row else None


class ImageRepository(BaseRepository[AiImage]):
    schema = "ai"
    table = "images"
    soft_delete = True

    def _to_entity(self, row: RowMapping) -> AiImage:
        return AiImage(
            id=row["id"],
            project_id=row["project_id"],
            asset_id=row["asset_id"],
            source=row["source"],
            status=ImageStatus(row["status"]),
            frame_index=row["frame_index"],
            frame_timestamp_ms=row["frame_timestamp_ms"],
            source_video_asset_id=row["source_video_asset_id"],
            annotated_at=row["annotated_at"],
            reviewed_at=row["reviewed_at"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
            object_path=row.get("object_path"),
            content_type=row.get("content_type"),
            bytes=row.get("bytes"),
            width=row.get("width"),
            height=row.get("height"),
            original_filename=row.get("original_filename"),
            annotation_count=row.get("annotation_count"),
            asset_version=row.get("asset_version"),
        )

    async def create(
        self,
        project_id: UUID,
        asset_id: UUID,
        *,
        created_by: UUID,
        source: str = "upload",
        frame_index: int | None = None,
        frame_timestamp_ms: int | None = None,
        source_video_asset_id: UUID | str | None = None,
    ) -> AiImage:
        """Registra una imagen anotable del proyecto.

        ── LA PROCEDENCIA NO ES DECORATIVA ───────────────────────────────────────

        `source` distingue una foto SUBIDA de un FOTOGRAMA sacado de un vídeo de
        inspección, y el esquema lo contempla desde 0028 (`chk_img_source`). La
        diferencia importa al mirar el dataset: 40 fotogramas del mismo vuelo son 40
        vistas de la misma estantería con la misma luz, y eso no vale lo mismo que 40
        fotos distintas aunque el recuento diga 40.

        `frame_timestamp_ms` es lo que permite volver al vídeo y ver de dónde salió cada
        imagen. Sin él, una imagen `frame` es una foto suelta de origen desconocido.

        Y los tres van juntos por obligación del esquema, no por estilo:
        `chk_img_frame_coherente` exige que `source='frame'` traiga `frame_index`,
        `frame_timestamp_ms` Y `source_video_asset_id`, los tres o ninguno. Mandar un
        fotograma sin el vídeo daba un 422 sin explicación.
        """
        stmt = text(
            f"INSERT INTO {self.qualified_name} "  # noqa: S608
            "(project_id, asset_id, source, frame_index, frame_timestamp_ms, "
            " source_video_asset_id, created_by) "
            "VALUES (CAST(:pid AS uuid), CAST(:aid AS uuid), :src, :fi, :fts, "
            "        CAST(:vid AS uuid), CAST(:u AS uuid)) "
            "RETURNING id, project_id, asset_id, source, status, frame_index, "
            "          frame_timestamp_ms, source_video_asset_id, annotated_at, "
            "          reviewed_at, created_at, created_by, updated_at, updated_by, "
            "          version, deleted_at"
        )
        row = (
            await self._session.execute(
                stmt,
                {
                    "pid": str(project_id),
                    "aid": str(asset_id),
                    "u": str(created_by),
                    "src": source,
                    "fi": frame_index,
                    "fts": frame_timestamp_ms,
                    "vid": str(source_video_asset_id) if source_video_asset_id else None,
                },
            )
        ).mappings().one()
        return self._to_entity(row)

    async def by_asset_id(self, asset_id: UUID) -> AiImage | None:
        """La imagen ligada a un asset, con su recuento de anotaciones.

        `ai.images.asset_id` es UNIQUE (0028), asi que hay 0 o 1. El recuento lo
        necesita el borrado: un asset con anotaciones no se puede retirar sin
        destruir trabajo de etiquetado.
        """
        stmt = text(
            "SELECT i.id, i.project_id, i.asset_id, i.source, i.status, i.frame_index, "
            "       i.frame_timestamp_ms, i.source_video_asset_id, i.annotated_at, "
            "       i.reviewed_at, i.created_at, i.created_by, i.updated_at, "
            "       i.updated_by, i.version, i.deleted_at, "
            "       (SELECT count(1) FROM ai.annotations an "
            "         WHERE an.image_id = i.id AND an.deleted_at IS NULL) AS annotation_count "
            "FROM ai.images i "
            "WHERE i.asset_id = CAST(:aid AS uuid) AND i.deleted_at IS NULL"
        )
        row = (
            await self._session.execute(stmt, {"aid": str(asset_id)})
        ).mappings().first()
        return self._to_entity(row) if row else None

    async def list_page(
        self,
        *,
        project_id: UUID,
        limit: int,
        cursor: tuple[str, UUID] | None = None,
        status: ImageStatus | None = None,
    ) -> Sequence[AiImage]:
        # `a.deleted_at IS NULL` es imprescindible: sin el, un asset retirado
        # seguiria apareciendo en la rejilla con su binario ya borrado, y la unica
        # senal seria una miniatura roto.
        condiciones = [
            "i.project_id = CAST(:pid AS uuid)",
            "i.deleted_at IS NULL",
            "a.deleted_at IS NULL",
        ]
        params: dict[str, Any] = {"pid": str(project_id), "limit": limit + 1}

        if cursor is not None:
            condiciones.append(
                "(i.created_at, i.id) < (CAST(:cur_at AS timestamptz), CAST(:cur_id AS uuid))"
            )
            params["cur_at"], params["cur_id"] = cursor[0], str(cursor[1])

        if status is not None:
            condiciones.append("i.status = :status")
            params["status"] = status.value

        # Mas recientes primero: es el orden en que se anota.
        stmt = text(
            "SELECT i.id, i.project_id, i.asset_id, i.source, i.status, i.frame_index, "  # noqa: S608
            "       i.frame_timestamp_ms, i.source_video_asset_id, i.annotated_at, "
            "       i.reviewed_at, i.created_at, i.created_by, i.updated_at, "
            "       i.updated_by, i.version, i.deleted_at, "
            "       a.object_path, a.content_type, a.bytes, a.width, a.height, "
            "       a.original_filename, a.version AS asset_version, "
            "       (SELECT count(1) FROM ai.annotations an "
            "         WHERE an.image_id = i.id AND an.deleted_at IS NULL) AS annotation_count "
            "FROM ai.images i JOIN ai.assets a ON a.id = i.asset_id "
            f"WHERE {' AND '.join(condiciones)} "
            "ORDER BY i.created_at DESC, i.id DESC LIMIT :limit"
        )
        rows = (await self._session.execute(stmt, params)).mappings().all()
        return [self._to_entity(r) for r in rows]

    async def count_for_project(self, project_id: UUID) -> dict[str, int]:
        stmt = text(
            "SELECT status, count(1) AS n FROM ai.images "
            "WHERE project_id = CAST(:pid AS uuid) AND deleted_at IS NULL "
            "GROUP BY status"
        )
        rows = (await self._session.execute(stmt, {"pid": str(project_id)})).mappings().all()
        return {r["status"]: r["n"] for r in rows}

    async def update_status(
        self, image_id: UUID, status: ImageStatus, *, expected_version: int, updated_by: UUID
    ) -> AiImage | None:
        stmt = text(
            f"UPDATE {self.qualified_name} SET status = :status, "  # noqa: S608
            "version = version + 1, updated_at = now(), "
            "updated_by = CAST(:u AS uuid) "
            "WHERE id = CAST(:id AS uuid) AND version = :expected AND deleted_at IS NULL "
            "RETURNING id, project_id, asset_id, source, status, frame_index, "
            "          frame_timestamp_ms, source_video_asset_id, annotated_at, "
            "          reviewed_at, created_at, created_by, updated_at, updated_by, "
            "          version, deleted_at"
        )
        row = (
            await self._session.execute(
                stmt,
                {
                    "id": str(image_id),
                    "status": status.value,
                    "expected": expected_version,
                    "u": str(updated_by),
                },
            )
        ).mappings().first()
        return self._to_entity(row) if row else None
