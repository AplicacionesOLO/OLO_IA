"""Assets e imagenes del proyecto."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from olo.domain.warehouse import DomainRuleError

BUCKET = "ai-assets"

# Todo lo que no sea alfanumerico, punto, guion o subrayado se colapsa. Los puntos
# consecutivos se reducen a uno: `..` como segmento es la unica forma de salir del
# prefijo, y la politica del bucket ademas lo rechaza.
_RUIDO = re.compile(r"[^a-z0-9._-]+")
_PUNTOS = re.compile(r"\.{2,}")


class AssetKind(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    FRAME = "frame"
    THUMBNAIL = "thumbnail"
    WEIGHTS = "weights"
    RUN_ARTIFACT = "run_artifact"


class ImageStatus(StrEnum):
    PENDING = "pending"
    ANNOTATED = "annotated"
    VALIDATED = "validated"
    REJECTED = "rejected"
    ARCHIVED = "archived"


MIME_PERMITIDOS: dict[AssetKind, frozenset[str]] = {
    AssetKind.IMAGE: frozenset({"image/jpeg", "image/png", "image/webp"}),
    AssetKind.FRAME: frozenset({"image/jpeg", "image/png", "image/webp"}),
    AssetKind.THUMBNAIL: frozenset({"image/jpeg", "image/webp"}),
    AssetKind.VIDEO: frozenset({"video/mp4", "video/quicktime", "video/x-msvideo"}),
    AssetKind.WEIGHTS: frozenset({"application/octet-stream"}),
    AssetKind.RUN_ARTIFACT: frozenset(
        {"application/zip", "text/csv", "application/json", "application/octet-stream"}
    ),
}

MAX_BYTES: dict[AssetKind, int] = {
    AssetKind.IMAGE: 25 * 1024 * 1024,
    AssetKind.FRAME: 25 * 1024 * 1024,
    AssetKind.THUMBNAIL: 2 * 1024 * 1024,
    AssetKind.VIDEO: 2 * 1024 * 1024 * 1024,
    AssetKind.WEIGHTS: 500 * 1024 * 1024,
    AssetKind.RUN_ARTIFACT: 100 * 1024 * 1024,
}

_EXTENSION: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "application/zip": "zip",
    "text/csv": "csv",
    "application/json": "json",
    "application/octet-stream": "bin",
}


def validar_subida(kind: AssetKind, content_type: str, bytes_: int) -> None:
    permitidos = MIME_PERMITIDOS[kind]
    if content_type not in permitidos:
        msg = (
            f"El tipo {content_type!r} no se admite para {kind.value}. "
            f"Admitidos: {', '.join(sorted(permitidos))}."
        )
        raise DomainRuleError(msg)

    tope = MAX_BYTES[kind]
    if bytes_ <= 0:
        msg = "El tamaño del archivo debe ser mayor que cero"
        raise DomainRuleError(msg)
    if bytes_ > tope:
        msg = f"El archivo excede el maximo de {tope // (1024 * 1024)} MB para {kind.value}"
        raise DomainRuleError(msg)


_NOMBRE_MAX = 80


def sanitizar_nombre(original: str, content_type: str) -> str:
    """Nombre de archivo seguro y DETERMINISTA.

    Determinista no es un detalle: `confirm` recalcula la ruta que genero `prepare`
    a partir del mismo nombre. Si esta funcion no diera exactamente el mismo
    resultado para la misma entrada, el objeto ya subido quedaria inalcanzable.

    La extension la fija el MIME, no el nombre: un `.exe` con `content_type`
    `image/jpeg` acaba como `.jpg`, y lo que Storage sirva no podra desmentir su
    propia extension.
    """
    # Los acentos se transliteran en vez de colapsarse: sin esto, «camión» quedaria
    # como «cami-n» y el nombre deja de servir para reconocer el archivo.
    plano = (
        unicodedata.normalize("NFKD", original).encode("ascii", "ignore").decode("ascii")
    )
    # Ni separadores de Windows ni de POSIX sobreviven: el nombre es UN segmento.
    base = plano.replace("\\", "/").rsplit("/", 1)[-1].strip().lower()
    base = _RUIDO.sub("-", base)
    base = _PUNTOS.sub(".", base).strip("-._")
    raiz = base.rsplit(".", 1)[0] if "." in base else base
    raiz = raiz[:_NOMBRE_MAX].strip("-._") or "archivo"
    return f"{raiz}.{_EXTENSION.get(content_type, 'bin')}"


def ruta_canonica(
    project_id: UUID,
    asset_id: UUID,
    kind: AssetKind,
    content_type: str,
    original_filename: str,
) -> str:
    """La ruta la genera SIEMPRE el servidor.

        {project_id}/{kind}/{asset_id}/{nombre_saneado}

    El aislamiento entre proyectos vive en el primer segmento y la migracion 0045
    lo convierte en invariante: `core.ai_asset_path_ok()` exige que sea un proyecto
    real, que el segundo este en el vocabulario cerrado de `AssetKind` y que haya
    exactamente cuatro segmentos. El `asset_id` propio da unicidad, asi que el
    nombre puede conservarse sin riesgo de colision.
    """
    return (
        f"{project_id}/{kind.value}/{asset_id}/"
        f"{sanitizar_nombre(original_filename, content_type)}"
    )


@dataclass(slots=True)
class AiAsset:
    id: UUID
    project_id: UUID
    kind: AssetKind
    bucket: str
    object_path: str
    original_filename: str
    content_type: str
    bytes: int
    sha256: str
    uploaded_at: datetime
    version: int
    created_at: datetime
    updated_at: datetime
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    deleted_at: datetime | None = None


@dataclass(slots=True)
class AiImage:
    id: UUID
    project_id: UUID
    asset_id: UUID
    source: str
    status: ImageStatus
    version: int
    created_at: datetime
    updated_at: datetime
    frame_index: int | None = None
    frame_timestamp_ms: int | None = None
    source_video_asset_id: UUID | None = None
    annotated_at: datetime | None = None
    reviewed_at: datetime | None = None
    deleted_at: datetime | None = None
    # Derivados del JOIN con ai.assets.
    object_path: str | None = None
    content_type: str | None = None
    bytes: int | None = None
    width: int | None = None
    height: int | None = None
    original_filename: str | None = None
    annotation_count: int | None = None
    # La version del ASSET, no de la imagen: el DELETE del binario exige su If-Match.
    asset_version: int | None = None
