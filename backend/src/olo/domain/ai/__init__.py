"""Dominio de IA: entidades y reglas que no necesitan la base de datos.

Sin dependencias de FastAPI, SQLAlchemy ni Pydantic, igual que `domain/warehouse.py`.

QUÉ REGLA VA AQUÍ Y QUÉ REGLA VA EN EL MOTOR. La división no es de gusto:

  · aquí, lo que se puede comprobar mirando UNA entidad y nada más: longitudes,
    formatos, rangos, coherencia entre campos de la misma fila;
  · en el motor, lo que depende del estado de OTRAS filas: unicidad, inmutabilidad
    condicionada a que existan versiones, referencias entre proyectos.

Hay un caso que aparece en los dos sitios a propósito, y conviene decir por qué:
`Architecture.validate_combination()` repite lo que el trigger
`ai.validate_model_against_architecture()` ya impone. No es duplicación por
descuido — es para poder responder «esta arquitectura no soporta `ocr`; soporta
detect, segment, classify, pose» ANTES de gastar un viaje a la base, con la lista
de alternativas en el mensaje. El motor sigue siendo la autoridad: si las dos
divergieran, la que manda es la del motor, y el cliente recibiría un 422 igual.
"""

from olo.domain.ai.annotation import (
    Annotation,
    AnnotationDraft,
    BBox,
    planificar_guardado,
    siguiente_estado_imagen,
)
from olo.domain.ai.catalog import Architecture, Framework
from olo.domain.ai.klass import AiClass, ModelClass, asignar_indices_contiguos
from olo.domain.ai.model import AiModel, InputType, ModelStatus, ModelVersionStatus, Task
from olo.domain.ai.project import AiProject, ProjectStatus

__all__ = [
    "AiClass",
    "AiModel",
    "AiProject",
    "Annotation",
    "AnnotationDraft",
    "Architecture",
    "BBox",
    "Framework",
    "InputType",
    "ModelClass",
    "ModelStatus",
    "ModelVersionStatus",
    "ProjectStatus",
    "Task",
    "asignar_indices_contiguos",
    "planificar_guardado",
    "siguiente_estado_imagen",
]
