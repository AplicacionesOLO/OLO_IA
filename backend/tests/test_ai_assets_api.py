"""Bloque 2: autorizacion, aislamiento de rutas y validacion de MIME/tamaño.

    pytest -m integration tests/test_ai_assets_api.py

Cuatro pruebas, no una por endpoint. PENDIENTE DE EJECUCION: requiere la migracion
0045 aplicada (bucket `ai-assets` + politicas de storage.objects).
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from olo.core.config import Settings, get_settings
from olo.db.session import dispose_engine, init_engine
from olo.domain.ai.asset import AssetKind, ruta_canonica, sanitizar_nombre
from olo.main import create_app

from .admin_conn import admin_commit

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

pytestmark = pytest.mark.integration

_SCRATCH = Path(
    os.environ.get(
        "OLO_TEST_SCRATCH",
        r"C:\Users\arojast\AppData\Local\Temp\claude\C--YOLO-Almacen-Inv-OLO"
        r"\13b0860b-2d5e-474d-b525-99727dea78af\scratchpad",
    )
)
OWNER_EMAIL = "arojas@ologistics.com"
NON_OWNER_EMAIL = "mgr@olo-dev.test"


def _password(nombre: str) -> str:
    path = _SCRATCH / nombre
    if not path.exists():
        pytest.skip(f"falta {nombre}")
    return path.read_text(encoding="utf-8").strip()


@pytest.fixture(scope="module")
def cfg() -> Settings:
    try:
        s = get_settings()
    except Exception as exc:
        pytest.skip(f"sin configuracion: {type(exc).__name__}")
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


async def _token(api: AsyncClient, email: str, pw: str) -> str:
    r = await api.post("/v1/auth/login", json={"email": email, "password": _password(pw)})
    if r.status_code != 200:
        pytest.skip(f"login de {email} fallo: {r.status_code}")
    return str(r.json()["data"]["access_token"])


@pytest.fixture(scope="module")
async def owner_token(api: AsyncClient) -> str:
    return await _token(api, OWNER_EMAIL, "adminpw.txt")


@pytest.fixture(scope="module")
def owner(owner_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {owner_token}"}


# ── PNG real de 1x1 ────────────────────────────────────────────────────────
# Un binario valido de verdad: el navegador lee sus dimensiones y Storage acepta
# su MIME. Inventar bytes haria pasar la prueba sin probar la subida.
_PNG_1X1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea735c1d800"
    "00000049454e44ae426082"
)


async def _subir_a_storage(
    cfg: Settings, token: str, upload_url: str, datos: bytes, content_type: str
) -> httpx.Response:
    """Sube el binario DIRECTO a Storage con el JWT del usuario.

    Es el paso 2 del flujo y el que valida la migracion 0045: si las politicas del
    bucket estan mal, aqui sale 403 y no en ningun otro sitio.
    """
    anon = cfg.supabase_anon_key
    async with httpx.AsyncClient(timeout=60.0) as c:
        return await c.post(
            upload_url,
            content=datos,
            headers={
                "Authorization": f"Bearer {token}",
                **({"apikey": anon.get_secret_value()} if anon else {}),
                "Content-Type": content_type,
                "x-upsert": "false",
            },
        )


@pytest.fixture(scope="module")
async def otro(api: AsyncClient) -> dict[str, str]:
    return {"Authorization": f"Bearer {await _token(api, NON_OWNER_EMAIL, 'testpw.txt')}"}


@pytest.fixture
async def proyecto(api: AsyncClient, owner: dict[str, str]) -> AsyncIterator[dict[str, Any]]:
    r = await api.post(
        "/v1/ai/projects",
        headers=owner,
        json={"name": "Dataset test", "slug": f"ds-{uuid4().hex[:8]}"},
    )
    assert r.status_code == 201, r.text[:400]
    datos = r.json()["data"]
    yield datos
    async with admin_commit() as c:
        pid = datos["id"]
        await c.execute("DELETE FROM ai.images WHERE project_id = $1", pid)
        await c.execute("DELETE FROM ai.assets WHERE project_id = $1", pid)
        await c.execute("DELETE FROM ai.projects WHERE id = $1", pid)


@pytest.mark.parametrize(
    ("metodo", "ruta"),
    [
        ("POST", f"/v1/ai/projects/{uuid4()}/assets/prepare"),
        ("POST", f"/v1/ai/projects/{uuid4()}/assets/confirm"),
        ("GET", f"/v1/ai/projects/{uuid4()}/images"),
        ("GET", f"/v1/ai/projects/{uuid4()}/images/counts"),
        ("GET", f"/v1/ai/assets/{uuid4()}/url"),
        ("PATCH", f"/v1/ai/images/{uuid4()}/status"),
        ("DELETE", f"/v1/ai/assets/{uuid4()}"),
    ],
)
async def test_01_un_no_owner_no_entra(
    api: AsyncClient, otro: dict[str, str], metodo: str, ruta: str
) -> None:
    r = await api.request(metodo, ruta, headers=otro, json={})
    assert r.status_code == 403, f"{metodo} {ruta} devolvio {r.status_code}"
    assert r.json()["error"]["code"] == "NOT_PLATFORM_OWNER"


def test_02_la_ruta_canonica_aisla_por_proyecto() -> None:
    """La ruta la genera el servidor y aisla por proyecto en el primer segmento.

    Forma: {project_id}/{kind}/{asset_id}/{nombre_saneado}. La migracion 0045 la
    convierte en invariante con `core.ai_asset_path_ok()`, que exige esos cuatro
    segmentos y que el primero sea un proyecto existente.
    """
    p1, p2, asset = uuid4(), uuid4(), uuid4()

    r1 = ruta_canonica(p1, asset, AssetKind.IMAGE, "image/jpeg", "Foto Nave 3.JPEG")
    r2 = ruta_canonica(p2, asset, AssetKind.IMAGE, "image/jpeg", "Foto Nave 3.JPEG")

    assert r1 == f"{p1}/image/{asset}/foto-nave-3.jpg"
    assert r1 != r2, "el mismo asset en dos proyectos debe dar rutas distintas"
    assert r1.split("/")[0] == str(p1)
    assert len(r1.split("/")) == 4

    assert ruta_canonica(
        p1, asset, AssetKind.WEIGHTS, "application/octet-stream", "best.pt"
    ) == f"{p1}/weights/{asset}/best.bin"


@pytest.mark.parametrize(
    "nombre",
    [
        "../../../etc/passwd",
        "..\\..\\windows\\system32\\cmd.exe",
        "/absoluto/foto.jpg",
        "....//....//x.jpg",
        "   .   ",
        "",
        "a" * 400,
    ],
)
def test_02b_ningun_nombre_escapa_del_prefijo(nombre: str) -> None:
    """El nombre lo elige el usuario; el segmento resultante no.

    Es la unica entrada de texto libre que entra en la ruta, asi que es por donde
    se intentaria salir del prefijo del proyecto.
    """
    pid, aid = uuid4(), uuid4()
    ruta = ruta_canonica(pid, aid, AssetKind.IMAGE, "image/jpeg", nombre)

    partes = ruta.split("/")
    assert len(partes) == 4, f"{nombre!r} produjo {len(partes)} segmentos: {ruta}"
    assert partes[0] == str(pid)
    assert partes[1] == "image"
    assert partes[2] == str(aid)
    assert ".." not in partes[3]
    assert partes[3].endswith(".jpg")
    assert partes[3] not in ("", ".jpg", ".", "..")


def test_02c_sanitizar_es_determinista() -> None:
    """`confirm` recalcula la ruta que genero `prepare`.

    Si el saneado no fuera identico para la misma entrada, el objeto ya subido
    quedaria inalcanzable y toda confirmacion fallaria con «no existe en Storage».
    """
    # El acento se translitera, no se colapsa: «camión» debe seguir leyendose.
    assert sanitizar_nombre("Camión #7 (frente).jpeg", "image/jpeg") == "camion-7-frente.jpg"
    for _ in range(3):
        assert sanitizar_nombre("Foto Nave 3.JPEG", "image/jpeg") == "foto-nave-3.jpg"

    # La extension la fija el MIME, nunca el nombre: un ejecutable con MIME de
    # imagen no puede quedar servido como ejecutable.
    assert sanitizar_nombre("payload.exe", "image/png") == "payload.png"


@pytest.mark.parametrize(
    ("content_type", "bytes_", "motivo"),
    [
        ("application/pdf", 1024, "MIME no admitido para imagen"),
        ("image/jpeg", 40 * 1024 * 1024, "supera los 25 MB"),
        ("image/gif", 1024, "GIF no esta en la lista"),
    ],
)
async def test_03_prepare_rechaza_mime_o_tamano_invalido(
    api: AsyncClient,
    owner: dict[str, str],
    proyecto: dict[str, Any],
    content_type: str,
    bytes_: int,
    motivo: str,
) -> None:
    r = await api.post(
        f"/v1/ai/projects/{proyecto['id']}/assets/prepare",
        headers=owner,
        json={
            "kind": "image",
            "content_type": content_type,
            "bytes": bytes_,
            "original_filename": "x.bin",
        },
    )
    assert r.status_code == 422, f"{motivo}: recibido {r.status_code} — {r.text[:200]}"


async def test_04_prepare_devuelve_ruta_del_proyecto_y_confirm_exige_el_objeto(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """`prepare` reserva la ruta; `confirm` sin subir el binario debe fallar.

    Es lo que impide registrar metadatos de un archivo que no existe.
    """
    pid = proyecto["id"]
    r = await api.post(
        f"/v1/ai/projects/{pid}/assets/prepare",
        headers=owner,
        json={
            "kind": "image",
            "content_type": "image/jpeg",
            "bytes": 2048,
            "original_filename": "Nave Norte.jpg",
        },
    )
    assert r.status_code == 200, r.text[:300]
    prep = r.json()["data"]
    assert prep["bucket"] == "ai-assets"
    assert prep["object_path"] == f"{pid}/image/{prep['asset_id']}/nave-norte.jpg"
    assert prep["upload_url"].endswith(prep["object_path"])

    confirmado = await api.post(
        f"/v1/ai/projects/{pid}/assets/confirm",
        headers=owner,
        json={
            "asset_id": prep["asset_id"],
            "kind": "image",
            "original_filename": "Nave Norte.jpg",
            "content_type": "image/jpeg",
            "bytes": 2048,
            "sha256": "ab" * 32,
        },
    )
    assert confirmado.status_code == 422, confirmado.text[:300]
    assert "storage" in confirmado.json()["error"]["message"].lower()


async def test_05_prepare_no_acepta_object_path_del_cliente(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """Si el cliente pudiera elegir la ruta, el aislamiento por proyecto no existiria.

    El esquema usa `extra="forbid"`, asi que intentarlo es 400, no un campo ignorado
    en silencio —que seria peor: pareceria aceptado.
    """
    otro_proyecto = uuid4()
    r = await api.post(
        f"/v1/ai/projects/{proyecto['id']}/assets/prepare",
        headers=owner,
        json={
            "kind": "image",
            "content_type": "image/jpeg",
            "bytes": 1024,
            "original_filename": "a.jpg",
            "object_path": f"{otro_proyecto}/image/x/robado.jpg",
        },
    )
    assert r.status_code == 400, r.text[:300]

    # Y la ruta que si devuelve nunca es la del otro proyecto.
    ok = await api.post(
        f"/v1/ai/projects/{proyecto['id']}/assets/prepare",
        headers=owner,
        json={
            "kind": "image",
            "content_type": "image/jpeg",
            "bytes": 1024,
            "original_filename": "a.jpg",
        },
    )
    assert ok.status_code == 200
    assert ok.json()["data"]["object_path"].startswith(f"{proyecto['id']}/")
    assert str(otro_proyecto) not in ok.json()["data"]["object_path"]


async def test_06_flujo_completo_de_una_carga_valida(
    api: AsyncClient,
    cfg: Settings,
    owner: dict[str, str],
    owner_token: str,
    proyecto: dict[str, Any],
) -> None:
    """La cadena entera con un binario REAL, en el orden en que la usa la pantalla.

    prepare → subida directa a Storage → confirm → ai.assets → ai.images → listar
    → URL firmada → cambiar estado → borrar binario y metadatos.

    Va en una sola prueba a proposito: cada paso consume la salida del anterior, y
    partirla en nueve exigiria montar el estado a mano nueve veces, con lo que
    dejaria de probar que los pasos encajan.
    """
    pid = proyecto["id"]
    sha = hashlib.sha256(_PNG_1X1).hexdigest()
    identidad = {
        "kind": "image",
        "content_type": "image/png",
        "bytes": len(_PNG_1X1),
        "original_filename": "Nave Sur #2.png",
    }

    # ── 1 · prepare ────────────────────────────────────────────────────────
    prep = await api.post(
        f"/v1/ai/projects/{pid}/assets/prepare", headers=owner, json=identidad
    )
    assert prep.status_code == 200, prep.text[:400]
    p = prep.json()["data"]
    assert p["object_path"] == f"{pid}/image/{p['asset_id']}/nave-sur-2.png"

    # ── 2 · subida directa a Storage ───────────────────────────────────────
    subida = await _subir_a_storage(
        cfg, owner_token, p["upload_url"], _PNG_1X1, "image/png"
    )
    assert subida.status_code in (200, 201), (
        f"Storage rechazo la subida: {subida.status_code} — {subida.text[:300]}. "
        "Un 403 aqui significa que las politicas de la migracion 0045 no autorizan "
        "la ruta."
    )

    confirmacion = {**identidad, "asset_id": p["asset_id"], "sha256": sha,
                    "width": 1, "height": 1}
    try:
        # ── 3 · confirm crea ai.assets y ai.images ─────────────────────────
        conf = await api.post(
            f"/v1/ai/projects/{pid}/assets/confirm", headers=owner, json=confirmacion
        )
        assert conf.status_code == 201, conf.text[:400]
        asset = conf.json()["data"]
        assert asset["object_path"] == p["object_path"]
        assert asset["sha256"] == sha
        assert asset["version"] == 1
        assert conf.headers.get("ETag") == 'W/"1"'

        # Confirmar dos veces es 409, no un 500 por violacion de PK.
        repetida = await api.post(
            f"/v1/ai/projects/{pid}/assets/confirm", headers=owner, json=confirmacion
        )
        assert repetida.status_code == 409, repetida.text[:300]

        # ── 4 · listar: la imagen existe y trae la version del ASSET ───────
        listado = await api.get(f"/v1/ai/projects/{pid}/images", headers=owner)
        assert listado.status_code == 200, listado.text[:300]
        imagenes = listado.json()["data"]
        img = next(i for i in imagenes if i["asset_id"] == asset["id"])
        assert img["status"] == "pending"
        assert img["asset_version"] == 1, "sin esto el DELETE no puede mandar If-Match"
        assert img["annotation_count"] == 0
        assert img["original_filename"] == "Nave Sur #2.png"

        recuentos = await api.get(f"/v1/ai/projects/{pid}/images/counts", headers=owner)
        assert recuentos.json()["data"]["pending"] >= 1

        # ── 5 · URL firmada: el bucket es privado y la firma sirve el binario ──
        firma = await api.get(f"/v1/ai/assets/{asset['id']}/url", headers=owner)
        assert firma.status_code == 200, firma.text[:300]
        async with httpx.AsyncClient(timeout=60.0) as c:
            descarga = await c.get(firma.json()["data"]["url"])
        assert descarga.status_code == 200, descarga.status_code
        assert descarga.content == _PNG_1X1, "la firma debe servir el binario exacto"

        # ── 6 · cambiar estado: usa la version de la IMAGEN ────────────────
        cambio = await api.patch(
            f"/v1/ai/images/{img['id']}/status",
            headers={**owner, "If-Match": f'W/"{img["version"]}"'},
            json={"status": "validated"},
        )
        assert cambio.status_code == 200, cambio.text[:300]
        assert cambio.json()["data"]["status"] == "validated"

        # Y el cambio de estado NO toca la version del asset: es lo que hace que
        # `version` e `asset_version` sean campos distintos.
        tras = await api.get(f"/v1/ai/projects/{pid}/images", headers=owner)
        img2 = next(i for i in tras.json()["data"] if i["asset_id"] == asset["id"])
        assert img2["version"] == img["version"] + 1
        assert img2["asset_version"] == 1, (
            "el asset no cambio: mandar `version` en el If-Match del DELETE daria 412"
        )

        # ── 7 · borrar con la version del ASSET ────────────────────────────
        borrado = await api.delete(
            f"/v1/ai/assets/{asset['id']}",
            headers={**owner, "If-Match": f'W/"{img2["asset_version"]}"'},
        )
        assert borrado.status_code == 200, borrado.text[:400]
        r = borrado.json()["data"]
        assert r["storage_deleted"] is True, f"binario huerfano: {r}"
        assert r["image_deleted"] is True
        assert r["orphaned_object_path"] is None

        # ── 8 · ya no aparece, y el binario tampoco esta ───────────────────
        final = await api.get(f"/v1/ai/projects/{pid}/images", headers=owner)
        assert all(i["asset_id"] != asset["id"] for i in final.json()["data"])

        # Y la API ya no firma lo que no existe.
        muerta = await api.get(f"/v1/ai/assets/{asset['id']}/url", headers=owner)
        assert muerta.status_code == 404, muerta.text[:200]

        # El binario se comprueba en el endpoint AUTENTICADO, no reintentando la URL
        # firmada: esa se sirve por CDN y devuelve 200 desde cache un rato despues
        # de que el objeto ya no exista. La cache no es una afirmacion sobre el
        # estado de Storage.
        anon = cfg.supabase_anon_key
        async with httpx.AsyncClient(timeout=60.0) as c:
            directo = await c.head(
                f"{cfg.supabase_url}/storage/v1/object/authenticated/ai-assets/"
                f"{p['object_path']}",
                headers={
                    "Authorization": f"Bearer {owner_token}",
                    **({"apikey": anon.get_secret_value()} if anon else {}),
                },
            )
        assert directo.status_code >= 400, (
            f"el binario sigue en Storage: HEAD devolvio {directo.status_code}"
        )
    finally:
        # Si algo fallo a mitad, el objeto puede seguir en Storage. Se limpia: el
        # bucket de desarrollo no debe acumular restos de pruebas.
        async with httpx.AsyncClient(timeout=60.0) as c:
            anon = cfg.supabase_anon_key
            await c.request(
                "DELETE",
                f"{cfg.supabase_url}/storage/v1/object/ai-assets",
                headers={
                    "Authorization": f"Bearer {owner_token}",
                    **({"apikey": anon.get_secret_value()} if anon else {}),
                },
                json={"prefixes": [p["object_path"]]},
            )


async def test_06b_storage_deniega_la_ruta_de_otro_proyecto(
    api: AsyncClient, cfg: Settings, owner_token: str, proyecto: dict[str, Any]
) -> None:
    """El aislamiento por proyecto lo impone STORAGE, no el backend.

    El cliente sube directo, asi que si intenta una ruta bajo un project_id que no
    existe —o bajo uno ajeno— la unica defensa son las politicas de 0045. Aqui se
    comprueba que la defensa esta puesta y funciona.
    """
    inexistente = uuid4()
    base = f"{cfg.supabase_url}/storage/v1/object/ai-assets"

    intentos = {
        "project_id inexistente": f"{inexistente}/image/{uuid4()}/x.png",
        "sin project_id": f"suelto/image/{uuid4()}/x.png",
        "kind fuera del vocabulario": f"{proyecto['id']}/secretos/{uuid4()}/x.png",
        "fuera del prefijo del proyecto": "raiz.png",
    }

    for motivo, ruta in intentos.items():
        r = await _subir_a_storage(cfg, owner_token, f"{base}/{ruta}", _PNG_1X1, "image/png")
        assert r.status_code >= 400, (
            f"{motivo}: Storage ACEPTO {ruta} con {r.status_code}. "
            "El aislamiento por proyecto no se esta imponiendo."
        )


async def test_06c_no_se_borra_una_imagen_anotada(
    api: AsyncClient,
    cfg: Settings,
    owner: dict[str, str],
    owner_token: str,
    proyecto: dict[str, Any],
) -> None:
    """Borrar el binario de una imagen anotada destruiria trabajo de etiquetado.

    Las cajas seguirian existiendo describiendo un archivo que ya nadie puede
    mirar: ni se pueden revisar ni se pueden corregir. Se exige retirarlas primero.
    """
    pid = proyecto["id"]
    contenido = _PNG_1X1 + b"anotada"  # sha distinto: evita el 409 por duplicado
    identidad = {
        "kind": "image",
        "content_type": "image/png",
        "bytes": len(contenido),
        "original_filename": "anotada.png",
    }

    p = (
        await api.post(
            f"/v1/ai/projects/{pid}/assets/prepare", headers=owner, json=identidad
        )
    ).json()["data"]
    subida = await _subir_a_storage(
        cfg, owner_token, p["upload_url"], contenido, "image/png"
    )
    assert subida.status_code in (200, 201), subida.text[:300]

    conf = await api.post(
        f"/v1/ai/projects/{pid}/assets/confirm",
        headers=owner,
        json={
            **identidad,
            "asset_id": p["asset_id"],
            "sha256": hashlib.sha256(contenido).hexdigest(),
        },
    )
    assert conf.status_code == 201, conf.text[:300]
    asset = conf.json()["data"]

    listado = await api.get(f"/v1/ai/projects/{pid}/images", headers=owner)
    img = next(i for i in listado.json()["data"] if i["asset_id"] == asset["id"])

    # Una clase y una anotacion por la base: el endpoint de anotaciones es Bloque 3.
    async with admin_commit() as c:
        uid = await c.fetchval("SELECT created_by FROM ai.projects WHERE id = $1", pid)
        class_id = await c.fetchval(
            "INSERT INTO ai.classes (project_id, name, class_index, color, created_by) "
            "VALUES ($1, 'caja', 0, '#FF0000', $2) RETURNING id",
            pid,
            uid,
        )
        await c.execute(
            "INSERT INTO ai.annotations (project_id, image_id, class_id, kind, "
            "  cx, cy, w, h, created_by) "
            "VALUES ($1, $2, $3, 'bbox', 0.5, 0.5, 0.2, 0.2, $4)",
            pid,
            img["id"],
            class_id,
            uid,
        )

    try:
        conteo = await api.get(f"/v1/ai/projects/{pid}/images", headers=owner)
        anotada = next(
            i for i in conteo.json()["data"] if i["asset_id"] == asset["id"]
        )
        assert anotada["annotation_count"] == 1

        rechazo = await api.delete(
            f"/v1/ai/assets/{asset['id']}",
            headers={**owner, "If-Match": f'W/"{anotada["asset_version"]}"'},
        )
        assert rechazo.status_code == 409, rechazo.text[:400]
        assert "anotacion" in rechazo.json()["error"]["message"].lower()

        # Y no borro nada: ni la fila ni el binario.
        sigue = await api.get(f"/v1/ai/projects/{pid}/images", headers=owner)
        assert any(i["asset_id"] == asset["id"] for i in sigue.json()["data"])

        # Retiradas las anotaciones, el borrado procede.
        async with admin_commit() as c:
            await c.execute("DELETE FROM ai.annotations WHERE image_id = $1", img["id"])

        ok = await api.delete(
            f"/v1/ai/assets/{asset['id']}",
            headers={**owner, "If-Match": f'W/"{anotada["asset_version"]}"'},
        )
        assert ok.status_code == 200, ok.text[:400]
        assert ok.json()["data"]["storage_deleted"] is True
    finally:
        async with admin_commit() as c:
            await c.execute("DELETE FROM ai.annotations WHERE image_id = $1", img["id"])
            await c.execute("DELETE FROM ai.classes WHERE project_id = $1", pid)


async def test_07_delete_exige_la_version_del_asset(
    api: AsyncClient, owner: dict[str, str], proyecto: dict[str, Any]
) -> None:
    """El If-Match del DELETE lleva `asset_version`, no `version` de la imagen.

    Son contadores independientes. Esta prueba fija el contrato: una version que no
    es la del asset produce 412 y NO borra nada.
    """
    pid = proyecto["id"]

    # Se crea el asset por la base: subir un binario real a Storage exige el bucket
    # aplicado, y lo que se comprueba aqui es el optimistic locking del DELETE.
    asset_id = uuid4()
    async with admin_commit() as c:
        await c.execute(
            "INSERT INTO ai.assets (id, project_id, kind, bucket, object_path, "
            "  original_filename, content_type, bytes, sha256, created_by) "
            "VALUES ($1, $2, 'image', 'ai-assets', $3, 'v.jpg', 'image/jpeg', 10, $4, "
            "        (SELECT created_by FROM ai.projects WHERE id = $2))",
            asset_id,
            pid,
            f"{pid}/image/{asset_id}/v.jpg",
            "ef" * 32,
        )

    try:
        # version real = 1; se envia 99.
        malo = await api.delete(
            f"/v1/ai/assets/{asset_id}", headers={**owner, "If-Match": 'W/"99"'}
        )
        assert malo.status_code == 412, malo.text[:300]

        async with admin_commit() as c:
            vivo = await c.fetchval(
                "SELECT count(1) FROM ai.assets WHERE id = $1 AND deleted_at IS NULL",
                asset_id,
            )
        assert vivo == 1, "un 412 no debe haber borrado nada"

        # Y sin If-Match, 428: el borrado nunca es incondicional.
        sin = await api.delete(f"/v1/ai/assets/{asset_id}", headers=owner)
        assert sin.status_code == 428, sin.text[:300]
    finally:
        async with admin_commit() as c:
            await c.execute("DELETE FROM ai.assets WHERE id = $1", asset_id)
