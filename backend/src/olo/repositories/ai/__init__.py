"""Repositorios del dominio de IA.

Como en el resto del proyecto, NO añaden filtro de aislamiento: lo impone RLS con
`core.is_platform_owner()`. Filtrar también aquí daría una falsa sensación de
seguridad y ocultaría un fallo de política en lugar de dejarlo a la vista.

Paquete y no un archivo por entidad suelto: son cuatro repositorios del mismo
dominio y en el Bloque 3 llegan datasets y anotaciones.
"""

from olo.repositories.ai.catalog import CatalogRepository
from olo.repositories.ai.klass import ClassRepository, ModelClassRepository
from olo.repositories.ai.model import ModelRepository
from olo.repositories.ai.project import ProjectRepository

__all__ = [
    "CatalogRepository",
    "ClassRepository",
    "ModelClassRepository",
    "ModelRepository",
    "ProjectRepository",
]
