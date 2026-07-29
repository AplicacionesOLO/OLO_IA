"""Verificación de JWT emitidos por Supabase Auth.

Qué se espera en el token (DEC-03 y CONF-06). El JWT es **mínimo**:

  sub                              → identidad externa (auth.users.id)
  role                             → siempre "authenticated"
  app_metadata.tenant_id           → tenant activo
  app_metadata.tenant_wide_access  → booleano explícito, default false

Lo que NO va y por qué:
  • core.users.id  — se resuelve por auth_id en la base (CONF-06)
  • warehouse_ids  — revocación diferida y bloat de cabecera
  • permissions    — RF-RBAC-007 exige efecto inmediato; en el token habría
                     hasta una hora de retraso
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

import jwt
from jwt import PyJWKClient

from olo.core.config import Settings, get_settings
from olo.core.errors import InvalidTokenError, NoActiveMembershipError
from olo.core.logging import get_logger

_log = get_logger(__name__)

_jwk_client: PyJWKClient | None = None
_jwk_client_created_at: float = 0.0


def _get_jwk_client(cfg: Settings) -> PyJWKClient:
    """Cliente JWKS con caché propia y TTL.

    `PyJWKClient` ya cachea claves, pero se recrea al expirar el TTL para que
    una rotación de claves en Supabase se recoja sin reiniciar el proceso.
    """
    global _jwk_client, _jwk_client_created_at
    now = time.monotonic()
    if _jwk_client is None or (now - _jwk_client_created_at) > cfg.jwks_cache_ttl_s:
        _jwk_client = PyJWKClient(cfg.jwks_url, cache_keys=True)
        _jwk_client_created_at = now
    return _jwk_client


def decode_token(token: str, cfg: Settings | None = None) -> dict[str, Any]:
    """Verifica firma, expiración y audiencia. Devuelve los claims.

    Cualquier fallo se traduce a `InvalidTokenError`: no se filtra al cliente
    el motivo exacto del rechazo.
    """
    settings = cfg or get_settings()
    options = {"require": ["exp", "sub"]}

    try:
        if settings.jwt_algorithm == "jwks":
            signing_key = _get_jwk_client(settings).get_signing_key_from_jwt(token)
            return jwt.decode(  # type: ignore[no-any-return]
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=settings.jwt_audience,
                options=options,
            )
        if settings.jwt_secret is None:
            msg = "jwt_algorithm=hs256 requiere jwt_secret"
            raise RuntimeError(msg)
        return jwt.decode(  # type: ignore[no-any-return]
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            options=options,
        )
    except jwt.PyJWTError as exc:
        _log.warning("jwt rechazado", extra={"reason": type(exc).__name__})
        raise InvalidTokenError from exc


def extract_identity(claims: dict[str, Any]) -> tuple[UUID, UUID, bool]:
    """Devuelve (auth_user_id, tenant_id, tenant_wide_access).

    Si falta `tenant_id`, la identidad es válida pero no tiene tenant activo:
    se lanza `NoActiveMembershipError` (403), no un 401. El Custom Access Token
    Hook omite los claims propios cuando no hay membresía activa —es su
    comportamiento fail-secure—, así que este caso es esperable y hay que
    responderlo con un mensaje accionable en lugar de dejar que el usuario vea
    una aplicación vacía.
    """
    try:
        auth_user_id = UUID(str(claims["sub"]))
    except (KeyError, ValueError) as exc:
        raise InvalidTokenError("Token without a valid sub claim") from exc

    app_metadata = claims.get("app_metadata") or {}
    raw_tenant = app_metadata.get("tenant_id")
    if not raw_tenant:
        raise NoActiveMembershipError

    try:
        tenant_id = UUID(str(raw_tenant))
    except ValueError as exc:
        raise InvalidTokenError("tenant_id claim is not a valid UUID") from exc

    wide = bool(app_metadata.get("tenant_wide_access", False))
    return auth_user_id, tenant_id, wide
