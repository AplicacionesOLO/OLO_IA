"""Pruebas del primer módulo de negocio, sin base de datos.

Cubren todo lo que ocurre ANTES de tocar la base: autenticación, extracción de
contexto, validación de entrada y forma de los errores. Las pruebas que
necesitan base llevan la marca `integration` y no están aquí.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import jwt
import pytest

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

    from fastapi import FastAPI
    from httpx import AsyncClient

    from olo.core.config import Settings


def make_token(settings: Settings, **overrides: Any) -> str:
    assert settings.jwt_secret is not None
    payload: dict[str, Any] = {
        "sub": str(uuid4()),
        "aud": settings.jwt_audience,
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
        "app_metadata": {"tenant_id": str(uuid4()), "tenant_wide_access": False},
    }
    payload.update(overrides)
    return jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm="HS256")


@pytest.fixture
def auth(settings: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(settings)}"}


# ── El endpoint existe y está protegido ───────────────────────────────────
async def test_endpoints_expuestos(client: AsyncClient) -> None:
    spec = (await client.get("/openapi.json")).json()
    paths = spec["paths"]
    assert "/v1/warehouses" in paths
    assert "/v1/warehouses/{warehouse_id}" in paths
    assert "/v1/auth/me" in paths
    assert set(paths["/v1/warehouses"]) == {"get", "post"}


@pytest.mark.parametrize("path", ["/v1/warehouses", "/v1/auth/me"])
async def test_sin_token_es_401(client: AsyncClient, path: str) -> None:
    r = await client.get(path)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_token_basura_es_401(client: AsyncClient) -> None:
    r = await client.get("/v1/warehouses", headers={"Authorization": "Bearer basura"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_TOKEN"


async def test_token_expirado_es_401(client: AsyncClient, settings: Settings) -> None:
    token = make_token(settings, exp=int(time.time()) - 5)
    r = await client.get("/v1/warehouses", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_TOKEN"


async def test_token_sin_tenant_es_403(client: AsyncClient, settings: Settings) -> None:
    """403 y no 401: la identidad vale, lo que falta es la membresía.

    Un 401 haría que el cliente refrescara el token en bucle sin resolver nada.
    """
    token = make_token(settings, app_metadata={})
    r = await client.get("/v1/warehouses", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "NO_ACTIVE_MEMBERSHIP"


async def test_warehouse_id_malformado_es_403(client: AsyncClient, auth: dict[str, str]) -> None:
    r = await client.get("/v1/warehouses", headers={**auth, "X-Warehouse-Id": "no-es-uuid"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "WAREHOUSE_NOT_ACCESSIBLE"


# ── Validación de entrada ─────────────────────────────────────────────────
#
# Estas tres pruebas estaban marcadas `integration` y usaban el `client`
# unitario, cuyos ajustes son ficticios. Pasaban solo cuando otro módulo había
# inicializado antes el motor GLOBAL —apuntando a Supabase real—, así que su
# resultado dependía del orden de ejecución: en solitario fallaban con
# `DatabaseUnavailableError`. Era estado global filtrado entre módulos, no
# cobertura.
#
# Lo que comprueban es validación, no persistencia, así que se sustituye
# `get_session` y pasan a la suite unitaria.
#
# ⚠ HECHO MEDIDO al hacerlo, contraintuitivo y que conviene tener anotado:
#   FastAPI resuelve TODAS las dependencias —incluidas las de ruta— antes de
#   validar la petición. Se comprobó sustituyendo `get_session` por una versión
#   que estalla al invocarse: estalló en las tres pruebas. Después, con una
#   sesión inerte, el fallo se movió a `require_permission`, que también corre
#   antes.
#
#   Es decir, un `GET /v1/warehouses?limit=5000` —rechazado de plano— llega a
#   tomar conexión del pool, fijar los cinco GUCs, verificar la membresía y
#   resolver los permisos antes de responder 400.
#
#   Para la SEGURIDAD el orden es el correcto: autorizar antes de validar evita
#   que quien no tiene permiso averigüe la forma exacta del esquema de entrada
#   probando payloads. El coste es que una petición malformada consume conexión
#   y varios viajes a la base. Invertirlo exigiría mover la adquisición de sesión
#   al cuerpo de cada endpoint, así que se deja como está, documentado.
#
#   Consecuencia para estas pruebas: hay que neutralizar las dos cosas. La sesión
#   es inerte porque el endpoint nunca llega a ejecutarse; el permiso se concede
#   sin consultar, porque lo que se está probando es la validación.


@pytest.fixture
def no_db(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from olo.api.deps import get_session

    async def _sesion_inerte() -> AsyncIterator[None]:
        yield None

    async def _permiso_concedido(*_args: object, **_kwargs: object) -> None:
        return None

    # `require()` importa `require_permission` dentro del cuerpo, así que se
    # parchea en el módulo de origen y no en `olo.api.deps`.
    monkeypatch.setattr(
        "olo.security.authorization.require_permission", _permiso_concedido
    )
    app.dependency_overrides[get_session] = _sesion_inerte
    yield
    app.dependency_overrides.clear()


@pytest.mark.usefixtures("no_db")
async def test_post_rechaza_payload_invalido(client: AsyncClient, auth: dict[str, str]) -> None:
    r = await client.post(
        "/v1/warehouses",
        headers=auth,
        json={
            "company_id": str(uuid4()),
            "name": "X",                   # menos de 2 caracteres
            "code": "wh 001",              # espacio no permitido
            "timezone": "Marte/Olympus",   # zona inexistente
        },
    )
    assert r.status_code == 400
    body = r.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    campos = {e["field"] for e in body["details"]["errors"]}
    assert {"name", "code", "timezone"} <= campos


@pytest.mark.usefixtures("no_db")
async def test_post_rechaza_campos_desconocidos(client: AsyncClient, auth: dict[str, str]) -> None:
    """`extra="forbid"`: un campo de más suele ser un error de integración.

    Aceptarlo en silencio hace que el cliente crea que envió algo que el
    servidor ignoró.
    """
    r = await client.post(
        "/v1/warehouses",
        headers=auth,
        json={
            "company_id": str(uuid4()),
            "name": "Centro de Distribucion",
            "code": "WH-001",
            "timezone": "America/Costa_Rica",
            "tenant_id": str(uuid4()),   # el cliente NUNCA fija el tenant
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.usefixtures("no_db")
async def test_limit_fuera_de_rango_es_400(client: AsyncClient, auth: dict[str, str]) -> None:
    r = await client.get("/v1/warehouses?limit=5000", headers=auth)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


# ── Errores con correlación ───────────────────────────────────────────────
async def test_error_incluye_request_id(client: AsyncClient) -> None:
    r = await client.get("/v1/warehouses")
    body = r.json()["error"]
    assert body["request_id"] == r.headers["X-Request-Id"]
    assert body["correlation_id"] == r.headers["X-Correlation-Id"]


# ── El dominio valida antes de llegar a la base ───────────────────────────
def test_dominio_rechaza_una_sola_coordenada() -> None:
    from datetime import UTC, datetime

    from olo.domain.warehouse import DomainRuleError, Warehouse, WarehouseStatus

    now = datetime.now(UTC)
    with pytest.raises(DomainRuleError, match="juntas"):
        Warehouse(
            id=uuid4(), tenant_id=uuid4(), company_id=uuid4(),
            name="Centro", code="WH-001", status=WarehouseStatus.ACTIVE,
            timezone="UTC", locale="es", version=1, created_at=now, updated_at=now,
            latitude=9.93,   # sin longitude
        )


def test_dominio_rechaza_codigo_en_minusculas() -> None:
    from datetime import UTC, datetime

    from olo.domain.warehouse import DomainRuleError, Warehouse, WarehouseStatus

    now = datetime.now(UTC)
    with pytest.raises(DomainRuleError, match="código"):
        Warehouse(
            id=uuid4(), tenant_id=uuid4(), company_id=uuid4(),
            name="Centro", code="wh-001", status=WarehouseStatus.ACTIVE,
            timezone="UTC", locale="es", version=1, created_at=now, updated_at=now,
        )


def test_cursor_de_paginacion_es_reversible() -> None:
    from olo.services.warehouse import _decode_cursor, _encode_cursor

    code, entity_id = "WH-001", uuid4()
    assert _decode_cursor(_encode_cursor(code, entity_id)) == (code, entity_id)


def test_cursor_invalido_da_error_de_negocio() -> None:
    from olo.core.errors import BusinessRuleError
    from olo.services.warehouse import _decode_cursor

    with pytest.raises(BusinessRuleError):
        _decode_cursor("no-es-un-cursor-valido!!!")
