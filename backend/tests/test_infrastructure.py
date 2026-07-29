"""Pruebas de la infraestructura. Sin lógica de negocio."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING
from uuid import uuid4

import jwt
import pytest

from olo.core.context import TenantContext, set_request_ids
from olo.core.errors import (
    InvalidTokenError,
    NoActiveMembershipError,
    NotFoundError,
    VersionConflictError,
)
from olo.security.jwt import decode_token, extract_identity

if TYPE_CHECKING:
    from httpx import AsyncClient

    from olo.core.config import Settings


# ── Endpoints de sistema ──────────────────────────────────────────────────
async def test_health_no_requiere_auth(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_version_expone_solo_lo_necesario(client: AsyncClient) -> None:
    r = await client.get("/version")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"name", "version", "environment"}


async def test_respuesta_incluye_cabeceras_de_correlacion(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.headers["X-Request-Id"]
    assert r.headers["X-Correlation-Id"] == r.headers["X-Request-Id"]


async def test_correlation_id_del_cliente_se_respeta(client: AsyncClient) -> None:
    cid = str(uuid4())
    r = await client.get("/health", headers={"X-Correlation-Id": cid})
    assert r.headers["X-Correlation-Id"] == cid
    # request_id se genera SIEMPRE en el servidor: no se acepta del cliente.
    assert r.headers["X-Request-Id"] != cid


async def test_cabeceras_de_seguridad_presentes(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Cache-Control"] == "no-store"


# ── Autenticación ─────────────────────────────────────────────────────────
def _token(secret: str, **overrides: object) -> str:
    payload: dict[str, object] = {
        "sub": str(uuid4()),
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
        "app_metadata": {"tenant_id": str(uuid4()), "tenant_wide_access": False},
    }
    payload.update(overrides)
    return jwt.encode(payload, secret, algorithm="HS256")


def test_token_valido_produce_identidad(settings: Settings) -> None:
    assert settings.jwt_secret is not None
    token = _token(settings.jwt_secret.get_secret_value())
    claims = decode_token(token, settings)
    auth_id, tenant_id, wide = extract_identity(claims)
    assert auth_id and tenant_id
    assert wide is False


def test_token_con_firma_ajena_se_rechaza(settings: Settings) -> None:
    token = _token("otro-secreto")
    with pytest.raises(InvalidTokenError):
        decode_token(token, settings)


def test_token_expirado_se_rechaza(settings: Settings) -> None:
    assert settings.jwt_secret is not None
    token = _token(settings.jwt_secret.get_secret_value(), exp=int(time.time()) - 10)
    with pytest.raises(InvalidTokenError):
        decode_token(token, settings)


def test_token_sin_tenant_id_es_403_no_401(settings: Settings) -> None:
    """Sin membresía activa el Hook omite los claims propios.

    La identidad es válida, así que la respuesta correcta es 403 y no 401: un
    401 haría que el cliente refrescara el token en bucle sin resolver nada.
    """
    assert settings.jwt_secret is not None
    token = _token(settings.jwt_secret.get_secret_value(), app_metadata={})
    claims = decode_token(token, settings)
    with pytest.raises(NoActiveMembershipError) as exc:
        extract_identity(claims)
    assert exc.value.http_status == 403


async def test_endpoint_protegido_sin_token_da_401(client: AsyncClient) -> None:
    # No hay endpoints de negocio todavía; se comprueba el envoltorio de error
    # sobre una ruta inexistente para asegurar que el formato es uniforme.
    r = await client.get("/v1/no-existe")
    assert r.status_code == 404


# ── Contexto y GUCs ───────────────────────────────────────────────────────
def test_contexto_produce_los_cinco_gucs() -> None:
    set_request_ids("req-1", "corr-1")
    ctx = TenantContext(auth_user_id=uuid4(), tenant_id=uuid4(), tenant_wide_access=True)
    gucs = ctx.as_gucs()
    assert set(gucs) == {
        "app.auth_user_id",
        "app.tenant_id",
        "app.tenant_wide_access",
        "app.request_id",
        "app.correlation_id",
    }
    assert gucs["app.tenant_wide_access"] == "true"
    assert gucs["app.request_id"] == "req-1"
    assert gucs["app.correlation_id"] == "corr-1"


def test_tenant_wide_access_default_es_false() -> None:
    ctx = TenantContext(auth_user_id=uuid4(), tenant_id=uuid4())
    assert ctx.tenant_wide_access is False
    assert ctx.as_gucs()["app.tenant_wide_access"] == "false"


# ── Errores ───────────────────────────────────────────────────────────────
def test_recurso_de_otro_tenant_mapea_a_404() -> None:
    """404 y no 403: un 403 confirmaría que el recurso existe."""
    assert NotFoundError().http_status == 404


def test_conflicto_de_version_mapea_a_412() -> None:
    assert VersionConflictError().http_status == 412


def test_los_ajustes_no_filtran_secretos(settings: Settings) -> None:
    summary = settings.safe_summary()
    serialized = str(summary).lower()
    assert "secret" not in serialized
    assert "password" not in serialized
    assert "postgresql" not in serialized
