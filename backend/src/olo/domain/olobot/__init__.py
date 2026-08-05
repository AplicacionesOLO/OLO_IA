"""OLOBOT: el dominio del asistente.

Aquí vive lo que decide QUÉ puede hacer el bot, sin base de datos y sin HTTP: los
cuatro niveles y el catálogo de herramientas. Todo lo demás —consultar, hablar con el
modelo, ejecutar— es infraestructura que usa esto.
"""

from olo.domain.olobot.herramientas import (
    CATALOGO,
    RUTAS,
    Herramienta,
    herramientas_para,
    por_nombre,
)
from olo.domain.olobot.level import (
    ETIQUETAS,
    NIVELES,
    Capacidad,
    Nivel,
    capacidades_de,
    nivel_valido,
    puede,
)

__all__ = [
    "CATALOGO",
    "ETIQUETAS",
    "NIVELES",
    "RUTAS",
    "Capacidad",
    "Herramienta",
    "Nivel",
    "capacidades_de",
    "herramientas_para",
    "nivel_valido",
    "por_nombre",
    "puede",
]
