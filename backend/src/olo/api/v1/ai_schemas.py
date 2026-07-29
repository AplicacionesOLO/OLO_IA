"""Contratos Pydantic del módulo de IA.

Separado de `api/v1/schemas.py` para que un cambio en un almacén y uno en un modelo
no compitan por el mismo archivo.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field

from olo.api.v1.schemas import ApiModel

_SLUG = r"^[a-z0-9][a-z0-9-]*$"
_COLOR = r"^#[0-9A-Fa-f]{6}$"

Task = Literal[
    "detect", "segment", "classify", "ocr", "track", "pose", "count", "regress", "embed"
]
InputTypeT = Literal["image", "video", "frames", "point_cloud", "depth", "thermal", "fusion"]
ProjectStatusT = Literal[
    "draft", "collecting", "annotating", "training", "published", "archived"
]
ModelStatusT = Literal[
    "draft", "collecting", "annotating", "training", "published", "deprecated", "archived"
]


# ── Catálogo (solo lectura) ────────────────────────────────────────────────
class FrameworkOut(ApiModel):
    code: str
    display_name: str
    adapter: str
    is_active: bool
    notes: str | None


class ArchitectureOut(ApiModel):
    code: str
    framework_code: str
    display_name: str
    family: str
    supported_tasks: list[str]
    supported_input_types: list[str]
    supported_annotation_kinds: list[str]
    requires_training: bool
    requires_annotations: bool
    weights_extension: str | None
    default_hyperparams: dict[str, Any]
    hyperparam_schema: dict[str, Any]
    min_images_recommended: int | None
    approx_weights_mb: int | None
    is_active: bool
    notes: str | None


# ── Proyectos ──────────────────────────────────────────────────────────────
class AiProjectOut(ApiModel):
    id: UUID
    name: str
    slug: str
    description: str | None
    status: str
    frame_interval_seconds: float
    max_frames_per_video: int
    max_video_duration_secs: int
    version: int
    created_at: datetime
    updated_at: datetime


class AiProjectCreate(ApiModel):
    name: Annotated[str, Field(min_length=2, max_length=120)]
    slug: Annotated[str, Field(min_length=2, max_length=120, pattern=_SLUG)]
    description: str | None = None
    frame_interval_seconds: Annotated[float, Field(gt=0, le=60)] = 1.0
    max_frames_per_video: Annotated[int, Field(ge=1, le=100_000)] = 1000
    max_video_duration_secs: Annotated[int, Field(ge=1, le=7_200)] = 1200


class AiProjectUpdate(ApiModel):
    name: Annotated[str, Field(min_length=2, max_length=120)] | None = None
    slug: Annotated[str, Field(min_length=2, max_length=120, pattern=_SLUG)] | None = None
    description: str | None = None
    status: ProjectStatusT | None = None
    frame_interval_seconds: Annotated[float, Field(gt=0, le=60)] | None = None
    max_frames_per_video: Annotated[int, Field(ge=1, le=100_000)] | None = None
    max_video_duration_secs: Annotated[int, Field(ge=1, le=7_200)] | None = None

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


# ── Modelos ────────────────────────────────────────────────────────────────
class AiModelOut(ApiModel):
    id: UUID
    project_id: UUID
    name: str
    slug: str
    description: str | None
    purpose: str | None
    architecture_code: str
    task: str
    input_type: str
    status: str
    requires_training: bool
    config: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime

    # DERIVADOS, de solo lectura. Vienen de ai.models_resolved y de dos
    # subconsultas; no se aceptan en POST ni en PATCH.
    framework_code: str | None = None
    framework_name: str | None = None
    framework_adapter: str | None = None
    architecture_name: str | None = None
    weights_extension: str | None = None
    published_version_id: UUID | None = None
    version_count: int | None = None


class AiModelCreate(ApiModel):
    name: Annotated[str, Field(min_length=2, max_length=120)]
    slug: Annotated[str, Field(min_length=2, max_length=120, pattern=_SLUG)]
    architecture_code: Annotated[str, Field(min_length=1, max_length=60)]
    task: Task
    input_type: InputTypeT
    description: str | None = None
    purpose: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    # `framework_code` y `requires_training` NO están: el primero se deriva de la
    # arquitectura, el segundo lo copia el trigger. `extra="forbid"` los rechaza.


class AiModelUpdate(ApiModel):
    name: Annotated[str, Field(min_length=2, max_length=120)] | None = None
    slug: Annotated[str, Field(min_length=2, max_length=120, pattern=_SLUG)] | None = None
    description: str | None = None
    purpose: str | None = None
    status: ModelStatusT | None = None
    architecture_code: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    task: Task | None = None
    input_type: InputTypeT | None = None
    config: dict[str, Any] | None = None

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


# ── Clases ─────────────────────────────────────────────────────────────────
class AiClassOut(ApiModel):
    id: UUID
    project_id: UUID
    name: str
    class_index: int
    color: str
    description: str | None
    is_active: bool
    version: int
    created_at: datetime
    updated_at: datetime


class AiClassCreate(ApiModel):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    color: Annotated[str, Field(pattern=_COLOR)]
    description: str | None = None
    # `class_index` NO se acepta: lo asigna el servidor con advisory lock.


class AiClassUpdate(ApiModel):
    name: Annotated[str, Field(min_length=1, max_length=60)] | None = None
    color: Annotated[str, Field(pattern=_COLOR)] | None = None
    description: str | None = None
    is_active: bool | None = None
    # `class_index` es inmutable: no aparece.

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


# ── Vocabulario del modelo ─────────────────────────────────────────────────
class ModelClassOut(ApiModel):
    class_id: UUID
    training_index: int
    class_name: str | None
    class_color: str | None
    class_index: int | None
    class_is_active: bool | None


class ModelVocabularyPut(ApiModel):
    """Reemplazo COMPLETO. El ORDEN de la lista determina `training_index`."""

    class_ids: Annotated[list[UUID], Field(min_length=1, max_length=500)]


# ── Assets e imagenes ──────────────────────────────────────────────────────
AssetKindT = Literal["image", "video", "frame", "thumbnail", "weights", "run_artifact"]
ImageStatusT = Literal["pending", "annotated", "validated", "rejected", "archived"]


class UploadPrepareIn(ApiModel):
    kind: AssetKindT
    content_type: Annotated[str, Field(min_length=3, max_length=100)]
    bytes: Annotated[int, Field(gt=0)]
    # El nombre entra en la ruta ya saneado. `object_path` NO se acepta: la ruta la
    # genera el servidor y el cliente solo la recibe.
    original_filename: Annotated[str, Field(min_length=1, max_length=255)]


class UploadPrepareOut(ApiModel):
    asset_id: UUID
    bucket: str
    object_path: str
    upload_url: str


class UploadConfirmIn(ApiModel):
    asset_id: UUID
    kind: AssetKindT
    original_filename: Annotated[str, Field(min_length=1, max_length=255)]
    content_type: Annotated[str, Field(min_length=3, max_length=100)]
    bytes: Annotated[int, Field(gt=0)]
    sha256: Annotated[str, Field(pattern=r"^[0-9a-fA-F]{64}$")]
    width: Annotated[int, Field(gt=0)] | None = None
    height: Annotated[int, Field(gt=0)] | None = None
    duration_ms: Annotated[int, Field(gt=0)] | None = None


class AiAssetOut(ApiModel):
    id: UUID
    project_id: UUID
    kind: str
    bucket: str
    object_path: str
    original_filename: str
    content_type: str
    bytes: int
    sha256: str
    width: int | None
    height: int | None
    duration_ms: int | None
    uploaded_at: datetime
    version: int


class AiImageOut(ApiModel):
    id: UUID
    project_id: UUID
    asset_id: UUID
    source: str
    status: str
    version: int
    created_at: datetime
    frame_index: int | None = None
    object_path: str | None = None
    content_type: str | None = None
    bytes: int | None = None
    width: int | None = None
    height: int | None = None
    original_filename: str | None = None
    annotation_count: int | None = None
    asset_version: int | None = None


class ImageStatusIn(ApiModel):
    status: ImageStatusT


class SignedUrlOut(ApiModel):
    url: str
    expires_in: int


class AssetDeleteOut(ApiModel):
    """El borrado NO devuelve 204.

    El metadato y el binario viven en sistemas distintos y el segundo puede fallar
    sin que el primero se revierta. Un 204 afirmaria que todo se borro; este cuerpo
    dice exactamente que quedo.
    """

    asset_id: UUID
    storage_deleted: bool
    orphaned_object_path: str | None = None
    image_deleted: bool = False
