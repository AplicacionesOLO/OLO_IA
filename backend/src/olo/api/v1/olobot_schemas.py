"""Contratos de entrada de OLOBOT.

Las respuestas van como `dict` dentro del envoltorio, igual que en admin: son
agregados de siete consultas distintas y un modelo de salida por cada uno sería
duplicar el esquema de la base para no ganar validación —la salida no se valida, se
serializa—.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import Field

from olo.api.v1.schemas import ApiModel


class MensajeIn(ApiModel):
    """Un turno de conversación.

    `conversation_id` ausente significa «empieza una nueva». No se exige crearla
    primero: la primera pregunta ya lleva toda la información necesaria, y un endpoint
    de creación aparte obligaría a dos idas y vueltas para decir «hola».
    """

    message: Annotated[str, Field(min_length=1, max_length=4000)]
    conversation_id: UUID | None = None
    #: El almacén que el usuario tiene activo en la interfaz. Si tiene uno solo, sobra.
    warehouse_id: UUID | None = None


class NivelIn(ApiModel):
    """El nivel de OLOBOT de un usuario.

    `level` es una cadena y no un `Enum` de Pydantic a propósito: el mensaje de error
    de un Enum de Pydantic enumera los valores en inglés y sin explicar qué son. El
    servicio lo valida y responde con los cuatro y su significado.
    """

    level: Annotated[str, Field(min_length=1, max_length=12)]
    #: Por qué se concede. Queda junto al nivel: «para el inventario de fin de mes».
    note: Annotated[str, Field(max_length=300)] | None = None
