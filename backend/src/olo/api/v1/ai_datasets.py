"""Versiones de dataset: previsualizar, congelar, listar y exportar en formato YOLO.

Cuatro endpoints. No hay PATCH ni DELETE, y no es una omisión: las dos tablas tienen
un trigger que aborta UPDATE y DELETE. Una versión congelada es lo que hace
reproducible un entrenamiento; «corregirla» sería quitarle ese valor. Se crea otra.
"""

from __future__ import annotations

import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from olo.api.deps import AccessToken, AppSettings, Db, PlatformOwnerRequired, require
from olo.api.v1.ai_schemas import (
    DatasetFreezeIn,
    DatasetPreviewOut,
    DatasetVersionOut,
    YoloExportOut,
)
from olo.api.v1.schemas import Envelope
from olo.repositories import identity
from olo.services.ai.asset import AiAssetService
from olo.services.ai.dataset import AiDatasetService

router = APIRouter(prefix="/ai", tags=["ai-datasets"])

_TTL_FIRMA = 900

#: Techo de URLs firmadas por export.
#:
#: `sign_download` es una llamada HTTP a Storage POR OBJETO. Con 5.000 imágenes serían
#: 5.000 peticiones dentro de una sola respuesta HTTP: minutos de espera y un
#: `timeout` de proxy garantizado. Por encima del techo se devuelven las rutas sin
#: firmar y se dice explícitamente en `signed`, para que el script las firme él mismo
#: en lugar de creer que el export está incompleto.
_MAX_FIRMAS = 300

#: Firmas simultáneas. `sign_download` abre su propio cliente HTTP por llamada, así que
#: sin límite 300 objetos abrirían 300 pools contra Storage a la vez.
_CONCURRENCIA_FIRMA = 8


@router.get(
    "/projects/{project_id}/dataset-versions",
    response_model=Envelope[list[DatasetVersionOut]],
    dependencies=[PlatformOwnerRequired, require("datasets:read")],
    summary="Versiones congeladas del proyecto, la más reciente primero",
)
async def list_versions(db: Db, project_id: UUID) -> Envelope[list[DatasetVersionOut]]:
    filas = await AiDatasetService(db).list_versions(project_id)
    return Envelope[list[DatasetVersionOut]](
        data=[
            DatasetVersionOut(
                id=v.id,
                project_id=v.project_id,
                version=v.version,
                name=v.name,
                notes=v.notes,
                class_snapshot=[c.as_json() for c in v.class_snapshot],
                image_count=v.image_count,
                train_count=v.train_count,
                val_count=v.val_count,
                test_count=v.test_count,
                split_seed=v.split_seed,
                frozen_at=v.frozen_at,
            )
            for v in filas
        ]
    )


@router.get(
    "/projects/{project_id}/dataset-versions/preview",
    response_model=Envelope[DatasetPreviewOut],
    dependencies=[PlatformOwnerRequired, require("datasets:read")],
    summary="Qué entraría si se congelara ahora. No escribe nada",
)
async def preview(db: Db, project_id: UUID) -> Envelope[DatasetPreviewOut]:
    """Existe para no obligar a crear algo inmutable solo para ver qué hay.

    Devuelve `can_freeze` para que el botón pueda estar deshabilitado con su motivo
    visible, en lugar de aceptar el clic y responder 422.
    """
    datos = await AiDatasetService(db).preview(project_id)
    return Envelope[DatasetPreviewOut](data=DatasetPreviewOut.model_validate(datos))


@router.post(
    "/projects/{project_id}/dataset-versions",
    response_model=Envelope[DatasetVersionOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[PlatformOwnerRequired, require("datasets:write")],
    summary="Congelar una versión del dataset",
)
async def freeze(
    db: Db, project_id: UUID, payload: DatasetFreezeIn, response: Response
) -> Envelope[DatasetVersionOut]:
    """El número de versión lo asigna el SERVIDOR, con advisory lock por proyecto.

    Igual que `class_index`: dejarlo al cliente solo permitiría colisiones. Y la
    semilla del reparto SÍ la elige el cliente, porque repetirla a propósito es la
    única forma de reproducir un reparto anterior con imágenes nuevas.
    """
    user_id = await identity.fetch_current_user_id(db)
    version = await AiDatasetService(db).freeze(
        project_id,
        name=payload.name,
        notes=payload.notes,
        seed=payload.split_seed,
        proporciones=(payload.train_pct, payload.val_pct, payload.test_pct),
        created_by=user_id,
    )
    response.headers["Location"] = (
        f"/v1/ai/projects/{project_id}/dataset-versions/{version.id}"
    )
    return Envelope[DatasetVersionOut](
        data=DatasetVersionOut(
            id=version.id,
            project_id=version.project_id,
            version=version.version,
            name=version.name,
            notes=version.notes,
            class_snapshot=[c.as_json() for c in version.class_snapshot],
            image_count=version.image_count,
            train_count=version.train_count,
            val_count=version.val_count,
            test_count=version.test_count,
            split_seed=version.split_seed,
            frozen_at=version.frozen_at,
        )
    )


@router.get(
    "/projects/{project_id}/dataset-versions/{version_id}/export",
    response_model=Envelope[YoloExportOut],
    dependencies=[PlatformOwnerRequired, require("datasets:read")],
    summary="Manifiesto YOLO: data.yaml, etiquetas y URLs firmadas",
)
async def export_yolo(
    db: Db,
    settings: AppSettings,
    token: AccessToken,
    project_id: UUID,
    version_id: UUID,
    sign: Annotated[bool, Query(description="Emitir URLs firmadas de descarga")] = True,
) -> Envelope[YoloExportOut]:
    """Lo que hace falta para materializar el dataset en disco y entrenar.

    Los binarios NO pasan por aquí: es la misma decisión que en la subida. El
    manifiesto trae las rutas y, si caben bajo el techo, sus URLs firmadas.
    """
    datos = await AiDatasetService(db).export_yolo(
        project_id, version_id, settings=settings, ttl=_TTL_FIRMA
    )

    items = datos["items"]
    firmar = sign and len(items) <= _MAX_FIRMAS

    if firmar:
        servicio = AiAssetService(db, settings, token)
        limite = asyncio.Semaphore(_CONCURRENCIA_FIRMA)

        async def una(item: dict[str, object]) -> None:
            async with limite:
                try:
                    # `signed_url` valida que la ruta empiece por el project_id del
                    # asset antes de firmar: una firma es una URL que funciona sin
                    # sesion, asi que esa comprobacion no se puede saltar.
                    item["url"] = await servicio.signed_url(
                        UUID(str(item["asset_id"])), expires_in=_TTL_FIRMA
                    )
                except Exception:
                    # Una firma que falla no invalida el export entero: la imagen queda
                    # con `url = null` y su ruta, y el script puede pedirla aparte. Un
                    # 500 aquí obligaría a repetir las otras 299 firmas.
                    item["url"] = None

        await asyncio.gather(*(una(i) for i in items))
    else:
        for i in items:
            i["url"] = None

    datos["signed"] = firmar
    datos["sign_limit"] = _MAX_FIRMAS
    return Envelope[YoloExportOut](data=YoloExportOut.model_validate(datos))
