"""Modelo lógico: qué queremos que el sistema sepa hacer.

Los pesos concretos son `ai.model_versions`, y su CRUD está fuera del Bloque 1.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from olo.domain.warehouse import DomainRuleError

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class Task(StrEnum):
    """Espejo del dominio `ai.task` (migración 0031).

    Si aquí y allí divergieran, el motor rechazaría el valor y el cliente vería un
    500 en lugar de un 422. Hay una prueba que compara las dos listas contra la
    base para que eso no pase inadvertido.
    """

    DETECT = "detect"
    SEGMENT = "segment"
    CLASSIFY = "classify"
    OCR = "ocr"
    TRACK = "track"
    POSE = "pose"
    COUNT = "count"
    REGRESS = "regress"
    EMBED = "embed"


class InputType(StrEnum):
    """Espejo del dominio `ai.input_type`."""

    IMAGE = "image"
    VIDEO = "video"
    FRAMES = "frames"
    POINT_CLOUD = "point_cloud"
    DEPTH = "depth"
    THERMAL = "thermal"
    FUSION = "fusion"


class ModelStatus(StrEnum):
    DRAFT = "draft"
    COLLECTING = "collecting"
    ANNOTATING = "annotating"
    TRAINING = "training"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"
    ARCHIVED = "archived"


class ModelVersionStatus(StrEnum):
    """Ciclo de vida de una versión (migración 0043).

    Se declara aquí porque las respuestas de lectura del Bloque 1 lo exponen —un
    modelo dice si tiene versión publicada— aunque el CRUD de versiones sea de un
    bloque posterior.

    ⚠ La MATRIZ DE TRANSICIONES no se replica en Python a propósito. Vive en
    `ai.validate_version_transition()` y ahí es autoridad única. Copiarla aquí
    crearía dos verdades sobre qué transición es legítima, y la copia se quedaría
    atrás en cuanto alguien añadiera un estado. Cuando el Bloque 5 implemente la
    publicación, si hace falta anticipar el error en la interfaz, lo correcto es
    exponer la matriz DESDE la base, no reescribirla.
    """

    REGISTERED = "registered"
    VALIDATING = "validating"
    VALIDATED = "validated"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"
    ARCHIVED = "archived"
    FAILED = "failed"


# Campos que dejan de poder cambiarse en cuanto el modelo tiene una versión no
# eliminada. Es la lista que impone `ai.validate_model_against_architecture()`, y
# se declara aquí para poder construir el mensaje del 409 con los nombres exactos
# que el usuario envió.
CAMPOS_DEL_CONTRATO: frozenset[str] = frozenset(
    {"architecture_code", "task", "input_type", "requires_training"}
)


@dataclass(slots=True)
class AiModel:
    """Modelo lógico. Varios por proyecto, sobre las mismas imágenes y clases.

    ⚠ NO tiene `framework_code`. La migración 0042 eliminó la columna porque era
    duplicado puro del framework de su arquitectura, y podía divergir si alguien
    editaba el catálogo. Se resuelve por JOIN en `ai.models_resolved`, que es un
    READ MODEL y no el contrato del dominio.

    ⚠ Tampoco tiene `current_version_id`. La versión publicada se resuelve con una
    sonda al índice único `uq_mv_publicada`. Se expone en `published_version_id`,
    que es dato DERIVADO y opcional: lo rellena el repositorio cuando lo consulta,
    y `None` significa «no se pidió», no «no hay publicada».
    """

    id: UUID
    project_id: UUID
    name: str
    slug: str
    architecture_code: str
    task: Task
    input_type: InputType
    status: ModelStatus
    requires_training: bool
    version: int
    created_at: datetime
    updated_at: datetime

    description: str | None = None
    purpose: str | None = None
    config: dict[str, Any] = field(default_factory=dict)
    deleted_at: datetime | None = None

    # ── Derivados. No se persisten en ai.models ────────────────────────────
    framework_code: str | None = None
    framework_name: str | None = None
    framework_adapter: str | None = None
    architecture_name: str | None = None
    weights_extension: str | None = None
    published_version_id: UUID | None = None
    version_count: int | None = None

    def __post_init__(self) -> None:
        if len(self.name.strip()) < 2:
            msg = "El nombre del modelo debe tener al menos 2 caracteres"
            raise DomainRuleError(msg)

        if not _SLUG_RE.match(self.slug):
            msg = (
                f"El slug {self.slug!r} debe empezar por minúscula o dígito y "
                "contener solo minúsculas, dígitos y guiones"
            )
            raise DomainRuleError(msg)

        # `config` NO se valida aquí. Había un `isinstance(self.config, dict)` y
        # mypy lo señaló como inalcanzable, con razón: el tipo ya lo garantiza. Y
        # el motor lo garantiza en el otro extremo, con `chk_model_config`
        # (jsonb_typeof = 'object'), así que la comprobación era código muerto por
        # duplicado. Un `type: ignore` para conservarla habría escondido el hecho.

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None and self.status is not ModelStatus.ARCHIVED

    @property
    def contrato_congelado(self) -> bool:
        """¿Tiene versiones, y por tanto su contrato es inmutable?

        Devuelve `False` si `version_count` es `None`, que significa «no se
        consultó» y no «no tiene». Quien necesite la respuesta debe pedir el conteo
        explícitamente; suponer que la ausencia del dato equivale a cero sería
        permitir una edición que el motor va a rechazar de todos modos, con un 409
        en lugar de un mensaje útil.
        """
        return bool(self.version_count)

    @property
    def tiene_version_publicada(self) -> bool:
        return self.published_version_id is not None

    def campos_del_contrato_modificados(self, cambios: dict[str, Any]) -> list[str]:
        """Qué campos inmutables intenta tocar una actualización parcial.

        Solo cuenta los que CAMBIAN de valor: enviar el mismo `task` que ya tiene no
        es una modificación, y rechazarlo obligaría al cliente a recortar el cuerpo
        antes de cada PATCH.
        """
        modificados: list[str] = []
        for campo in sorted(CAMPOS_DEL_CONTRATO & set(cambios)):
            if cambios[campo] != getattr(self, campo):
                modificados.append(campo)
        return modificados
