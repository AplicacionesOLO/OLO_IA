"""Catálogo de frameworks y arquitecturas: las capacidades como datos.

Es lo que hace la plataforma agnóstica del modelo. Añadir RT-DETR o Florence es una
fila, no una migración más un despliegue: el formulario de entrenamiento se genera
desde `hyperparam_schema` y el validador rechaza combinaciones imposibles.

⚠ EL CATÁLOGO ES VIGENTE, NO HISTÓRICO. En una frase, la que está escrita en el
comentario de la tabla (migración 0044):

    `ai.architectures` representa la configuración RECOMENDADA VIGENTE;
    `ai.training_runs.config_snapshot` representa la configuración UTILIZADA
    HISTÓRICAMENTE.

Para responder «¿con qué parámetros se entrenó esta versión?» NUNCA se consulta
esta entidad. Se consulta el run, que congela su propia copia.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from olo.domain.ai.model import InputType, Task
from olo.domain.warehouse import DomainRuleError


@dataclass(frozen=True, slots=True)
class Framework:
    """Framework de entrenamiento e inferencia.

    `adapter` es lo que sostiene la agnosticidad: el worker despacha por FRAMEWORK,
    no por arquitectura. Los adaptadores son pocos y estables —ultralytics, torch,
    onnx—; las arquitecturas son muchas y crecen cada mes. Sin esa columna, el
    worker acabaría con un `elif` por arquitectura.
    """

    code: str
    display_name: str
    adapter: str
    is_active: bool
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class Architecture:
    """Declaración de CAPACIDADES de una arquitectura.

    Inmutable (`frozen`) a propósito: es un catálogo de lectura para el dominio.
    Editarlo es una operación administrativa que pasa por el repositorio, y el
    trigger `ai.protect_architecture_contract()` limita qué se puede cambiar cuando
    hay modelos que la usan.
    """

    code: str
    framework_code: str
    display_name: str
    family: str
    supported_tasks: frozenset[Task]
    supported_input_types: frozenset[InputType]
    supported_annotation_kinds: frozenset[str]
    requires_training: bool
    requires_annotations: bool
    is_active: bool
    weights_extension: str | None = None
    default_hyperparams: dict[str, Any] = field(default_factory=dict)
    hyperparam_schema: dict[str, Any] = field(default_factory=dict)
    min_images_recommended: int | None = None
    approx_weights_mb: int | None = None
    notes: str | None = None

    def __post_init__(self) -> None:
        if not self.supported_tasks:
            msg = f"La arquitectura {self.code} debe declarar al menos una tarea"
            raise DomainRuleError(msg)

        if not self.supported_input_types:
            msg = f"La arquitectura {self.code} debe declarar al menos un tipo de entrada"
            raise DomainRuleError(msg)

        # Espeja `chk_arch_anotaciones`: si necesita anotaciones debe decir CUÁLES,
        # y si no las necesita no declara ninguna. Sin esto se podría registrar una
        # arquitectura supervisada sin indicar qué consume, y el exportador no
        # sabría qué generar.
        if self.requires_annotations != bool(self.supported_annotation_kinds):
            msg = (
                f"{self.code}: requires_annotations={self.requires_annotations} no "
                f"concuerda con {len(self.supported_annotation_kinds)} tipos de anotación"
            )
            raise DomainRuleError(msg)

        if self.requires_training and not self.requires_annotations:
            msg = f"{self.code}: entrenar sin anotaciones no tiene sentido"
            raise DomainRuleError(msg)

    @property
    def es_zero_shot(self) -> bool:
        """No se entrena: se usa con pesos preentrenados y, quizá, un prompt.

        SAM2, Grounding DINO y CLIP. Sus versiones nacen con `origin='pretrained'` y
        recorren el mismo ciclo de publicación que una entrenada.
        """
        return not self.requires_training

    @property
    def hiperparametros_verificados(self) -> bool:
        """¿Su `hyperparam_schema` está relleno, o pendiente de verificar?

        Se siembra vacío en las arquitecturas cuyos parámetros no se han comprobado
        —RT-DETR, SAM2, Grounding DINO, Florence, CLIP— porque sembrar números
        plausibles y sin verificar es peor que dejarlo vacío: parecerían
        configuración válida y nadie los revisaría antes de lanzar un entrenamiento.
        Un `{}` obliga a mirarlo.
        """
        return bool(self.hyperparam_schema)

    def soporta(self, task: Task, input_type: InputType) -> bool:
        return task in self.supported_tasks and input_type in self.supported_input_types

    def validate_combination(self, task: Task, input_type: InputType) -> None:
        """Rechaza una combinación imposible ANTES de tocar la base.

        Repite lo que impone `ai.validate_model_against_architecture()`, y la
        duplicación es deliberada: aquí se puede devolver la LISTA de alternativas
        en el mensaje —«soporta detect, segment, classify, pose»— sin gastar un
        viaje a la base ni, más adelante, una GPU.

        El motor sigue siendo la autoridad. Si las dos divergieran, la que manda es
        la del motor y el cliente recibiría un 422 igualmente; lo que se pierde en
        ese caso es la calidad del mensaje, no la corrección.
        """
        if not self.is_active:
            msg = f"La arquitectura {self.code} está desactivada"
            raise DomainRuleError(msg)

        if task not in self.supported_tasks:
            soportadas = ", ".join(sorted(t.value for t in self.supported_tasks))
            msg = (
                f"La arquitectura {self.code} no soporta la tarea {task.value!r}. "
                f"Soporta: {soportadas}."
            )
            raise DomainRuleError(msg)

        if input_type not in self.supported_input_types:
            soportadas = ", ".join(sorted(i.value for i in self.supported_input_types))
            msg = (
                f"La arquitectura {self.code} no soporta la entrada "
                f"{input_type.value!r}. Soporta: {soportadas}."
            )
            raise DomainRuleError(msg)
