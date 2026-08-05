"""CLIENTE DE OPENAI — solo `chat/completions` con herramientas.

─────────────────────────────────────────────────────────────────────────────
POR QUÉ httpx Y NO EL SDK

`httpx` ya es dependencia y así se hablan Supabase Auth y Storage en este proyecto.
La superficie que se usa aquí es UN endpoint: `POST /chat/completions`. Añadir el SDK
de OpenAI traería su propio cliente HTTP, su gestión de reintentos y su modelo de
errores para no usar el 95 % de todo eso, y una dependencia más que actualizar.

Si algún día hace falta streaming o la API de asistentes, el SDK se justifica. Hoy no.

─────────────────────────────────────────────────────────────────────────────
LO QUE ESTE MÓDULO NO HACE

No sabe qué es OLOBOT, ni qué es un almacén, ni qué herramientas existen. Recibe
mensajes y descripciones de herramientas, y devuelve lo que el modelo contestó. Toda
la política —el nivel, los permisos, la confirmación— vive en `services/olobot`.

Tampoco reintenta. Un 429 o un 500 del proveedor suben como `LLMError` y el servicio
los traduce a un 503 con un mensaje que el usuario entiende. Reintentar en silencio
duplicaría el coste y dejaría al usuario esperando sin saber por qué.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from olo.core.logging import get_logger

_log = get_logger(__name__)


class LLMError(RuntimeError):
    """Fallo al hablar con el proveedor del modelo."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class LlamadaHerramienta:
    """Una herramienta que el modelo quiere usar.

    `argumentos` llega como TEXTO JSON en la respuesta del modelo y se parsea aquí.
    Un modelo produce JSON inválido de vez en cuando —es texto generado, no una
    estructura—, y cuando pasa vale más un dict vacío con el `id` intacto que una
    excepción: el servicio puede responderle «esos argumentos no se entienden» y el
    modelo lo corrige en el turno siguiente.
    """

    id: str
    nombre: str
    argumentos: dict[str, Any]
    #: `True` si el JSON de argumentos no se pudo leer.
    ilegible: bool = False


@dataclass(frozen=True)
class RespuestaLLM:
    """Lo que contestó el modelo: texto, herramientas que pide, y lo que costó."""

    texto: str | None
    llamadas: tuple[LlamadaHerramienta, ...]
    tokens_in: int
    tokens_out: int
    modelo: str
    #: `tool_calls` tal como vino, para guardarlo en el historial sin reconstruirlo.
    crudo: list[dict[str, Any]] | None


class ChatLLM:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        modelo: str,
        timeout_s: float,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._modelo = modelo
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._timeout = httpx.Timeout(timeout_s, connect=10.0)

    async def completar(
        self,
        mensajes: list[dict[str, Any]],
        herramientas: list[dict[str, Any]] | None = None,
    ) -> RespuestaLLM:
        """Un turno. Devuelve texto, herramientas pedidas, o las dos cosas."""
        cuerpo: dict[str, Any] = {
            "model": self._modelo,
            "messages": mensajes,
            # Baja a propósito. Esto no escribe prosa: responde con cifras del
            # almacén, y la creatividad en una cifra se llama error.
            "temperature": 0.2,
        }
        if herramientas:
            cuerpo["tools"] = herramientas
            cuerpo["tool_choice"] = "auto"

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as c:
                r = await c.post(
                    f"{self._base}/chat/completions", headers=self._headers, json=cuerpo
                )
        except httpx.TimeoutException as exc:
            raise LLMError("El modelo no respondió a tiempo.") from exc
        except httpx.HTTPError as exc:
            raise LLMError(f"No se pudo contactar con el modelo: {exc}") from exc

        if r.status_code >= 400:
            # El cuerpo del error del proveedor NO se propaga al usuario: puede
            # contener detalles de la cuenta, y el usuario no puede hacer nada con
            # ellos. Al log sí, que es donde se diagnostica.
            _log.error(
                "el proveedor del modelo devolvio %s: %s", r.status_code, r.text[:400]
            )
            if r.status_code == 401:
                raise LLMError("La clave del modelo no es válida.", status=401)
            if r.status_code == 429:
                raise LLMError(
                    "El modelo está saturado o se agotó la cuota. Inténtalo en un momento.",
                    status=429,
                )
            raise LLMError("El modelo devolvió un error.", status=r.status_code)

        return self._leer(r.json())

    @staticmethod
    def _leer(datos: dict[str, Any]) -> RespuestaLLM:
        opciones = datos.get("choices") or []
        if not opciones:
            raise LLMError("El modelo respondió sin ninguna opción.")
        mensaje = opciones[0].get("message") or {}
        crudo = mensaje.get("tool_calls")

        llamadas: list[LlamadaHerramienta] = []
        for tc in crudo or []:
            fn = tc.get("function") or {}
            texto_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(texto_args)
                ilegible = False
            except (TypeError, ValueError):
                args, ilegible = {}, True
            llamadas.append(
                LlamadaHerramienta(
                    id=str(tc.get("id") or ""),
                    nombre=str(fn.get("name") or ""),
                    argumentos=args if isinstance(args, dict) else {},
                    ilegible=ilegible,
                )
            )

        uso = datos.get("usage") or {}
        return RespuestaLLM(
            texto=mensaje.get("content"),
            llamadas=tuple(llamadas),
            tokens_in=int(uso.get("prompt_tokens") or 0),
            tokens_out=int(uso.get("completion_tokens") or 0),
            modelo=str(datos.get("model") or ""),
            crudo=crudo,
        )
