"""El cliente del modelo de lenguaje.

Aparte de `services/olobot` a propósito: el servicio decide QUÉ preguntar y qué hacer
con la respuesta; esto solo habla HTTP con el proveedor. Cambiar de proveedor debería
tocar este paquete y nada más.
"""

from olo.llm.openai import ChatLLM, LlamadaHerramienta, LLMError, RespuestaLLM

__all__ = ["ChatLLM", "LLMError", "LlamadaHerramienta", "RespuestaLLM"]
