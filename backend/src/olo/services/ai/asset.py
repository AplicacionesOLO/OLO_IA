"""Servicio de assets e imagenes.

Flujo de subida en tres pasos, porque el binario no pasa por el backend:

  1. POST .../assets/prepare  -> el backend valida MIME y tamaño, genera la ruta
                                 canonica y devuelve el endpoint de Storage
  2. el CLIENTE sube el binario a Storage con su propio JWT
  3. POST .../assets/confirm  -> el backend comprueba que el objeto existe y crea
                                 la fila de `ai.assets` (+ `ai.images` si aplica)

HUERFANOS. El patron tiene dos ventanas, ambas conocidas y ninguna compensada
todavia (DEUDA TECNICA: barrido periodico):

  · subido y nunca confirmado — el objeto existe y no hay fila. Se detecta
    comparando `storage.objects` con `ai.assets`.
  · confirmado y el binario no se pudo borrar — hay fila retirada y objeto vivo.
    NO se oculta: `delete_asset` devuelve `storage_deleted: false` y la ruta.

Se prefiere el huerfano al inverso: un objeto sin fila se localiza y se borra, una
fila que apunta a un binario inexistente rompe cada lectura.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy.exc import DBAPIError

from olo.core.errors import (
    BusinessRuleError,
    ConflictError,
    NotFoundError,
    VersionConflictError,
)
from olo.core.logging import get_logger
from olo.domain.ai.asset import (
    BUCKET,
    AiAsset,
    AiImage,
    AssetKind,
    ImageStatus,
    ruta_canonica,
    validar_subida,
)
from olo.domain.warehouse import DomainRuleError
from olo.repositories.ai import ProjectRepository
from olo.repositories.ai.asset import AssetRepository, ImageRepository
from olo.services.ai.errors import translate_pg_error
from olo.services.ai.project import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    Page,
    decode_cursor,
    encode_cursor,
)
from olo.storage import StorageClient

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings

_log = get_logger(__name__)

_SHA256_LEN = 64


class AiAssetService:
    def __init__(
        self, session: AsyncSession, settings: Settings, access_token: str
    ) -> None:
        self._assets = AssetRepository(session)
        self._images = ImageRepository(session)
        self._proyectos = ProjectRepository(session)
        self._storage = StorageClient(settings, access_token)

    async def prepare_upload(
        self,
        project_id: UUID,
        kind: AssetKind,
        content_type: str,
        bytes_: int,
        original_filename: str,
    ) -> dict[str, Any]:
        await self._require_project(project_id)
        try:
            validar_subida(kind, content_type, bytes_)
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        asset_id = uuid4()
        path = ruta_canonica(project_id, asset_id, kind, content_type, original_filename)
        return {
            "asset_id": asset_id,
            "bucket": BUCKET,
            "object_path": path,
            "upload_url": self._storage.upload_endpoint(BUCKET, path),
        }

    async def confirm_upload(
        self, project_id: UUID, datos: dict[str, Any], *, created_by: UUID
    ) -> AiAsset:
        await self._require_project(project_id)

        kind = AssetKind(datos["kind"])
        try:
            validar_subida(kind, datos["content_type"], datos["bytes"])
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        sha = str(datos["sha256"]).lower()
        if len(sha) != _SHA256_LEN:
            raise BusinessRuleError("sha256 debe tener 64 caracteres hexadecimales")

        asset_id = UUID(str(datos["asset_id"]))

        # Confirmar dos veces el mismo asset_id se detecta ANTES del INSERT. La PK
        # tambien lo impediria, pero como violacion de constraint sin traduccion
        # saldria como 500, y un reintento del cliente —doble click, reintento de
        # red— es una situacion normal que merece un 409 que la nombre.
        #
        # Se pregunta por el id INCLUYENDO los retirados: la PK no distingue.
        if await self._assets.id_en_uso(asset_id):
            raise ConflictError(
                "Ese asset ya estaba confirmado. No hace falta repetir la subida.",
                resource_id=str(asset_id),
            )

        # La ruta la recalcula el servidor a partir del asset_id que devolvio
        # `prepare`: `object_path` NO se acepta del cliente en ningun paso, asi que
        # no hay forma de reclamar un objeto que este en otra ruta del bucket.
        path = ruta_canonica(
            project_id, asset_id, kind, datos["content_type"], datos["original_filename"]
        )

        if await self._storage.head(BUCKET, path) is None:
            # Dos causas posibles y ambas importan: el binario no se subio, o se
            # subio con un `original_filename` o `content_type` distintos a los de
            # `prepare` y por tanto esta en otra ruta.
            raise BusinessRuleError(
                "El objeto no existe en Storage. Sube el archivo antes de confirmar y "
                "envia el mismo nombre y tipo que usaste en `prepare`: la ruta se "
                "deriva de ellos."
            )

        if kind in (AssetKind.IMAGE, AssetKind.FRAME):
            duplicado = await self._assets.by_sha256(project_id, sha)
            if duplicado is not None:
                raise ConflictError(
                    "Ese archivo ya existe en el proyecto. Subirlo dos veces produciria "
                    "fuga entre los conjuntos de entrenamiento y validacion.",
                    resource_id=str(duplicado.id),
                )

        try:
            asset = await self._assets.create(
                {
                    "id": str(asset_id),
                    "project_id": str(project_id),
                    "kind": kind.value,
                    "bucket": BUCKET,
                    "object_path": path,
                    "original_filename": datos["original_filename"],
                    "content_type": datos["content_type"],
                    "bytes": datos["bytes"],
                    "sha256": sha,
                    "width": datos.get("width"),
                    "height": datos.get("height"),
                    "duration_ms": datos.get("duration_ms"),
                },
                created_by=created_by,
            )
            # Una imagen subida es material anotable: se registra ya para que aparezca
            # en el dataset sin un paso adicional.
            if kind is AssetKind.IMAGE:
                await self._images.create(project_id, asset.id, created_by=created_by)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

        return asset

    async def list_images(
        self,
        project_id: UUID,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
        status: ImageStatus | None = None,
    ) -> Page:
        await self._require_project(project_id)
        limit = min(max(limit, 1), MAX_PAGE_SIZE)
        clave = decode_cursor(cursor) if cursor else None
        filas = await self._images.list_page(
            project_id=project_id, limit=limit, cursor=clave, status=status
        )
        hay_mas = len(filas) > limit
        items = list(filas[:limit])
        siguiente = (
            encode_cursor(items[-1].created_at.isoformat(), items[-1].id)
            if hay_mas and items
            else None
        )
        return Page(items=items, next_cursor=siguiente)

    async def image_counts(self, project_id: UUID) -> dict[str, int]:
        await self._require_project(project_id)
        return await self._images.count_for_project(project_id)

    async def signed_url(self, asset_id: UUID, *, expires_in: int) -> str:
        asset = await self._assets.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset no encontrado", resource_id=str(asset_id))

        # La firma se emite sobre `object_path`, que viene de la fila. Si esa ruta no
        # empezara por el project_id del propio asset se estaria firmando el objeto
        # de OTRO proyecto, y la firma es una URL que funciona sin sesion.
        # `ruta_canonica` lo garantiza al crear, pero quien firma no puede fiarse de
        # eso: la comprobacion cuesta una comparacion de prefijo.
        if not asset.object_path.startswith(f"{asset.project_id}/"):
            _log.error(
                "asset con object_path fuera del prefijo de su proyecto",
                extra={"asset_id": str(asset.id), "project_id": str(asset.project_id)},
            )
            raise BusinessRuleError(
                "La ruta almacenada de este asset no corresponde a su proyecto. "
                "No se emite firma."
            )

        return await self._storage.sign_download(
            asset.bucket, asset.object_path, expires_in
        )

    async def set_image_status(
        self,
        image_id: UUID,
        status: ImageStatus,
        *,
        expected_version: int,
        updated_by: UUID,
    ) -> AiImage:
        actualizada = await self._images.update_status(
            image_id, status, expected_version=expected_version, updated_by=updated_by
        )
        if actualizada is None:
            actual = await self._images.get_by_id(image_id)
            if actual is None:
                raise NotFoundError("Imagen no encontrada", resource_id=str(image_id))
            raise VersionConflictError(
                "La imagen fue modificada por otra operacion. Vuelve a leerla.",
                resource_id=str(image_id),
                expected_version=expected_version,
                current_version=actual.version,
            )
        return actualizada

    async def delete_asset(
        self, asset_id: UUID, *, expected_version: int
    ) -> dict[str, Any]:
        """Retira el asset, su imagen y el binario. Devuelve que paso con el binario.

        `expected_version` es la version del ASSET, no la de `ai.images`: son dos
        filas con contadores independientes y cambiar el estado de una imagen no
        toca el asset.
        """
        asset = await self._assets.get_by_id(asset_id)
        if asset is None:
            raise NotFoundError("Asset no encontrado", resource_id=str(asset_id))

        # Una imagen anotada representa trabajo humano que el borrado del binario
        # dejaria sin sujeto: las cajas quedarian describiendo un archivo que ya no
        # se puede mirar. Se exige retirar las anotaciones primero, de forma
        # explicita, o archivar la imagen en su lugar.
        imagen = await self._images.by_asset_id(asset_id)
        if imagen is not None and (imagen.annotation_count or 0) > 0:
            raise ConflictError(
                f"La imagen tiene {imagen.annotation_count} anotacion(es). Borralas "
                "primero o marca la imagen como `archived` en vez de eliminarla.",
                resource_id=str(imagen.id),
            )

        # Orden: imagen, asset, binario.
        #
        # La imagen antes que el asset porque `fk_img_asset` va de imagen a asset:
        # dejar la imagen viva apuntando a un asset retirado la haria invisible en
        # el listado —que ya filtra por `a.deleted_at IS NULL`— sin que nada
        # explicara por que.
        #
        # El binario al final porque el metadato es lo reversible: un objeto
        # huerfano en Storage se localiza y se borra despues, mientras que una fila
        # que apunta a un binario inexistente rompe cada lectura.
        try:
            if imagen is not None:
                await self._images.soft_delete_by_id(
                    imagen.id, expected_version=imagen.version
                )
            await self._assets.soft_delete_by_id(asset_id, expected_version=expected_version)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

        # Si Storage falla NO se levanta la excepcion: eso revertiria el borrado del
        # metadato y dejaria al usuario sin saber si borro algo. Se informa en la
        # respuesta —`storage_deleted: false`— y se registra la ruta huerfana.
        borrado = await self._storage.delete(asset.bucket, [asset.object_path])
        if not borrado:
            _log.error(
                "binario huerfano en storage",
                extra={
                    "bucket": asset.bucket,
                    "object_path": asset.object_path,
                    "asset_id": str(asset_id),
                },
            )

        return {
            "asset_id": asset_id,
            "storage_deleted": borrado,
            "orphaned_object_path": None if borrado else asset.object_path,
            "image_deleted": imagen is not None,
        }

    async def _require_project(self, project_id: UUID) -> None:
        if not await self._proyectos.exists(project_id):
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))

    @staticmethod
    def kinds() -> Sequence[str]:
        return [k.value for k in AssetKind]
