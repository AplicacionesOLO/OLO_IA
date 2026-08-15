"""Dominio de percepción: dónde viven los bytes de un medio.

Aquí no hay lógica de inferencia —eso lo hace el worker— ni de estado del trabajo
—eso lo valida la base con el disparador de 0069—. Solo la ruta canónica, que es una
decisión sobre la frontera del aislamiento y por eso no puede estar en el servicio ni
en el cliente.
"""

from olo.domain.perception.lectura import (
    Lectura,
    Resumen,
    convertir,
    es_codigo_de_ubicacion,
)
from olo.domain.perception.media import (
    BUCKET,
    EXTENSION_POR_TIPO,
    TIPOS_ADMITIDOS,
    prefijo_de_recortes,
    ruta_canonica,
    sanitizar_nombre,
    validar_medio,
)

__all__ = [
    "BUCKET",
    "EXTENSION_POR_TIPO",
    "TIPOS_ADMITIDOS",
    "Lectura",
    "Resumen",
    "convertir",
    "es_codigo_de_ubicacion",
    "prefijo_de_recortes",
    "ruta_canonica",
    "sanitizar_nombre",
    "validar_medio",
]
