"""API del módulo de IA: seguridad y flujo funcional completo.

    pytest -m integration tests/test_ai_api.py

Deliberadamente corto. Cubre lo que pidió el modo implementación:
  · seguridad y permisos (un no-owner no entra por ninguna ruta)
  · las reglas críticas de negocio (contrato inmutable, vocabulario contiguo)
  · el flujo de extremo a extremo, que es lo que demuestra que el bloque funciona

No hay una prueba por método ni por caso borde.
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

from .admin_conn import admin_commit

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

pytestmark = pytest.mark.integration

# Contraseñas de los usuarios de prueba: fuera de git, en `.secrets\` (ver .gitignore).
_SCRATCH = Path(
    os.environ.get(
        "OLO_TEST_SCRATCH",
        r"C:\OLO_IA\.secrets",
    )
)
OWNER_EMAIL = "arojas@ologistics.com"
NON_OWNER_EMAIL = "mgr@olo-dev.test"


def _password(nombre: str) -> str:
    path = _SCRATCH / nombre
    if not path.exists():
        pytest.skip(f"falta {nombre} en el scratchpad")
    return path.read_text(encoding="utf-8").strip()


@pytest.fixture(scope="module")
def cfg() -> Settings:
    try:
        s = get_settings()
    except Exception as exc:
        pytest.skip(f"sin configuración válida: {type(exc).__name__}")
    if "supabase.co" not in s.supabase_url:
        pytest.skip("SUPABASE_URL no apunta a un proyecto real")
    return s


@pytest.fixture(scope="module")
async def api(cfg: Settings) -> AsyncIterator[AsyncClient]:
    init_engine(cfg, null_pool=True)
    async with AsyncClient(
        transport=ASGITransport(app=create_app(cfg)), base_url="http://test", timeout=60.0
    ) as c:
        yield c
    await dispose_engine()


async def _token(api: AsyncClient, email: str, pw_file: str) -> str:
    r = await api.post("/v1/auth/login", json={"email": email, "password": _password(pw_file)})
    if r.status_code != 200:
        pytest.skip(f"login de {email} falló: {r.status_code}")
    return str(r.json()["data"]["access_token"])


@pytest.fixture(scope="module")
async def owner(api: AsyncClient) -> dict[str, str]:
    return {"Authorization": f"Bearer {await _token(api, OWNER_EMAIL, 'adminpw.txt')}"}


@pytest.fixture(scope="module")
async def otro(api: AsyncClient) -> dict[str, str]:
    return {"Authorization": f"Bearer {await _token(api, NON_OWNER_EMAIL, 'testpw.txt')}"}


@pytest.fixture
async def proyecto(api: AsyncClient, owner: dict[str, str]) -> AsyncIterator[dict[str, Any]]:
    """Un proyecto de usar y tirar. Se archiva al terminar.

    Se limpia con conexión privilegiada porque la API solo hace borrado lógico y el
    proyecto seguiría contando para las unicidades de slug.
    """
    slug = f"api-{uuid4().hex[:8]}"
    r = await api.post(
        "/v1/ai/projects",
        headers=owner,
        json={"name": "Proyecto de API", "slug": slug},
    )
    assert r.status_code == 201, r.text[:400]
    datos = r.json()["data"]
    yield datos

    async with admin_commit() as c:
        pid = datos["id"]
        await c.execute("DELETE FROM ai.model_classes WHERE project_id = $1", pid)
        await c.execute("DELETE FROM ai.model_versions WHERE project_id = $1", pid)
        await c.execute("DELETE FROM ai.models WHERE project_id = $1", pid)
        await c.execute("DELETE FROM ai.classes WHERE project_id = $1", pid)
        await c.execute("DELETE FROM ai.assets WHERE project_id = $1", pid)
        await c.execute("DELETE FROM ai.projects WHERE id = $1", pid)


# ══ SEGURIDAD ══════════════════════════════════════════════════════════════
@pytest.mark.parametrize(
    ("metodo", "ruta"),
    [
        ("GET", "/v1/ai/frameworks"),
        ("GET", "/v1/ai/architectures"),
        ("GET", "/v1/ai/architectures/rf-detr-nano"),
        ("GET", "/v1/ai/projects"),
        ("POST", "/v1/ai/projects"),
        ("GET", f"/v1/ai/projects/{uuid4()}"),
        ("PATCH", f"/v1/ai/projects/{uuid4()}"),
        ("DELETE", f"/v1/ai/projects/{uuid4()}"),
        ("GET", f"/v1/ai/projects/{uuid4()}/models"),
        ("POST", f"/v1/ai/projects/{uuid4()}/models"),
        ("GET", f"/v1/ai/models/{uuid4()}"),
        ("PATCH", f"/v1/ai/models/{uuid4()}"),
        ("DELETE", f"/v1/ai/models/{uuid4()}"),
        ("GET", f"/v1/ai/projects/{uuid4()}/classes"),
        ("POST", f"/v1/ai/projects/{uuid4()}/classes"),
        ("PATCH", f"/v1/ai/classes/{uuid4()}"),
        ("GET", f"/v1/ai/models/{uuid4()}/classes"),
        ("PUT", f"/v1/ai/models/{uuid4()}/classes"),
    ],
)
async def test_01_ninguna_ruta_admite_a_un_no_owner(
    api: AsyncClient, otro: dict[str, str], metodo: str, ruta: str
) -> None:
    """Las 18 rutas, una por una. Una sola sin puerta es el agujero entero."""
    r = await api.request(metodo, ruta, headers=otro, json={})
    assert r.status_code == 403, f"{metodo} {ruta} devolvió {r.status_code}"
    assert r.json()["error"]["code"] == "NOT_PLATFORM_OWNER"


async def test_02_sin_token_es_401(api: AsyncClient) -> None:
    r = await api.get("/v1/ai/projects")
    assert r.status_code == 401


# ══ FLUJO COMPLETO ═════════════════════════════════════════════════════════
async def test_03_flujo_de_extremo_a_extremo(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """Proyecto → clases → modelo → vocabulario. Lo que el bloque debe entregar."""
    pid = proyecto["id"]

    # El catálogo alimenta el formulario.
    arqs = (await api.get("/v1/ai/architectures?task=detect", headers=owner)).json()["data"]
    assert any(a["code"] == "rf-detr-nano" for a in arqs)

    # Clases: el servidor asigna class_index.
    ids_clases = []
    for nombre, color in (("pallet", "#FF8800"), ("caja", "#00AAFF"), ("etiqueta", "#22CC66")):
        r = await api.post(
            f"/v1/ai/projects/{pid}/classes",
            headers=owner,
            json={"name": nombre, "color": color},
        )
        assert r.status_code == 201, r.text[:300]
        ids_clases.append(r.json()["data"]["id"])
    indices = [
        c["class_index"]
        for c in (await api.get(f"/v1/ai/projects/{pid}/classes", headers=owner)).json()["data"]
    ]
    assert indices == [0, 1, 2]

    # Modelo, con el framework resuelto en la respuesta del 201.
    r = await api.post(
        f"/v1/ai/projects/{pid}/models",
        headers=owner,
        json={
            "name": "Detector YOLO",
            "slug": f"det-{uuid4().hex[:6]}",
            "architecture_code": "rf-detr-base",
            "task": "detect",
            "input_type": "image",
            "purpose": "Detectar pallets y cajas en el pasillo central",
        },
    )
    assert r.status_code == 201, r.text[:400]
    modelo = r.json()["data"]
    assert modelo["framework_code"] == "rfdetr"
    assert modelo["framework_adapter"] == "rfdetr"
    assert modelo["requires_training"] is True
    assert modelo["version_count"] == 0
    assert modelo["published_version_id"] is None

    # Vocabulario: el ORDEN fija training_index.
    r = await api.put(
        f"/v1/ai/models/{modelo['id']}/classes",
        headers=owner,
        json={"class_ids": [ids_clases[2], ids_clases[0], ids_clases[1]]},
    )
    assert r.status_code == 200, r.text[:300]
    vocab = r.json()["data"]
    assert [v["training_index"] for v in vocab] == [0, 1, 2]
    assert [v["class_name"] for v in vocab] == ["etiqueta", "pallet", "caja"]

    # Reordenar es atómico: con UPDATE individuales violaría uq_mc_indice.
    r = await api.put(
        f"/v1/ai/models/{modelo['id']}/classes",
        headers=owner,
        json={"class_ids": [ids_clases[0], ids_clases[1], ids_clases[2]]},
    )
    assert [v["class_name"] for v in r.json()["data"]] == ["pallet", "caja", "etiqueta"]


# ══ REGLAS CRÍTICAS ════════════════════════════════════════════════════════
async def test_04_combinacion_no_soportada_da_422_con_alternativas(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """El mensaje debe listar qué SÍ soporta: es la razón de validar antes del motor."""
    r = await api.post(
        f"/v1/ai/projects/{proyecto['id']}/models",
        headers=owner,
        json={
            "name": "OCR imposible",
            "slug": f"ocr-{uuid4().hex[:6]}",
            "architecture_code": "rf-detr-nano",
            "task": "ocr",
            "input_type": "image",
        },
    )
    assert r.status_code == 422, r.text[:300]
    mensaje = r.json()["error"]["message"]
    assert "ocr" in mensaje
    assert "detect" in mensaje, "el mensaje debe listar las tareas soportadas"


async def test_05_optimistic_locking_y_etag(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    pid = proyecto["id"]
    etag = (await api.get(f"/v1/ai/projects/{pid}", headers=owner)).headers["ETag"]

    sin_match = await api.patch(f"/v1/ai/projects/{pid}", headers=owner, json={"name": "X Y"})
    assert sin_match.status_code == 428

    obsoleto = await api.patch(
        f"/v1/ai/projects/{pid}", headers={**owner, "If-Match": 'W/"99"'}, json={"name": "X Y"}
    )
    assert obsoleto.status_code == 412

    ok = await api.patch(
        f"/v1/ai/projects/{pid}",
        headers={**owner, "If-Match": etag},
        json={"name": "Nombre actualizado"},
    )
    assert ok.status_code == 200
    assert ok.json()["data"]["version"] == 2


async def test_06_no_se_aceptan_campos_derivados(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """`framework_code` y `requires_training` no son del cliente: `extra=forbid`."""
    for campo, valor in (("framework_code", "pytorch"), ("requires_training", False)):
        r = await api.post(
            f"/v1/ai/projects/{proyecto['id']}/models",
            headers=owner,
            json={
                "name": "Intruso",
                "slug": f"in-{uuid4().hex[:6]}",
                "architecture_code": "rf-detr-nano",
                "task": "detect",
                "input_type": "image",
                campo: valor,
            },
        )
        assert r.status_code == 400, f"{campo} debería rechazarse: {r.status_code}"
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_07_class_index_no_lo_elige_el_cliente(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    r = await api.post(
        f"/v1/ai/projects/{proyecto['id']}/classes",
        headers=owner,
        json={"name": "intrusa", "color": "#FFFFFF", "class_index": 99},
    )
    assert r.status_code == 400


async def test_08_desactivar_una_clase_no_la_borra(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """Y una clase desactivada no puede entrar en un vocabulario."""
    pid = proyecto["id"]
    r = await api.post(
        f"/v1/ai/projects/{pid}/classes", headers=owner,
        json={"name": "retirada", "color": "#999999"},
    )
    clase = r.json()["data"]
    etag = r.headers["ETag"]

    r = await api.patch(
        f"/v1/ai/classes/{clase['id']}",
        headers={**owner, "If-Match": etag},
        json={"is_active": False},
    )
    assert r.status_code == 200
    assert r.json()["data"]["is_active"] is False
    assert r.json()["data"]["class_index"] == clase["class_index"], "no debe renumerar"

    # Sigue existiendo, solo que inactiva.
    todas = (await api.get(f"/v1/ai/projects/{pid}/classes", headers=owner)).json()["data"]
    activas = (
        await api.get(f"/v1/ai/projects/{pid}/classes?only_active=true", headers=owner)
    ).json()["data"]
    assert len(todas) == len(activas) + 1

    # Y no puede entrar en el vocabulario de un modelo.
    m = (
        await api.post(
            f"/v1/ai/projects/{pid}/models",
            headers=owner,
            json={
                "name": "Con inactiva",
                "slug": f"ci-{uuid4().hex[:6]}",
                "architecture_code": "rf-detr-nano",
                "task": "detect",
                "input_type": "image",
            },
        )
    ).json()["data"]
    r = await api.put(
        f"/v1/ai/models/{m['id']}/classes",
        headers=owner,
        json={"class_ids": [clase["id"]]},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "AI_CLASS_INACTIVE"


async def test_09_clase_de_otro_proyecto_se_rechaza(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """Referencia entre proyectos: 422, no 404. El llamante sí tiene acceso al proyecto."""
    otro_slug = f"ajeno-{uuid4().hex[:8]}"
    ajeno = (
        await api.post(
            "/v1/ai/projects", headers=owner,
            json={"name": "Ajeno", "slug": otro_slug},
        )
    ).json()["data"]
    try:
        clase_ajena = (
            await api.post(
                f"/v1/ai/projects/{ajeno['id']}/classes", headers=owner,
                json={"name": "ajena", "color": "#123456"},
            )
        ).json()["data"]

        m = (
            await api.post(
                f"/v1/ai/projects/{proyecto['id']}/models",
                headers=owner,
                json={
                    "name": "Cruzado",
                    "slug": f"cr-{uuid4().hex[:6]}",
                    "architecture_code": "rf-detr-nano",
                    "task": "detect",
                    "input_type": "image",
                },
            )
        ).json()["data"]

        r = await api.put(
            f"/v1/ai/models/{m['id']}/classes",
            headers=owner,
            json={"class_ids": [clase_ajena["id"]]},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "AI_CROSS_PROJECT_REFERENCE"
    finally:
        async with admin_commit() as c:
            await c.execute("DELETE FROM ai.classes WHERE project_id = $1", ajeno["id"])
            await c.execute("DELETE FROM ai.projects WHERE id = $1", ajeno["id"])


async def test_10_un_proyecto_con_modelos_no_se_borra(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    pid = proyecto["id"]
    await api.post(
        f"/v1/ai/projects/{pid}/models",
        headers=owner,
        json={
            "name": "Bloqueante",
            "slug": f"bl-{uuid4().hex[:6]}",
            "architecture_code": "rf-detr-nano",
            "task": "detect",
            "input_type": "image",
        },
    )
    etag = (await api.get(f"/v1/ai/projects/{pid}", headers=owner)).headers["ETag"]
    r = await api.delete(f"/v1/ai/projects/{pid}", headers={**owner, "If-Match": etag})
    assert r.status_code == 409
    assert "modelos" in r.json()["error"]["message"].lower()
