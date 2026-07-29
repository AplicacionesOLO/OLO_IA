"""Cliente de Supabase Auth (GoTrue).

El backend **no** implementa autenticación: la delega. Lo que sí hace es ser el
único punto por el que pasa, para poder auditar el intento y devolver errores
con el formato del resto de la API.

La `anon key` va aquí y nunca al frontend a través de estos endpoints: el
frontend podría hablar con GoTrue directamente, pero entonces el backend no
vería los intentos de acceso y la auditoría de autenticación quedaría ciega.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import httpx

from olo.core.errors import OloError, UnauthenticatedError
from olo.core.logging import get_logger

if TYPE_CHECKING:
    from olo.core.config import Settings

_log = get_logger(__name__)
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class AuthProviderError(OloError):
    """Fallo del proveedor de identidad, no del usuario."""

    code = "AUTH_PROVIDER_UNAVAILABLE"
    http_status = 503
    message = "El proveedor de identidad no está disponible"


class InvalidCredentialsError(UnauthenticatedError):
    code = "INVALID_CREDENTIALS"
    message = "Email o contraseña incorrectos"


@dataclass(frozen=True, slots=True)
class TokenPair:
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    expires_at: int


def _to_pair(data: dict[str, Any]) -> TokenPair:
    return TokenPair(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        token_type=data.get("token_type", "bearer"),
        expires_in=int(data.get("expires_in", 3600)),
        expires_at=int(data.get("expires_at", 0)),
    )


class SupabaseAuthClient:
    def __init__(self, settings: Settings) -> None:
        if settings.supabase_anon_key is None:
            msg = "SUPABASE_ANON_KEY es obligatoria para los endpoints de autenticación"
            raise AuthProviderError(msg)
        self._base = f"{settings.supabase_url}/auth/v1"
        self._key = settings.supabase_anon_key.get_secret_value()

    def _headers(self) -> dict[str, str]:
        return {"apikey": self._key, "Content-Type": "application/json"}

    async def _post(self, path: str, payload: dict[str, Any], *, token: str | None = None) -> Any:  # noqa: ANN401
        headers = self._headers()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                response = await client.post(f"{self._base}{path}", json=payload, headers=headers)
        except httpx.HTTPError as exc:
            _log.error("gotrue inalcanzable", extra={"path": path, "exc": type(exc).__name__})
            raise AuthProviderError from exc

        if response.status_code in (400, 401, 403):
            # No se propaga el mensaje de GoTrue: distinguir «email inexistente»
            # de «contraseña incorrecta» permite enumerar cuentas.
            _log.info("credenciales rechazadas", extra={"status": response.status_code})
            raise InvalidCredentialsError
        if response.status_code == 429:
            from olo.core.errors import RateLimitedError

            raise RateLimitedError("Demasiados intentos de autenticación")
        if response.status_code >= 500:
            raise AuthProviderError
        return response.json()

    async def sign_in(self, email: str, password: str) -> TokenPair:
        """Contraseña. El Hook añade tenant_id al emitir el token.

        Si el usuario no tiene membresía activa, el login **tiene éxito** pero el
        token sale sin `tenant_id`: es el comportamiento fail-secure del Hook. El
        middleware lo detecta después y responde 403 NO_ACTIVE_MEMBERSHIP.
        """
        data = await self._post(
            "/token?grant_type=password", {"email": email, "password": password}
        )
        return _to_pair(data)

    async def refresh(self, refresh_token: str) -> TokenPair:
        """Rota el refresh token y **reinvoca el Hook**.

        Es el momento en que se recalculan `tenant_id` y `tenant_wide_access`, así
        que revocar una membresía surte efecto como máximo en una hora. Los
        permisos, en cambio, son inmediatos: no viajan en el token.
        """
        data = await self._post(
            "/token?grant_type=refresh_token", {"refresh_token": refresh_token}
        )
        return _to_pair(data)

    async def sign_out(self, access_token: str) -> None:
        """Invalida el refresh token en GoTrue.

        El access token sigue siendo válido hasta que expire —es la naturaleza de
        un JWT sin lista de revocación—, así que el cliente debe descartarlo.
        """
        await self._post("/logout", {}, token=access_token)
