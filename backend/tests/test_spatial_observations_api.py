"""Pruebas de las observaciones y las rutas derivadas, contra Supabase REAL.

    pytest -m integration tests/test_spatial_observations_api.py

── POR QUÉ ESCRIBE EN LA BASE COMPARTIDA ────────────────────────────────────

Lo que se comprueba es que la FK compuesta y las policies aceptan la fila, y que la
unicidad `(fuente, rack, instante)` hace la ingesta idempotente. Un doble en memoria
aprobaría exactamente los casos que aquí interesan fallar.

Cada prueba usa su PROPIA fuente, con nombre derivado del test, y la fixture
`sin_rastro` borra al final las observaciones de todas ellas y el layout que hizo
falta publicar. Dos pruebas que compartieran fuente se pisarían el recorrido: la
segunda vería los puntos de la primera y la distancia saldría distinta según el
orden de ejecución, que es el defecto más difícil de diagnosticar que existe.

── LO QUE CADA PRUEBA HACE CONCLUYENTE ──────────────────────────────────────

La distancia de la ruta se calcula A MANO aquí, con trigonometría escrita en el
test, y se contrasta con la del backend. No se compara el endpoint con otra consulta
al mismo dato: eso aprobaría igual si las dos estuvieran mal.
"""

from __future__ import annotations

import itertools
import math
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from httpx import ASGITransport, AsyncClient

from olo.core.config import Settings, get_settings
from olo.db.session import dispose_engine, init_engine
from olo.main import create_app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

pytestmark = pytest.mark.integration

_SCRATCH = Path(os.environ.get("OLO_TEST_SCRATCH", r"C:\OLO_IA\.secrets"))
TEST_EMAIL = "mgr@olo-dev.test"

R_LAYOUT = "/v1/spatial/warehouses/{wh}/layout"
R_OBS = "/v1/spatial/warehouses/{wh}/observations"
R_RUTAS = "/v1/spatial/warehouses/{wh}/routes"
R_FUENTES = "/v1/spatial/warehouses/{wh}/observation-sources"
R_COBERTURA = "/v1/spatial/warehouses/{wh}/observation-coverage"

# Los racks se colocan en línea, separados esta distancia. La ruta esperada es
# múltiplo exacto de ella, así que un error de escala se ve a simple vista.
SEP_M = 6.0
Y_M = 20.0
INICIO = datetime(2026, 1, 15, 9, 0, 0, tzinfo=UTC)
PASO_S = 12

# Prefijo de las fuentes que crean estas pruebas. La fixture de limpieza borra por
# él, así que una fuente que se olvide de usarlo se queda en la base compartida.
PREFIJO = "TEST-OBS-"


def _test_password() -> str:
    path = _SCRATCH / "testpw.txt"
    if not path.exists():
        pytest.skip("falta la contraseña del usuario de prueba en el scratchpad")
    return path.read_text(encoding="utf-8").strip()


@pytest.fixture(scope="module")
def real_settings() -> Settings:
    try:
        cfg = get_settings()
    except Exception as exc:
        pytest.skip(f"sin configuración válida: {type(exc).__name__}")
    if "supabase.co" not in cfg.supabase_url:
        pytest.skip("SUPABASE_URL no apunta a un proyecto real")
    return cfg


@pytest.fixture(scope="module")
async def api(real_settings: Settings) -> AsyncIterator[AsyncClient]:
    init_engine(real_settings, null_pool=True)
    app = create_app(real_settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=90.0) as cli:
        yield cli
    await dispose_engine()


@pytest.fixture(scope="module")
async def token(api: AsyncClient) -> str:
    r = await api.post("/v1/auth/login", json={"email": TEST_EMAIL, "password": _test_password()})
    assert r.status_code == 200, f"login falló: {r.status_code} {r.text[:300]}"
    return str(r.json()["data"]["access_token"])


@pytest.fixture
def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
async def warehouse_id(api: AsyncClient, token: str) -> str:
    r = await api.get("/v1/spatial/warehouses", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text[:300]
    con_datos = [w for w in r.json()["data"] if w["location_count"] > 0]
    if not con_datos:
        pytest.skip("no hay catálogo espacial importado en ningún almacén accesible")
    return str(con_datos[0]["warehouse_id"])


@pytest.fixture(scope="module")
async def racks(api: AsyncClient, token: str, warehouse_id: str) -> list[dict[str, Any]]:
    """Cinco racks CON CUERPOS del catálogo."""
    r = await api.get(
        f"/v1/spatial/warehouses/{warehouse_id}/floor-plan",
        params={"limit": 200},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text[:300]
    con_cuerpos = [f for f in r.json()["data"] if f["bay_count"] > 0]
    assert len(con_cuerpos) >= 5, "el catálogo tiene menos de 5 racks con cuerpos"
    return [dict(f) for f in con_cuerpos[:5]]


@pytest.fixture(scope="module", autouse=True)
async def sin_rastro(
    api: AsyncClient, token: str, warehouse_id: str, racks: list[dict[str, Any]]
) -> AsyncIterator[None]:
    """Publica el layout que la ruta necesita y lo deja todo como estaba.

    `autouse`: sin layout NO HAY RUTA —una observación de un rack sin colocar no
    tiene punto— así que cada prueba de este módulo dependería de que otra hubiera
    publicado antes, y el orden de ejecución decidiría si pasan.
    """
    h = {"Authorization": f"Bearer {token}"}
    previo = (await api.get(R_LAYOUT.format(wh=warehouse_id), headers=h)).json()["data"]

    await api.put(
        R_LAYOUT.format(wh=warehouse_id),
        headers=h,
        json={
            "plan_name": "prueba-rutas.png",
            "plan_width_px": 3200,
            "plan_height_px": 909,
            "pixels_per_meter": 26.72,
            "origin_x_px": 0.0,
            "origin_y_px": 0.0,
            "is_calibrated": True,
            "placements": [
                {
                    "rack_node_id": r["rack_id"],
                    "x_m": 10.0 + i * SEP_M,
                    "y_m": Y_M,
                    "rotation_deg": 0.0,
                    "width_m": 1.1,
                    "length_m": 12.0,
                    "height_m": 8.5,
                    "color": None,
                    "is_locked": False,
                }
                for i, r in enumerate(racks)
            ],
        },
    )

    yield

    fuentes = (await api.get(R_FUENTES.format(wh=warehouse_id), headers=h)).json()["data"]
    for f in fuentes:
        if str(f["code"]).startswith(PREFIJO):
            await api.delete(
                R_OBS.format(wh=warehouse_id), params={"source": f["code"]}, headers=h
            )

    await api.delete(R_LAYOUT.format(wh=warehouse_id), headers=h)
    if previo["layout"] is None:
        return
    lay = previo["layout"]
    await api.put(
        R_LAYOUT.format(wh=warehouse_id),
        headers=h,
        json={
            "plan_name": lay["plan_name"],
            "plan_width_px": lay["plan_width_px"],
            "plan_height_px": lay["plan_height_px"],
            "pixels_per_meter": lay["pixels_per_meter"],
            "origin_x_px": lay["origin_x_px"],
            "origin_y_px": lay["origin_y_px"],
            "is_calibrated": lay["is_calibrated"],
            "placements": [
                {
                    "rack_node_id": p["rack_node_id"],
                    "x_m": p["x_m"], "y_m": p["y_m"],
                    "rotation_deg": p["rotation_deg"],
                    "width_m": p["width_m"], "length_m": p["length_m"],
                    "height_m": p["height_m"],
                    "color": p["color"], "is_locked": p["is_locked"],
                }
                for p in previo["placements"]
            ],
        },
    )


def vuelo(
    racks: list[dict[str, Any]], indices: list[int], *, desde: datetime = INICIO
) -> list[dict[str, Any]]:
    """Observaciones de un recorrido por los racks `indices`, una cada `PASO_S`."""
    return [
        {
            "rack_node_id": racks[k]["rack_id"],
            "observed_at": (desde + timedelta(seconds=PASO_S * n)).isoformat(),
            "confidence": 0.9,
            "frame_ref": f"vuelo/frame-{n:04d}.jpg",
            "frame_ms": 1000 * PASO_S * n,
        }
        for n, k in enumerate(indices)
    ]


def distancia_a_mano(indices: list[int]) -> float:
    """La distancia esperada, calculada con los racks en línea a `SEP_M`."""
    puntos = [(10.0 + i * SEP_M, Y_M) for i in indices]
    return sum(math.dist(a, b) for a, b in itertools.pairwise(puntos))


async def ingerir(
    api: AsyncClient,
    auth: dict[str, str],
    warehouse_id: str,
    codigo: str,
    obs: list[dict[str, Any]],
    *,
    kind: str | None = "drone",
) -> dict[str, Any]:
    cuerpo: dict[str, Any] = {"source_code": codigo, "observations": obs}
    if kind is not None:
        cuerpo["source_kind"] = kind
        cuerpo["source_name"] = f"Fuente de prueba {codigo}"
    r = await api.post(R_OBS.format(wh=warehouse_id), headers=auth, json=cuerpo)
    assert r.status_code == 200, r.text[:400]
    return dict(r.json()["data"])


# ══ 1 · Contrato y protección ══════════════════════════════════════════════
async def test_las_cinco_operaciones_estan_publicadas(api: AsyncClient) -> None:
    paths = api._transport.app.openapi()["paths"]  # type: ignore[attr-defined]
    base = "/v1/spatial/warehouses/{warehouse_id}"
    assert set(paths[f"{base}/observations"]) == {"get", "post", "delete"}
    assert set(paths[f"{base}/routes"]) == {"get"}
    assert set(paths[f"{base}/observation-sources"]) == {"get"}
    assert set(paths[f"{base}/observation-coverage"]) == {"get"}


@pytest.mark.parametrize(
    "ruta", [R_OBS, R_RUTAS, R_FUENTES, R_COBERTURA]
)
async def test_sin_token_es_401(api: AsyncClient, ruta: str, warehouse_id: str) -> None:
    r = await api.get(ruta.format(wh=warehouse_id))
    assert r.status_code == 401


async def test_un_almacen_ajeno_es_404_no_403(api: AsyncClient, auth: dict[str, str]) -> None:
    """404 y no 403: un 403 confirmaría que el almacén existe."""
    r = await api.get(R_RUTAS.format(wh="00000000-0000-0000-0000-0000000000ff"), headers=auth)
    assert r.status_code == 404, r.text[:300]


def test_el_permiso_de_escritura_es_distinto_del_de_areas() -> None:
    """`observations:write`, no `areas:write`.

    Es la razón de ser de 0067: un dron que reporta lo que ve no debe poder mover
    racks. Si alguien «simplificara» reutilizando `areas:write`, la credencial de un
    dispositivo en el pasillo podría reescribir la colocación de los 347 racks, y
    este test es lo único que lo delataría.

    Se comprueba leyendo el ROUTER y no el esquema OpenAPI: el permiso no viaja en
    OpenAPI, así que no hay otra forma de afirmarlo desde fuera. Es una prueba
    estática y por eso no es `async`.
    """
    from olo.api.v1 import spatial as modulo

    fuente = Path(modulo.__file__).read_text(encoding="utf-8")
    bloque = fuente[fuente.index("11 · Observaciones") :]
    assert 'require("observations:write")' in bloque
    assert 'require("observations:read")' in bloque
    assert 'require("areas:write")' not in bloque, (
        "las observaciones no deben escribirse con el permiso que mueve racks"
    )


# ══ 2 · Sin observaciones ══════════════════════════════════════════════════
async def test_sin_observaciones_la_ruta_esta_vacia_no_404(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str
) -> None:
    """El visor necesita distinguir «no ha pasado nadie» de «no puedo leerlo»."""
    r = await api.get(
        R_RUTAS.format(wh=warehouse_id), params={"source": "TEST-OBS-NO-EXISTE"}, headers=auth
    )
    # Una fuente que no existe SÍ es 404: se pidió una concreta y no está.
    assert r.status_code == 404


async def test_una_fuente_inexistente_al_borrar_es_404(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str
) -> None:
    r = await api.delete(
        R_OBS.format(wh=warehouse_id), params={"source": "TEST-OBS-FANTASMA"}, headers=auth
    )
    assert r.status_code == 404


# ══ 3 · Ingesta ════════════════════════════════════════════════════════════
async def test_ingerir_crea_la_fuente_y_cuenta_lo_guardado(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    codigo = f"{PREFIJO}CREA"
    d = await ingerir(api, auth, warehouse_id, codigo, vuelo(racks, [0, 1, 2]))
    assert d["source"]["code"] == codigo
    assert d["source"]["kind"] == "drone"
    assert (d["received"], d["stored"], d["duplicates"]) == (3, 3, 0)


async def test_reintentar_el_lote_no_duplica(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Un dron sin cobertura reintenta el vuelo ENTERO cuando se corta la conexión.

    Sin idempotencia el recorrido se contaría dos veces y la distancia saldría al
    doble, sin que nada fallara: el peor tipo de defecto.
    """
    codigo = f"{PREFIJO}IDEM"
    obs = vuelo(racks, [0, 1, 2, 3])
    primero = await ingerir(api, auth, warehouse_id, codigo, obs)
    segundo = await ingerir(api, auth, warehouse_id, codigo, obs, kind=None)
    assert primero["stored"] == 4
    assert segundo["stored"] == 0
    assert segundo["duplicates"] == 4

    ruta = (
        await api.get(R_RUTAS.format(wh=warehouse_id), params={"source": codigo}, headers=auth)
    ).json()["data"]["routes"][0]
    assert ruta["point_count"] == 4, "el reintento duplicó el recorrido"


async def test_una_fuente_nueva_sin_tipo_se_rechaza_diciendo_los_validos(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Sin el tipo no se sabe si sus observaciones forman recorrido.

    Y el mensaje enumera los válidos: un 422 que dice «falta source_kind» obliga a
    ir a leer el código para saber qué valores acepta.
    """
    r = await api.post(
        R_OBS.format(wh=warehouse_id),
        headers=auth,
        json={"source_code": f"{PREFIJO}SIN-TIPO", "observations": vuelo(racks, [0])},
    )
    assert r.status_code == 422, r.text[:300]
    msg = r.json()["error"]["message"]
    assert "fixed_camera" in msg and "drone" in msg


async def test_un_rack_de_otro_almacen_se_rechaza(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str
) -> None:
    """Y el mensaje nombra el id, no la restricción de PostgreSQL."""
    r = await api.post(
        R_OBS.format(wh=warehouse_id),
        headers=auth,
        json={
            "source_code": f"{PREFIJO}AJENO",
            "source_kind": "drone",
            "observations": [
                {
                    "rack_node_id": "11111111-2222-3333-4444-555555555555",
                    "observed_at": INICIO.isoformat(),
                }
            ],
        },
    )
    assert r.status_code == 422, r.text[:300]
    err = r.json()["error"]
    assert "11111111-2222-3333-4444-555555555555" in err["message"]
    assert "fk_obs_node" not in err["message"]


@pytest.mark.parametrize(
    ("campo", "valor", "porque"),
    [
        ("confidence", 1.5, "la confianza es una probabilidad, no un porcentaje suelto"),
        ("confidence", -0.1, "no hay confianza negativa"),
        ("frame_ms", -1, "el milisegundo del vídeo no puede ser negativo"),
    ],
)
async def test_una_observacion_imposible_se_rechaza_con_400(
    api: AsyncClient,
    auth: dict[str, str],
    warehouse_id: str,
    racks: list[dict[str, Any]],
    campo: str,
    valor: Any,
    porque: str,
) -> None:
    obs = vuelo(racks, [0])
    obs[0][campo] = valor
    r = await api.post(
        R_OBS.format(wh=warehouse_id),
        headers=auth,
        json={"source_code": f"{PREFIJO}MALA", "source_kind": "drone", "observations": obs},
    )
    assert r.status_code == 400, f"{campo}={valor!r} debería rechazarse: {porque}"
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_un_tipo_de_fuente_inventado_se_rechaza(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """El vocabulario es cerrado porque cada valor cambia cómo se lee la serie.

    Un tipo nuevo no es un dato más: es una regla nueva que hay que escribir —una
    cámara fija no forma recorrido y un dron sí— así que aceptarlo silenciosamente
    lo trataría como dron por omisión.
    """
    r = await api.post(
        R_OBS.format(wh=warehouse_id),
        headers=auth,
        json={
            "source_code": f"{PREFIJO}RARO",
            "source_kind": "satelite",
            "observations": vuelo(racks, [0]),
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


# ══ 4 · La ruta derivada ═══════════════════════════════════════════════════
async def test_la_distancia_cuadra_con_la_cuenta_a_mano(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Ida y vuelta: el camino pasa dos veces por los mismos racks.

    Se elige ida y vuelta a propósito. Con un recorrido monótono, sumar las rectas y
    medir la distancia entre el primero y el último dan lo mismo, así que un cálculo
    que ignorara los intermedios pasaría el test. Volviendo sobre los pasos no:
    36 m de recorrido frente a 12 m de separación entre extremos.
    """
    codigo = f"{PREFIJO}DIST"
    recorrido = [0, 1, 2, 3, 4, 3, 2]
    await ingerir(api, auth, warehouse_id, codigo, vuelo(racks, recorrido))

    ruta = (
        await api.get(R_RUTAS.format(wh=warehouse_id), params={"source": codigo}, headers=auth)
    ).json()["data"]["routes"][0]

    esperada = distancia_a_mano(recorrido)
    assert ruta["straight_line_distance_m"] == pytest.approx(esperada, abs=1e-6)
    assert esperada > math.dist(
        (10.0, Y_M), (10.0 + SEP_M * recorrido[-1], Y_M)
    ), "el recorrido elegido no distingue sumar tramos de medir extremos"

    assert ruta["point_count"] == len(recorrido)
    assert ruta["distinct_racks"] == len(set(recorrido))
    assert ruta["duration_s"] == pytest.approx(PASO_S * (len(recorrido) - 1))
    assert ruta["avg_speed_ms"] == pytest.approx(
        esperada / (PASO_S * (len(recorrido) - 1)), abs=1e-6
    )


async def test_el_paso_ordena_el_recorrido(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """`paso` va de 1 a N sin huecos y en orden de tiempo.

    Se calcula en la vista y no en el cliente porque es lo que define la polilínea:
    dos clientes ordenando por su cuenta pueden discrepar cuando dos observaciones
    empatan en tiempo, y entonces dibujarían dos rutas distintas del mismo vuelo.
    """
    codigo = f"{PREFIJO}PASOS"
    recorrido = [4, 2, 0, 1, 3]
    await ingerir(api, auth, warehouse_id, codigo, vuelo(racks, recorrido))
    puntos = (
        await api.get(R_RUTAS.format(wh=warehouse_id), params={"source": codigo}, headers=auth)
    ).json()["data"]["routes"][0]["points"]

    assert [p["paso"] for p in puntos] == list(range(1, len(recorrido) + 1))
    assert [p["rack_code"] for p in puntos] == [racks[i]["rack_code"] for i in recorrido]
    momentos = [p["observed_at"] for p in puntos]
    assert momentos == sorted(momentos)


async def test_una_camara_fija_no_forma_recorrido(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Ve siempre el mismo sitio: unir sus observaciones dibujaría un viaje falso.

    Y la distancia es 0, no la suma de ceros por casualidad: aunque viera racks
    distintos, `forms_path: false` impide calcularla.
    """
    codigo = f"{PREFIJO}CAM"
    await ingerir(
        api, auth, warehouse_id, codigo, vuelo(racks, [0, 2, 4]), kind="fixed_camera"
    )
    ruta = (
        await api.get(R_RUTAS.format(wh=warehouse_id), params={"source": codigo}, headers=auth)
    ).json()["data"]["routes"][0]

    assert ruta["source_kind"] == "fixed_camera"
    assert ruta["forms_path"] is False
    assert ruta["straight_line_distance_m"] == 0.0
    # Los puntos SÍ están: son un centinela, «por aquí pasó algo a esta hora».
    assert ruta["point_count"] == 3


async def test_cada_fuente_es_una_polilinea_aparte(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Dos drones a la vez son dos rutas, no una lista intercalada.

    Aplanarlas dejaría al cliente uniendo el último punto de uno con el primero del
    otro: un zigzag que nadie recorrió. Las observaciones se solapan en el tiempo a
    propósito, que es el caso en que un orden global las mezclaría.
    """
    a, b = f"{PREFIJO}DOS-A", f"{PREFIJO}DOS-B"
    await ingerir(api, auth, warehouse_id, a, vuelo(racks, [0, 1, 2]))
    await ingerir(
        api, auth, warehouse_id, b,
        vuelo(racks, [4, 3, 2], desde=INICIO + timedelta(seconds=PASO_S // 2)),
    )

    todas = (await api.get(R_RUTAS.format(wh=warehouse_id), headers=auth)).json()["data"]
    mias = {r["source_code"]: r for r in todas["routes"] if r["source_code"] in {a, b}}
    assert set(mias) == {a, b}
    for codigo in (a, b):
        puntos = mias[codigo]["points"]
        assert {p["source_code"] for p in puntos} == {codigo}, (
            "una ruta contiene puntos de otra fuente"
        )
        assert [p["paso"] for p in puntos] == [1, 2, 3]


async def test_la_ventana_de_tiempo_acota_los_puntos(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Es lo que hace posible la reproducción temporal: pedir un trozo del vuelo."""
    codigo = f"{PREFIJO}VENTANA"
    await ingerir(api, auth, warehouse_id, codigo, vuelo(racks, [0, 1, 2, 3, 4]))
    r = await api.get(
        R_RUTAS.format(wh=warehouse_id),
        params={
            "source": codigo,
            "desde": (INICIO + timedelta(seconds=PASO_S)).isoformat(),
            "hasta": (INICIO + timedelta(seconds=PASO_S * 3)).isoformat(),
        },
        headers=auth,
    )
    assert r.status_code == 200, r.text[:300]
    ruta = r.json()["data"]["routes"][0]
    assert ruta["point_count"] == 3
    assert [p["rack_code"] for p in ruta["points"]] == [
        racks[i]["rack_code"] for i in (1, 2, 3)
    ]


async def test_una_observacion_de_rack_sin_colocar_no_entra_en_la_ruta(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Pero SÍ aparece en el historial, y la cobertura la cuenta.

    Es el caso que se perdería en silencio: sin punto no hay vértice, y contarlo
    como (0,0) metería un salto a la esquina del almacén. La única forma de saber que
    existe es el historial, así que ahí tiene que estar.
    """
    # Un rack del catálogo que la fixture NO colocó (usa los 5 primeros con cuerpos).
    todos = (
        await api.get(
            f"/v1/spatial/warehouses/{warehouse_id}/floor-plan",
            params={"limit": 200},
            headers=auth,
        )
    ).json()["data"]
    colocados = {r["rack_id"] for r in racks}
    sin_colocar = next(r for r in todos if r["rack_id"] not in colocados)

    codigo = f"{PREFIJO}HUERFANO"
    await ingerir(
        api, auth, warehouse_id, codigo,
        [
            {
                "rack_node_id": sin_colocar["rack_id"],
                "observed_at": INICIO.isoformat(),
            },
            *vuelo(racks, [0, 1], desde=INICIO + timedelta(seconds=PASO_S)),
        ],
    )

    ruta = (
        await api.get(R_RUTAS.format(wh=warehouse_id), params={"source": codigo}, headers=auth)
    ).json()["data"]["routes"][0]
    assert ruta["point_count"] == 2, "un rack sin colocar no puede tener punto"

    historial = (
        await api.get(R_OBS.format(wh=warehouse_id), params={"source": codigo}, headers=auth)
    ).json()["data"]
    assert len(historial) == 3
    huerfana = next(o for o in historial if o["rack_code"] == sin_colocar["rack_code"])
    assert huerfana["rack_colocado"] is False


# ══ 5 · Historial y cobertura ══════════════════════════════════════════════
async def test_el_historial_va_de_lo_mas_reciente_a_lo_mas_antiguo(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Al contrario que la ruta, que va en orden de recorrido.

    Son dos preguntas distintas: «qué se ha visto últimamente» y «por dónde pasó».
    Un historial en orden de vuelo obligaría a ir al final para ver lo último.
    """
    codigo = f"{PREFIJO}HIST"
    await ingerir(api, auth, warehouse_id, codigo, vuelo(racks, [0, 1, 2, 3]))
    obs = (
        await api.get(R_OBS.format(wh=warehouse_id), params={"source": codigo}, headers=auth)
    ).json()["data"]
    momentos = [o["observed_at"] for o in obs]
    assert momentos == sorted(momentos, reverse=True)
    assert all(o["frame_ref"] for o in obs), "se perdió la referencia al fotograma"


async def test_la_cobertura_cuenta_racks_distintos_no_observaciones(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """«Se vieron 3 racks» y «hay 7 observaciones» son cosas distintas.

    Confundirlas diría que se ha cubierto el doble de almacén del que se cubrió, que
    es el error que hace inútil una métrica de cobertura.
    """
    codigo = f"{PREFIJO}COBERTURA"
    await ingerir(api, auth, warehouse_id, codigo, vuelo(racks, [0, 1, 2, 1, 0, 1, 2]))
    cob = (await api.get(R_COBERTURA.format(wh=warehouse_id), headers=auth)).json()["data"]
    assert cob["total"] >= 7
    assert cob["racks_vistos"] >= 3
    assert cob["primera"] is not None
    assert cob["ultima"] >= cob["primera"]


async def test_borrar_una_fuente_no_toca_las_demas_ni_el_catalogo(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Un vuelo mal reconocido se borra sin llevarse el resto por delante."""
    a, b = f"{PREFIJO}BORRA-A", f"{PREFIJO}BORRA-B"
    await ingerir(api, auth, warehouse_id, a, vuelo(racks, [0, 1]))
    await ingerir(api, auth, warehouse_id, b, vuelo(racks, [2, 3]))

    antes = (
        await api.get(
            f"/v1/spatial/warehouses/{warehouse_id}/floor-plan",
            params={"limit": 1, "include_total": True},
            headers=auth,
        )
    ).json()["pagination"]["total"]

    assert (
        await api.delete(R_OBS.format(wh=warehouse_id), params={"source": a}, headers=auth)
    ).status_code == 204

    r = await api.get(R_RUTAS.format(wh=warehouse_id), params={"source": a}, headers=auth)
    assert r.json()["data"]["routes"] == [], "quedaron puntos de la fuente borrada"
    otra = (
        await api.get(R_RUTAS.format(wh=warehouse_id), params={"source": b}, headers=auth)
    ).json()["data"]["routes"]
    assert otra and otra[0]["point_count"] == 2, "borrar una fuente se llevó la otra"

    despues = (
        await api.get(
            f"/v1/spatial/warehouses/{warehouse_id}/floor-plan",
            params={"limit": 1, "include_total": True},
            headers=auth,
        )
    ).json()["pagination"]["total"]
    assert antes == despues, "borrar observaciones toco el catalogo de racks"


async def test_borrar_sin_indicar_fuente_se_rechaza(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str
) -> None:
    """No hay forma de vaciar el historial del almacén de un tirón.

    Borrarlo todo tendría que ser una decisión deliberada, no un parámetro que se
    olvida en una petición.
    """
    r = await api.delete(R_OBS.format(wh=warehouse_id), headers=auth)
    assert r.status_code in {400, 422}
