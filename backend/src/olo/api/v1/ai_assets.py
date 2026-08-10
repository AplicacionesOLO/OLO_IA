"""Assets e imagenes: subida en tres pasos, listado y borrado."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status

from olo.api.deps import (
    AccessToken,
    AppSettings,
    Db,
    PlatformOwnerRequired,
    require,
)
from olo.api.v1.ai_schemas import (
    AiAssetOut,
    AiImageOut,
    AssetDeleteOut,
    ImageStatusIn,
    LinkInspectionVideoIn,
    SignedUrlOut,
    UploadConfirmIn,
    UploadPrepareIn,
    UploadPrepareOut,
)
from olo.api.v1.schemas import Envelope, PagedEnvelope, PageMeta
from olo.api.v1.warehouses import _etag, _parse_if_match
from olo.domain.ai.asset import AssetKind, ImageStatus
from olo.repositories import identity
from olo.services.ai.asset import AiAssetService
from olo.services.ai.project import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/ai", tags=["ai-assets"])

_SIGNED_URL_TTL = 900


@router.post(
    "/projects/{project_id}/assets/prepare",
    response_model=Envelope[UploadPrepareOut],
    dependencies=[PlatformOwnerRequired, require("datasets:write")],
    summary="Paso 1: reservar ruta y validar MIME y tamaño",
)
async def prepare_upload(
    db: Db,
    settings: AppSettings,
    token: AccessToken,
    project_id: UUID,
    payload: UploadPrepareIn,
) -> Envelope[UploadPrepareOut]:
    """Devuelve la ruta canonica y el endpoint de Storage.

    El binario NO pasa por el backend: el cliente sube directo con su propio JWT y
    las politicas RLS del bucket lo autorizan.
    """
    datos = await AiAssetService(db, settings, token).prepare_upload(
        project_id,
        AssetKind(payload.kind),
        payload.content_type,
        payload.bytes,
        payload.original_filename,
    )
    return Envelope[UploadPrepareOut](data=UploadPrepareOut.model_validate(datos))


@router.post(
    "/projects/{project_id}/assets/confirm",
    response_model=Envelope[AiAssetOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[PlatformOwnerRequired, require("datasets:write")],
    summary="Paso 3: registrar el asset ya subido",
)
async def confirm_upload(
    db: Db,
    settings: AppSettings,
    token: AccessToken,
    project_id: UUID,
    payload: UploadConfirmIn,
    response: Response,
) -> Envelope[AiAssetOut]:
    user_id = await identity.fetch_current_user_id(db)
    asset = await AiAssetService(db, settings, token).confirm_upload(
        project_id, payload.model_dump(), created_by=user_id
    )
    response.headers["ETag"] = _etag(asset.version)
    return Envelope[AiAssetOut](data=AiAssetOut.model_validate(asset, from_attributes=True))


@router.post(
    "/projects/{project_id}/assets/link-inspection-video",
    response_model=Envelope[AiAssetOut],
    dependencies=[PlatformOwnerRequired, require("datasets:write")],
    summary="Registrar el video de una inspeccion como material del proyecto",
)
async def link_inspection_video(
    db: Db,
    settings: AppSettings,
    token: AccessToken,
    project_id: UUID,
    payload: LinkInspectionVideoIn,
) -> Envelope[AiAssetOut]:
    """Devuelve el asset del video, creandolo si no estaba.

    Es el paso previo a mandar fotogramas a anotar: una imagen con `source='frame'` tiene
    que decir de que video salio, y ese video tiene que ser un asset del mismo proyecto.
    No copia bytes —la fila apunta al objeto que ya esta en `perception-media`— y llamarlo
    dos veces devuelve el mismo asset.

    Devuelve 200 y no 201 justamente porque la segunda llamada no crea nada.
    """
    user_id = await identity.fetch_current_user_id(db)
    asset = await AiAssetService(db, settings, token).vincular_video_de_inspeccion(
        project_id, payload.job_id, created_by=user_id
    )
    return Envelope[AiAssetOut](data=AiAssetOut.model_validate(asset, from_attributes=True))


@router.get(
    "/projects/{project_id}/images",
    response_model=PagedEnvelope[AiImageOut],
    dependencies=[PlatformOwnerRequired, require("datasets:read")],
    summary="Imagenes del proyecto",
)
async def list_images(
    db: Db,
    settings: AppSettings,
    token: AccessToken,
    project_id: UUID,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query()] = None,
    status_filter: Annotated[ImageStatus | None, Query(alias="status")] = None,
) -> PagedEnvelope[AiImageOut]:
    page = await AiAssetService(db, settings, token).list_images(
        project_id, limit=limit, cursor=cursor, status=status_filter
    )
    return PagedEnvelope[AiImageOut](
        data=[AiImageOut.model_validate(i, from_attributes=True) for i in page.items],
        pagination=PageMeta(next_cursor=page.next_cursor, page_size=limit),
    )


@router.get(
    "/projects/{project_id}/images/counts",
    response_model=Envelope[dict[str, int]],
    dependencies=[PlatformOwnerRequired, require("datasets:read")],
    summary="Recuento de imagenes por estado",
)
async def image_counts(
    db: Db, settings: AppSettings, token: AccessToken, project_id: UUID
) -> Envelope[dict[str, int]]:
    return Envelope[dict[str, int]](
        data=await AiAssetService(db, settings, token).image_counts(project_id)
    )


@router.get(
    "/assets/{asset_id}/url",
    response_model=Envelope[SignedUrlOut],
    dependencies=[PlatformOwnerRequired, require("datasets:read")],
    summary="URL firmada de vida corta",
)
async def signed_url(
    db: Db, settings: AppSettings, token: AccessToken, asset_id: UUID
) -> Envelope[SignedUrlOut]:
    """Los buckets son privados: sin firma no hay lectura.

    El TTL se pasa a Storage y se devuelve en el mismo numero: si divergieran, el
    cliente cachearia la URL mas alla de su validez y las imagenes empezarian a
    fallar sin motivo visible.
    """
    url = await AiAssetService(db, settings, token).signed_url(
        asset_id, expires_in=_SIGNED_URL_TTL
    )
    return Envelope[SignedUrlOut](
        data=SignedUrlOut(url=url, expires_in=_SIGNED_URL_TTL)
    )


@router.patch(
    "/images/{image_id}/status",
    response_model=Envelope[AiImageOut],
    dependencies=[PlatformOwnerRequired, require("annotations:validate")],
    summary="Cambiar el estado de una imagen",
)
async def set_image_status(
    db: Db,
    settings: AppSettings,
    token: AccessToken,
    image_id: UUID,
    payload: ImageStatusIn,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Envelope[AiImageOut]:
    esperada = _parse_if_match(if_match)
    user_id = await identity.fetch_current_user_id(db)
    imagen = await AiAssetService(db, settings, token).set_image_status(
        image_id, ImageStatus(payload.status), expected_version=esperada, updated_by=user_id
    )
    response.headers["ETag"] = _etag(imagen.version)
    return Envelope[AiImageOut](data=AiImageOut.model_validate(imagen, from_attributes=True))


@router.delete(
    "/assets/{asset_id}",
    response_model=Envelope[AssetDeleteOut],
    dependencies=[PlatformOwnerRequired, require("datasets:write")],
    summary="Borrar un asset, su imagen y su binario",
)
async def delete_asset(
    db: Db,
    settings: AppSettings,
    token: AccessToken,
    asset_id: UUID,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Envelope[AssetDeleteOut]:
    """`If-Match` lleva la version del ASSET, no la de la imagen.

    Son dos filas con contadores independientes: cambiar el estado de una imagen
    incrementa `ai.images.version` y no toca `ai.assets.version`. Enviar la de la
    imagen produce 412 en cuanto se ha anotado algo.

    Devuelve cuerpo en lugar de 204 porque el binario puede sobrevivir al metadato:
    `storage_deleted: false` con la ruta huerfana es informacion que el cliente
    necesita, y un 204 la borraria.
    """
    esperada = _parse_if_match(if_match)
    resultado = await AiAssetService(db, settings, token).delete_asset(
        asset_id, expected_version=esperada
    )
    return Envelope[AssetDeleteOut](data=AssetDeleteOut.model_validate(resultado))
