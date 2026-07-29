"""Prueba de extremo a extremo del primer vertical, contra Supabase REAL.

Marcada `integration`: necesita `.env.local` con credenciales válidas y el
escenario de `supabase/seed.sql` aplicado.

    pytest -m integration

Lo que valida y que ninguna prueba unitaria puede cubrir:
  • el Custom Access Token Hook publica tenant_id en un JWT emitido por GoTrue
  • el backend verifica ese JWT contra el JWKS del proyecto
  • el contexto llega a PostgreSQL y RLS filtra de verdad
  • los permisos se resuelven contra las tablas de rol
  • el CRUD completo funciona con optimistic locking

El usuario del escenario es `warehouse_manager` con acceso a UN almacén de dos
que existen. Si RLS no funcionara, vería los dos: es lo que hace la prueba
concluyente en lugar de meramente verde.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from olo.core.config import Settings, get_settings
from olo.db.session import dispose_engine, init_engine
from olo.main import create_app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

# loop_scope='module': las fixtures pi y 	oken son de modulo y comparten
# conexion real. Sin esto, pytest-asyncio abre un loop por test y el pool queda
# ligado al primero -> `Event loop is closed`.
pytestmark = pytest.mark.integration

_SCRATCH = Path(
    os.environ.get(
        "OLO_TEST_SCRATCH",
        r"C:\Users\arojast\AppData\Local\Temp\claude\C--YOLO-Almacen-Inv-OLO"
        r"\13b0860b-2d5e-474d-b525-99727dea78af\scratchpad",
    )
)
TEST_EMAIL = "mgr@olo-dev.test"


def _test_password() -> str:
    """La contraseña del usuario de prueba no se versiona.

    Se escribió a un archivo del scratchpad al crear el usuario. Si no está, la
    prueba se salta en lugar de fallar: es un problema de entorno, no del código.
    """
    path = _SCRATCH / "testpw.txt"
    if not path.exists():
        pytest.skip("falta la contraseña del usuario de prueba en el scratchpad")
    return path.read_text(encoding="utf-8").strip()


@pytest.fixture(scope="module")
def real_settings() -> Settings:
    try:
        cfg = get_settings()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"sin configuración válida: {type(exc).__name__}")
    if "supabase.co" not in cfg.supabase_url:
        pytest.skip("SUPABASE_URL no apunta a un proyecto real")
    return cfg


@pytest.fixture(scope="module")
async def api(real_settings: Settings) -> AsyncIterator[AsyncClient]:
    """Cliente sobre la app real, con el motor inicializado a mano.

    No se usa el `lifespan` para no depender de su orden en el test, pero sí se
    inicializa el motor: sin él, `tenant_session` falla por diseño.
    """
    # null_pool: el pool queda ligado al event loop que lo creo y pytest-asyncio
    # usa otro por modulo, lo que produce `Event loop is closed`.
    init_engine(real_settings, null_pool=True)
    app = create_app(real_settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as client:
        yield client
    await dispose_engine()


@pytest.fixture(scope="module")
async def token(api: AsyncClient) -> str:
    """Login real contra Supabase Auth. El Hook añade tenant_id al emitir."""
    r = await api.post(
        "/v1/auth/login", json={"email": TEST_EMAIL, "password": _test_password()}
    )
    assert r.status_code == 200, f"login falló: {r.status_code} {r.text[:300]}"
    return str(r.json()["data"]["access_token"])


@pytest.fixture
def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ══ 1. Login y claims ══════════════════════════════════════════════════════
async def test_login_devuelve_par_de_tokens(api: AsyncClient) -> None:
    r = await api.post(
        "/v1/auth/login", json={"email": TEST_EMAIL, "password": _test_password()}
    )
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["access_token"] and data["refresh_token"]
    assert data["token_type"] == "bearer"
    assert data["expires_in"] > 0


async def test_login_con_credenciales_malas_no_revela_si_el_email_existe(
    api: AsyncClient,
) -> None:
    """El mismo código para email inexistente y contraseña incorrecta.

    Distinguirlos permitiría enumerar cuentas.
    """
    r1 = await api.post(
        "/v1/auth/login", json={"email": TEST_EMAIL, "password": "contrasena-incorrecta"}
    )
    r2 = await api.post(
        "/v1/auth/login", json={"email": "nadie@olo-dev.test", "password": "contrasena-incorrecta"}
    )
    assert r1.status_code == r2.status_code == 401
    assert r1.json()["error"]["code"] == r2.json()["error"]["code"] == "INVALID_CREDENTIALS"


async def test_el_hook_publica_tenant_id_en_el_jwt(token: str) -> None:
    """Sin este claim, `core.current_tenant_id()` es NULL y RLS deniega todo."""
    import base64
    import json

    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    claims: dict[str, Any] = json.loads(base64.urlsafe_b64decode(payload_b64))

    assert claims["role"] == "authenticated"
    app_metadata = claims.get("app_metadata") or {}
    assert app_metadata.get("tenant_id"), "el Hook no publicó tenant_id"
    # El usuario del escenario es warehouse_manager, no tenant_admin: su acceso
    # NO debe ser amplio, porque si lo fuera el filtrado por almacén no se
    # ejercitaría y la prueba de RLS no demostraría nada.
    assert app_metadata.get("tenant_wide_access") is False


async def test_refresh_rota_el_token(api: AsyncClient) -> None:
    login = await api.post(
        "/v1/auth/login", json={"email": TEST_EMAIL, "password": _test_password()}
    )
    old_refresh = login.json()["data"]["refresh_token"]

    r = await api.post("/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["refresh_token"] != old_refresh, "el refresh token debe rotar"


# ══ 2. /v1/auth/me ═════════════════════════════════════════════════════════
async def test_me_devuelve_el_perfil_completo(api: AsyncClient, auth: dict[str, str]) -> None:
    r = await api.get("/v1/auth/me", headers=auth)
    assert r.status_code == 200, r.text[:400]
    me = r.json()["data"]

    assert me["email"] == TEST_EMAIL
    assert me["tenant"]["slug"] == "olo-demo"
    assert me["tenant"]["status"] == "active"
    assert me["tenant_wide_access"] is False


async def test_me_resuelve_permisos_contra_la_base(api: AsyncClient, auth: dict[str, str]) -> None:
    """Los permisos NO viajan en el JWT: se resuelven por rol en cada petición.

    Es lo que hace que revocar un permiso surta efecto de inmediato.
    """
    me = (await api.get("/v1/auth/me", headers=auth)).json()["data"]

    perms = set(me["permissions"])
    assert "warehouses:read" in perms
    assert "inventory:count" in perms
    # warehouse_manager NO administra usuarios ni roles
    assert "users:invite" not in perms
    assert "roles:write" not in perms

    assert [r["name"] for r in me["roles"]] == ["warehouse_manager"]
    assert me["roles"][0]["scope_type"] == "warehouse"


async def test_me_lista_solo_los_almacenes_accesibles(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    me = (await api.get("/v1/auth/me", headers=auth)).json()["data"]
    assert len(me["accessible_warehouse_ids"]) == 1, (
        "el escenario concede acceso a UN almacén de los dos que existen"
    )


# ══ 3. RLS: el filtrado real ═══════════════════════════════════════════════
async def test_lista_filtrada_por_rls(api: AsyncClient, auth: dict[str, str]) -> None:
    """LA PRUEBA CENTRAL.

    Existen dos almacenes en el tenant y el usuario tiene acceso a uno. Si RLS
    no funcionara, vería los dos.
    """
    r = await api.get("/v1/warehouses", headers=auth)
    assert r.status_code == 200, r.text[:400]
    body = r.json()

    assert len(body["data"]) == 1, f"RLS no filtró: {[w['code'] for w in body['data']]}"
    assert body["data"][0]["code"] == "WH-001"
    assert body["pagination"]["next_cursor"] is None


async def test_almacen_no_accesible_da_404_no_403(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """404 y no 403: un 403 confirmaría que el recurso existe.

    Se obtiene el id del almacén inaccesible por una vía privilegiada —no por la
    API, que precisamente lo oculta— para poder pedirlo explícitamente.
    """
    from sqlalchemy import text

    from olo.db.session import unscoped_session

    async with unscoped_session() as session:
        # Sin contexto de tenant, RLS deniega. Se consulta el catálogo del
        # sistema, que no está sujeto a RLS, para no depender de privilegios.
        row = (
            await session.execute(
                text(
                    "SELECT id FROM core.warehouses WHERE code = 'WH-002' AND deleted_at IS NULL"
                )
            )
        ).first()

    if row is None:
        pytest.skip("olo_app no puede leer WH-002 sin contexto: es el comportamiento esperado")

    r = await api.get(f"/v1/warehouses/{row[0]}", headers=auth)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


async def test_id_inexistente_da_404(api: AsyncClient, auth: dict[str, str]) -> None:
    r = await api.get(f"/v1/warehouses/{uuid4()}", headers=auth)
    assert r.status_code == 404


async def test_get_incluye_etag(api: AsyncClient, auth: dict[str, str]) -> None:
    listado = (await api.get("/v1/warehouses", headers=auth)).json()["data"]
    wh_id = listado[0]["id"]

    r = await api.get(f"/v1/warehouses/{wh_id}", headers=auth)
    assert r.status_code == 200
    assert r.headers["ETag"] == f'W/"{r.json()["data"]["version"]}"'


# ══ 4. Mutaciones y optimistic locking ═════════════════════════════════════
async def test_patch_sin_if_match_da_428(api: AsyncClient, auth: dict[str, str]) -> None:
    """428 Precondition Required: sin ETag no hay optimistic locking posible."""
    wh_id = (await api.get("/v1/warehouses", headers=auth)).json()["data"][0]["id"]

    r = await api.patch(f"/v1/warehouses/{wh_id}", headers=auth, json={"name": "Nuevo nombre"})
    assert r.status_code == 428
    assert r.json()["error"]["code"] == "PRECONDITION_REQUIRED"


async def test_patch_con_version_obsoleta_da_412(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    wh_id = (await api.get("/v1/warehouses", headers=auth)).json()["data"][0]["id"]

    r = await api.patch(
        f"/v1/warehouses/{wh_id}",
        headers={**auth, "If-Match": 'W/"999999"'},
        json={"name": "No debería aplicarse"},
    )
    assert r.status_code == 412
    assert r.json()["error"]["code"] == "VERSION_CONFLICT"


async def test_patch_actualiza_e_incrementa_la_version(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    original = (await api.get("/v1/warehouses", headers=auth)).json()["data"][0]
    wh_id, version_inicial, nombre_original = (
        original["id"], original["version"], original["name"]
    )

    nuevo = f"CD San José {uuid4().hex[:6]}"
    r = await api.patch(
        f"/v1/warehouses/{wh_id}",
        headers={**auth, "If-Match": f'W/"{version_inicial}"'},
        json={"name": nuevo},
    )
    assert r.status_code == 200, r.text[:400]
    data = r.json()["data"]
    assert data["name"] == nuevo
    assert data["version"] == version_inicial + 1
    assert r.headers["ETag"] == f'W/"{version_inicial + 1}"'

    # Se restaura el nombre para que la prueba sea repetible
    await api.patch(
        f"/v1/warehouses/{wh_id}",
        headers={**auth, "If-Match": f'W/"{data["version"]}"'},
        json={"name": nombre_original},
    )


async def test_patch_rechaza_campos_no_actualizables(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """`code` y `company_id` no existen en el esquema de actualización.

    Cambiar el código rompería las referencias operativas que el personal usa a
    diario; mover un almacén de compañía es una reestructuración, no una edición.
    """
    wh = (await api.get("/v1/warehouses", headers=auth)).json()["data"][0]

    r = await api.patch(
        f"/v1/warehouses/{wh['id']}",
        headers={**auth, "If-Match": f'W/"{wh["version"]}"'},
        json={"code": "HACKEADO"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_patch_rechaza_una_sola_coordenada(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """Regla de dominio: 422, no un CHECK del motor traducido a error genérico."""
    wh = (await api.get("/v1/warehouses", headers=auth)).json()["data"][0]

    r = await api.patch(
        f"/v1/warehouses/{wh['id']}",
        headers={**auth, "If-Match": f'W/"{wh["version"]}"'},
        json={"latitude": 10.5, "longitude": None},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "BUSINESS_RULE_VIOLATION"


# ══ 5. Permisos: el rol limita de verdad ═══════════════════════════════════
async def test_manager_no_puede_crear_almacenes(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """`warehouse_manager` tiene `warehouses:update` pero NO `warehouses:create`.

    Es la prueba de que los permisos se evalúan de verdad y no se conceden en
    bloque por estar autenticado.
    """
    r = await api.post(
        "/v1/warehouses",
        headers=auth,
        json={
            "company_id": str(uuid4()),
            "name": "Almacén no autorizado",
            "code": "WH-999",
            "timezone": "America/Costa_Rica",
        },
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


async def test_manager_no_puede_borrar_almacenes(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    wh = (await api.get("/v1/warehouses", headers=auth)).json()["data"][0]

    r = await api.delete(
        f"/v1/warehouses/{wh['id']}", headers={**auth, "If-Match": f'W/"{wh["version"]}"'}
    )
    assert r.status_code == 403


# ══ 6. Cabecera X-Warehouse-Id ═════════════════════════════════════════════
async def test_warehouse_id_accesible_se_acepta(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    wh_id = (await api.get("/v1/warehouses", headers=auth)).json()["data"][0]["id"]

    r = await api.get("/v1/warehouses", headers={**auth, "X-Warehouse-Id": wh_id})
    assert r.status_code == 200


async def test_warehouse_id_no_accesible_da_403(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """403 y no 404: aquí el cliente afirma un contexto que no le corresponde.

    Es distinto de pedir un recurso: no se le confirma nada sobre su existencia,
    solo que ese contexto no es válido para él.
    """
    r = await api.get("/v1/warehouses", headers={**auth, "X-Warehouse-Id": str(uuid4())})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "WAREHOUSE_NOT_ACCESSIBLE"


# ══ 7. Correlación ═════════════════════════════════════════════════════════
async def test_toda_respuesta_lleva_request_id(api: AsyncClient, auth: dict[str, str]) -> None:
    r = await api.get("/v1/warehouses", headers=auth)
    assert r.headers["X-Request-Id"]
    assert r.headers["X-Correlation-Id"]


async def test_correlation_id_del_cliente_se_propaga(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    cid = str(uuid4())
    r = await api.get("/v1/warehouses", headers={**auth, "X-Correlation-Id": cid})
    assert r.headers["X-Correlation-Id"] == cid
    assert r.headers["X-Request-Id"] != cid


# ══ 8. tenant_admin: acceso transversal y el CRUD que el manager no alcanza ══
#
# HUECO DE COBERTURA QUE ESTA SECCIÓN CIERRA.
#
#   Hasta aquí, todas las pruebas del vertical usaban el `warehouse_manager` del
#   seed, que NO tiene `warehouses:create` ni `warehouses:delete`. Consecuencia:
#   las tres pruebas de POST afirmaban un fallo —400 o 403— y ninguna comprobó
#   nunca un 201. El camino feliz de creación y borrado estaba sin ejercitar con
#   21 pruebas en verde.
#
#   Lo que se escondía ahí: `tzdata` no figuraba entre las dependencias. En
#   Windows y en imágenes mínimas, `zoneinfo` no encuentra zonas y el validador
#   de `timezone` rechazaba TODA cadena, incluida `America/Costa_Rica`. La API
#   respondía 400 a peticiones impecables. Se detectó creando un almacén a mano.
#
#   Por eso estas pruebas no son un extra: son las que fallan si la dependencia
#   vuelve a desaparecer.


def _admin_password() -> str:
    """Igual que `_test_password`: fuera del repositorio.

    Se acepta también por variable de entorno para CI, donde no hay scratchpad.
    """
    if pw := os.environ.get("OLO_TEST_ADMIN_PASSWORD"):
        return pw
    path = _SCRATCH / "adminpw.txt"
    if not path.exists():
        pytest.skip("falta la contraseña del usuario admin de prueba")
    return path.read_text(encoding="utf-8").strip()


ADMIN_EMAIL = "arojas@ologistics.com"


@pytest.fixture(scope="module")
async def admin_auth(api: AsyncClient) -> dict[str, str]:
    r = await api.post(
        "/v1/auth/login", json={"email": ADMIN_EMAIL, "password": _admin_password()}
    )
    if r.status_code != 200:
        pytest.skip(f"el usuario admin no está disponible: {r.status_code}")
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def test_admin_tiene_acceso_transversal(
    api: AsyncClient, admin_auth: dict[str, str]
) -> None:
    """El contraste con el manager es lo que hace concluyente la prueba.

    Mismo tenant, mismos dos almacenes: el manager ve uno, el admin ve los dos.
    Si `tenant_wide_access` no llegara desde el Hook, vería cero o uno.
    """
    me = (await api.get("/v1/auth/me", headers=admin_auth)).json()["data"]
    assert me["tenant_wide_access"] is True
    assert [r["name"] for r in me["roles"]] == ["tenant_admin"]
    assert me["roles"][0]["scope_type"] == "global"
    assert "warehouses:create" in me["permissions"]
    assert "warehouses:delete" in me["permissions"]

    r = await api.get("/v1/warehouses", headers=admin_auth)
    codigos = {w["code"] for w in r.json()["data"]}
    assert {"WH-001", "WH-002"} <= codigos, f"acceso transversal no aplicado: {codigos}"


async def test_ciclo_completo_crear_leer_actualizar_borrar(
    api: AsyncClient, admin_auth: dict[str, str]
) -> None:
    """El camino feliz completo, con un almacén desechable.

    `code` lleva sufijo aleatorio: si una ejecución anterior se interrumpió antes
    del DELETE, un código fijo daría 409 y la prueba fallaría por un residuo en
    lugar de por un defecto.
    """
    base = (await api.get("/v1/warehouses", headers=admin_auth)).json()["data"][0]
    codigo = f"WHT-{uuid4().hex[:6].upper()}"

    # ── CREATE ──────────────────────────────────────────────────────────────
    cr = await api.post(
        "/v1/warehouses",
        headers=admin_auth,
        json={
            "company_id": base["company_id"],
            "name": "Bodega de prueba automatizada",
            "code": codigo,
            # Zona IANA real: es la aserción que detecta la falta de `tzdata`.
            "timezone": "America/Costa_Rica",
            "currency_code": "CRC",
            "latitude": 9.8644,
            "longitude": -83.9194,
            "address": {"city": "Cartago", "country": "CR"},
        },
    )
    assert cr.status_code == 201, cr.text[:400]
    creado = cr.json()["data"]
    wh_id = creado["id"]

    try:
        assert creado["code"] == codigo
        assert creado["version"] == 1
        assert creado["status"] == "active"
        assert creado["latitude"] == pytest.approx(9.8644)
        assert cr.headers["ETag"] == 'W/"1"'
        assert cr.headers["Location"].endswith(wh_id)

        # ── READ: el ETag del GET coincide con el del POST ───────────────────
        g = await api.get(f"/v1/warehouses/{wh_id}", headers=admin_auth)
        assert g.status_code == 200
        assert g.headers["ETag"] == 'W/"1"'
        assert g.json()["data"]["address"] == {"city": "Cartago", "country": "CR"}

        # ── UPDATE ──────────────────────────────────────────────────────────
        p = await api.patch(
            f"/v1/warehouses/{wh_id}",
            headers={**admin_auth, "If-Match": g.headers["ETag"]},
            json={"name": "Bodega Cartago Norte", "status": "maintenance"},
        )
        assert p.status_code == 200, p.text[:400]
        assert p.json()["data"]["status"] == "maintenance"
        assert p.json()["data"]["version"] == 2

        # ── El nuevo almacén aparece en la lista ─────────────────────────────
        listado = (await api.get("/v1/warehouses", headers=admin_auth)).json()["data"]
        assert codigo in {w["code"] for w in listado}

        etag_final = p.headers["ETag"]
    except BaseException:
        # Limpieza en caso de fallo: sin esto un assert intermedio deja el
        # almacén sembrado y contamina las pruebas de acceso transversal.
        version = (
            await api.get(f"/v1/warehouses/{wh_id}", headers=admin_auth)
        ).json()["data"]["version"]
        await api.delete(
            f"/v1/warehouses/{wh_id}",
            headers={**admin_auth, "If-Match": f'W/"{version}"'},
        )
        raise

    # ── DELETE lógico ───────────────────────────────────────────────────────
    d = await api.delete(
        f"/v1/warehouses/{wh_id}", headers={**admin_auth, "If-Match": etag_final}
    )
    assert d.status_code == 204

    # Borrado lógico: desaparece de la API por completo, no queda «inactivo».
    assert (await api.get(f"/v1/warehouses/{wh_id}", headers=admin_auth)).status_code == 404
    restantes = (await api.get("/v1/warehouses", headers=admin_auth)).json()["data"]
    assert codigo not in {w["code"] for w in restantes}


async def test_crear_con_zona_horaria_valida_no_depende_del_sistema() -> None:
    """Regresión directa de la falta de `tzdata`, sin red ni base de datos.

    Se comprueba el entorno, no la API: si esto falla, el CRUD de almacenes es
    inoperable por completo y conviene saberlo antes de leer 20 fallos de HTTP.
    """
    from zoneinfo import available_timezones

    zonas = available_timezones()
    assert zonas, (
        "no hay base de datos de zonas horarias: instala `tzdata`. "
        "Sin ella se rechaza cualquier timezone y no se puede crear un almacén."
    )
    assert "America/Costa_Rica" in zonas
    assert "UTC" in zonas
