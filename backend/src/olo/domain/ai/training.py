"""Entrenamiento y versiones de pesos: lo que produce un modelo ejecutable.

Es lo que `domain/ai/model.py` dejaba dicho: «los pesos concretos son
`ai.model_versions`, y su CRUD está fuera del Bloque 1». Este es ese bloque.

── DÓNDE ESTÁ LA AUTORIDAD, Y POR QUÉ NO ESTÁ AQUÍ ──────────────────────────

La matriz de transiciones de una versión NO se replica en Python. Vive en
`ai.validate_version_transition()` y ahí es autoridad única; `domain/ai/model.py` ya
lo advirtió y la advertencia se respeta:

    registered → validating, archived
    validating → validated, failed
    validated  → published, validating, archived
    published  → deprecated
    deprecated → published, archived        ← volver a publicar ES el rollback
    failed     → validating, archived
    archived   → terminal

Copiarla aquí crearía dos verdades sobre qué transición es legítima, y la copia se
quedaría atrás en cuanto alguien añadiera un estado. Lo que sí hay es
`ModelVersionStatus`, que es el VOCABULARIO —un enum, no una matriz— y tiene una
prueba que lo compara contra el CHECK de la base.

Lo mismo con la inmutabilidad: `ai.reject_finished_run_change()` impide modificar o
borrar una ejecución terminada, con este argumento en el propio disparador —«un
entrenamiento terminado es un hecho, y reescribirlo invalidaría la comparación con
cualquier otro modelo»—. Este módulo no lo comprueba; lo aprovecha.

── QUÉ NO ES ────────────────────────────────────────────────────────────────

No es un entrenador. Aquí no se carga PyTorch ni se recorre un dataset: se registra
qué se pidió entrenar, con qué datos y con qué hiperparámetros, y se acepta lo que un
RUNNER externo reporta al terminar. Es la misma frontera que en percepción, y por la
misma razón: el sistema es el registro, y la GPU está en otro sitio.

`runner` guarda quién lo ejecutó —«colab», «gpu-box-01», «mano»— porque dos
ejecuciones con los mismos hiperparámetros y métricas distintas se explican, casi
siempre, por dónde corrieron.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from olo.domain.warehouse import DomainRuleError


class TrainingRunStatus(StrEnum):
    """Espejo del CHECK `chk_run_status`.

    Sin `draft`: una ejecución nace ENCOLADA. No hay nada que preparar entre
    «quiero entrenar esto» y «está pendiente de que alguien lo coja», y un borrador
    de entrenamiento sería un estado en el que nadie hace nada y que hay que limpiar.
    """

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ModelOrigin(StrEnum):
    """De dónde salieron los pesos. Espejo del CHECK `chk_mv_origin`.

    `pretrained` e `imported` EXIGEN `source_reference` —lo impone
    `chk_mv_procedencia`—: unos pesos que aparecen sin decir de dónde vienen no se
    pueden auditar ni reproducir, y en cuanto den un resultado raro nadie sabrá si el
    problema es del modelo o de su procedencia.
    """

    TRAINED = "trained"
    PRETRAINED = "pretrained"
    IMPORTED = "imported"


# Estados en los que una ejecución ya terminó. La base los hace inmutables.
ESTADOS_TERMINALES: frozenset[TrainingRunStatus] = frozenset(
    {TrainingRunStatus.SUCCEEDED, TrainingRunStatus.FAILED, TrainingRunStatus.CANCELLED}
)


# Métricas que se esperan de una ejecución de detección. NO se exigen todas: un
# entrenamiento de clasificación no tiene mAP, y rechazarlo por eso obligaría a
# inventar un número para poder guardar el resultado.
#
# La lista existe para poder DECIR qué falta cuando falta, en lugar de aceptar en
# silencio un `metrics: {}` que luego nadie puede comparar con nada.
METRICAS_ESPERADAS: tuple[str, ...] = (
    "map50",
    "map50_95",
    "precision",
    "recall",
    "epochs",
    "train_seconds",
)


@dataclass(slots=True)
class TrainingRun:
    """Una ejecución de entrenamiento: qué datos, qué hiperparámetros, qué salió.

    `dataset_version_id` es obligatorio y apunta a una versión CONGELADA. Es la razón
    de ser de `ai.dataset_versions`: sin ella, «este modelo se entrenó con las
    imágenes del proyecto» sería una frase sobre un conjunto que cambia, y comparar
    dos modelos dejaría de significar nada.

    `class_map` es la lista de clases CON SU ÍNDICE en el momento de entrenar, y se
    guarda aunque el proyecto ya las tenga: los índices son parte del modelo —la
    salida 0 significa lo que significaba al entrenar— y `ai.prevent_class_index_change`
    existe precisamente porque cambiarlos rompe todos los pesos anteriores.
    """

    id: UUID
    project_id: UUID
    model_id: UUID
    dataset_version_id: UUID
    architecture_code: str
    status: TrainingRunStatus
    hyperparams: dict[str, Any]
    class_map: list[dict[str, Any]]
    version: int
    created_at: datetime
    updated_at: datetime

    runner: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    metrics: dict[str, Any] | None = None
    error_message: str | None = None
    model_version_id: UUID | None = None
    notes: str | None = None

    def __post_init__(self) -> None:
        if not self.class_map:
            # Lo impone `chk_run_class_map`; se comprueba aquí para dar un mensaje que
            # explique la consecuencia en lugar de un fallo de restricción.
            msg = (
                "Una ejecucion sin mapa de clases no se puede reproducir: los indices "
                "son parte del modelo, y sin ellos la salida 0 no significa nada"
            )
            raise DomainRuleError(msg)

    @property
    def terminada(self) -> bool:
        return self.status in ESTADOS_TERMINALES

    @property
    def metricas_ausentes(self) -> tuple[str, ...]:
        """Qué métricas esperadas no vinieron. Informativo, no una regla.

        Se usa para avisar al registrar el resultado —«esta ejecución no trae mAP»—
        sin rechazarlo: hay arquitecturas cuyas métricas son otras, y exigir un
        número obligaría a inventarlo.
        """
        if not self.metrics:
            return METRICAS_ESPERADAS
        return tuple(k for k in METRICAS_ESPERADAS if k not in self.metrics)


@dataclass(slots=True)
class ModelVersion:
    """Unos pesos concretos, con su procedencia y su ciclo de vida.

    `weights_asset_id` NO puede ser nulo: la columna es NOT NULL desde 0043. Se
    intentó lo contrario —permitir una versión que solo referenciara pesos externos— y
    la base lo rechazó, con razón: una versión sin archivo no es una versión, es una
    anotación sobre un entrenamiento, y cargarla sería imposible.

    Los dos campos dicen cosas distintas y los dos hacen falta en su caso:
    `weights_asset_id` es DÓNDE ESTÁN los bytes, y `source_reference` de DÓNDE VIENEN.
    `chk_mv_procedencia` obliga al segundo en todo lo que no sea `trained`.

    ⚠ El estado se mueve con `ai.validate_version_transition()`. Este dataclass NO
    tiene un método `publicar()` que compruebe la transición: sería la segunda verdad
    que `domain/ai/model.py` advirtió que no hay que crear.
    """

    id: UUID
    project_id: UUID
    model_id: UUID
    version: int
    origin: ModelOrigin
    status: str
    version_lock: int
    weights_asset_id: UUID
    created_at: datetime
    updated_at: datetime

    source_reference: str | None = None
    notes: str | None = None
    published_at: datetime | None = None
    published_by: UUID | None = None
    validated_at: datetime | None = None
    deprecated_at: datetime | None = None
    archived_at: datetime | None = None
    failure_reason: str | None = None
    deleted_at: datetime | None = None

    # ── Derivados. No se persisten ─────────────────────────────────────────
    model_name: str | None = None
    model_slug: str | None = None
    task: str | None = None
    training_run_id: UUID | None = None
    metrics: dict[str, Any] | None = field(default=None)

    def __post_init__(self) -> None:
        if self.origin is not ModelOrigin.TRAINED and not (self.source_reference or "").strip():
            msg = (
                f"Una version '{self.origin}' necesita `source_reference`: unos pesos "
                "que aparecen sin decir de donde vienen no se pueden auditar, y cuando "
                "den un resultado raro nadie sabra si el problema es del modelo o de su "
                "procedencia"
            )
            raise DomainRuleError(msg)

    @property
    def ejecutable(self) -> bool:
        """Si esta versión se puede usar para inferir.

        Solo `published`. Es lo que `perception.v_published_models` (0070) filtra, y la
        razón de que ese filtro sea la frontera: publicar es el acto explícito por el
        que alguien declara unos pesos utilizables.
        """
        return self.status == "published"
