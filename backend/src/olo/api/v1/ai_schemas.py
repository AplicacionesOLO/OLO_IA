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


# ── Anotaciones ────────────────────────────────────────────────────────────
#
# Coordenadas normalizadas 0..1 en formato YOLO (centro, ancho, alto). Los rangos
# se declaran aquí, otra vez en el dominio y otra vez como CHECK en el motor. No es
# duplicación por descuido: Pydantic rechaza `cx = 3` con un 422 que nombra el
# campo, el dominio explica que la caja se sale de la imagen, y el motor es la
# autoridad final. Cada capa da un mensaje que la anterior no puede dar.

#: `float` y no `Decimal` en el contrato HTTP: el cliente envía JSON, donde un número
#: ya es un doble. Aceptar `Decimal` no ganaría precisión —la pérdida ocurre en el
#: navegador— y obligaría a serializarlo como cadena. La conversión a `Decimal` con
#: la escala de `numeric(9,8)` se hace al entrar al dominio.
Normalizado = Annotated[float, Field(ge=0.0, le=1.0)]
Dimension = Annotated[float, Field(gt=0.0, le=1.0)]


class AnnotationIn(ApiModel):
    """Una caja que el cliente quiere que exista.

    `id` presente = «esta ya existía, actualízala». `id` ausente = «es nueva».
    El servidor rechaza un `id` que no pertenezca a la imagen en lugar de crearlo
    con ese identificador, que lo ataría a la imagen equivocada.
    """

    class_id: UUID
    cx: Normalizado
    cy: Normalizado
    w: Dimension
    h: Dimension
    id: UUID | None = None


class AnnotationsReplaceIn(ApiModel):
    """El conjunto COMPLETO de anotaciones de una imagen.

    Una lista vacía es una petición válida y significa «esta imagen no tiene nada
    que anotar»: retira todas sus cajas y devuelve la imagen a `pending`. Es una
    afirmación del anotador, no un error, y por eso no se rechaza.
    """

    annotations: list[AnnotationIn]


class AnnotationOut(ApiModel):
    id: UUID
    project_id: UUID
    image_id: UUID
    class_id: UUID
    kind: str
    cx: float | None
    cy: float | None
    w: float | None
    h: float | None
    origin: str
    confidence: float | None
    version: int
    created_at: datetime
    updated_at: datetime
    # Resueltos en el JOIN con ai.classes: el anotador pinta cada caja con el color
    # de su clase y sin esto necesitaría cruzar dos respuestas antes de dibujar.
    class_name: str | None = None
    class_color: str | None = None
    class_index: int | None = None


class AnnotationsSavedOut(ApiModel):
    """Resultado de un guardado: las cajas Y el estado nuevo de la imagen.

    Las dos cosas juntas porque el cliente necesita las dos: los `id` recién
    asignados —sin ellos, el siguiente guardado volvería a insertar las mismas
    cajas— y la `image_version`, que es el `If-Match` de la siguiente escritura.
    Sin devolverla, el cliente quedaría con un ETag caducado hasta que recargue.
    """

    annotations: list[AnnotationOut]
    image_id: UUID
    image_status: str
    image_version: int


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


# ── Versiones de dataset ───────────────────────────────────────────────────


class DatasetVersionOut(ApiModel):
    id: UUID
    project_id: UUID
    version: int
    name: str | None
    notes: str | None
    #: `[{"index": 0, "name": "pallet"}, …]` congelado. Ver `chk_dsv_snapshot_array`.
    class_snapshot: list[dict[str, Any]]
    image_count: int
    train_count: int
    val_count: int
    test_count: int
    split_seed: int
    frozen_at: datetime


class DatasetFreezeIn(ApiModel):
    """El número de versión NO se acepta: lo asigna el servidor con advisory lock.

    La semilla sí, porque repetirla es la única forma de reproducir un reparto
    anterior. Su valor por omisión es fijo y no aleatorio: dos congelados del mismo
    conjunto deben coincidir salvo que alguien pida lo contrario.
    """

    name: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    notes: str | None = None
    split_seed: Annotated[int, Field(ge=0, le=2_147_483_647)] = 42
    train_pct: Annotated[float, Field(gt=0.0, lt=1.0)] = 0.7
    val_pct: Annotated[float, Field(gt=0.0, lt=1.0)] = 0.2
    test_pct: Annotated[float, Field(ge=0.0, lt=1.0)] = 0.1


class DatasetPreviewOut(ApiModel):
    """Qué entraría si se congelara ahora. No escribe nada."""

    total_images: int
    eligible: int
    with_annotations: int
    annotations: int
    by_status: dict[str, int]
    active_classes: int
    next_version: int
    #: `false` significa que congelar fallaría. Permite deshabilitar el botón con su
    #: motivo en lugar de aceptar el clic y responder 422.
    can_freeze: bool


class YoloExportItem(ApiModel):
    image_id: UUID
    asset_id: UUID
    split: str
    #: Nombre de archivo tomado de `object_path`, no del original: dos fotos pueden
    #: llamarse igual y al materializar el dataset una sobrescribiría a la otra.
    filename: str
    object_path: str | None
    #: Contenido literal del `.txt` de YOLO. Vacío en un negativo, que es válido.
    label: str
    box_count: int
    #: `null` si no se firmó. Ver `signed`.
    url: str | None = None


class YoloExportOut(ApiModel):
    version: int
    version_id: str
    image_count: int
    train_count: int
    val_count: int
    test_count: int
    split_seed: int
    #: `data.yaml` listo para ultralytics, con `nc` e índices ya contiguos.
    data_yaml: str
    #: `class_index` del proyecto → `training_index` de los pesos. Imprescindible
    #: para interpretar un modelo si el proyecto tiene huecos en `class_index`.
    class_map: list[dict[str, Any]]
    items: list[YoloExportItem]
    signed_url_ttl: int
    bucket: str
    #: `false` cuando el conjunto supera `sign_limit`: hay rutas pero no firmas.
    signed: bool
    sign_limit: int
