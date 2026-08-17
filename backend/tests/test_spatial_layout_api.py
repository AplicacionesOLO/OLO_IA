"""Pruebas del layout del plano —publicar, leer, retirar— contra Supabase REAL.

Marcada `integration`: necesita el catálogo importado, porque una colocación
apunta a un rack que tiene que existir.

    pytest -m integration tests/test_spatial_layout_api.py

── POR QUÉ ESCRIBE EN LA BASE COMPARTIDA ────────────────────────────────────

Publicar es la operación que importa y no se puede simular: lo que se está
comprobando es que la FK compuesta y las policies de RLS aceptan la fila. Un
doble en memoria aprobaría exactamente los casos que aquí interesan fallar.

Así que escribe, y por eso el módulo se ocupa de no dejar rastro: la fixture
`layout_intacto` guarda el layout que hubiera publicado antes de tocar nada y lo
vuelve a publicar al terminar. Si el módulo se interrumpe a media prueba el
almacén se queda con un layout de prueba —tres racks en x≈10— y basta con
volver a publicar desde el editor.

── LO QUE CADA PRUEBA HACE CONCLUYENTE ──────────────────────────────────────

El usuario es `warehouse_manager`: tiene `areas:write` y acceso a UN almacén de
los dos que existen. Eso convierte dos pruebas en no aprobables por accidente:

  · `test_un_rack_de_otro_almacen_se_rechaza` falla si la comprobación previa
    del servicio desaparece Y la FK compuesta deja de estar, no si falta una de
    las dos;
  · `test_publicar_es_atomico` falla si el layout se guarda cuando las
    colocaciones no, que es el estado que produce un mapa que miente.
"""

from __future__ import annotations

import math
import os
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

RUTA = "/v1/spatial/warehouses/{wh}/layout"


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
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60.0) as client:
        yield client
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
    """Tres racks reales CON CUERPOS. Sus ids son los únicos que la FK acepta.

    Con cuerpos y no los tres primeros que salgan: los primeros por código son
    `ASCEN1`, `ASCEN2` y `ASCN01` —ascensores con 2 ubicaciones y ningún cuerpo— y
    sobre ellos la derivación de geometría no tiene nada que repartir. Un rack sin
    cuerpos haría pasar las pruebas de colocación y vaciar las de geometría sin que
    ninguna fallara, que es la forma más silenciosa de no probar nada.
    """
    r = await api.get(
        f"/v1/spatial/warehouses/{warehouse_id}/floor-plan",
        params={"limit": 200},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text[:300]
    con_cuerpos = [f for f in r.json()["data"] if f["bay_count"] > 0]
    assert len(con_cuerpos) >= 3, "el catálogo tiene menos de 3 racks con cuerpos"
    return [dict(f) for f in con_cuerpos[:3]]


@pytest.fixture(scope="module", autouse=True)
async def layout_intacto(
    api: AsyncClient, token: str, warehouse_id: str
) -> AsyncIterator[None]:
    """Devuelve el almacén al layout que tenía antes de que el módulo escribiera.

    `autouse`: olvidar pedirla dejaría basura en la base compartida, y ese olvido
    no se ve al leer el test que la olvidó.
    """
    h = {"Authorization": f"Bearer {token}"}
    previo = (await api.get(RUTA.format(wh=warehouse_id), headers=h)).json()["data"]
    yield
    await api.delete(RUTA.format(wh=warehouse_id), headers=h)
    if previo["layout"] is None:
        return
    lay = previo["layout"]
    await api.put(
        RUTA.format(wh=warehouse_id),
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
                    "x_m": p["x_m"],
                    "y_m": p["y_m"],
                    "rotation_deg": p["rotation_deg"],
                    "width_m": p["width_m"],
                    "length_m": p["length_m"],
                    "height_m": p["height_m"],
                    "color": p["color"],
                    "is_locked": p["is_locked"],
                    #  Los grupos TAMBIEN se devuelven. Sin esta línea el módulo dejaba el
                    #  almacén con los racks dobles separados: la restauración parecía
                    #  completa —mismo número de colocaciones, mismas coordenadas— y solo se
                    #  notaría al arrastrar media pareja en el editor.
                    "group_key": p.get("group_key"),
                }
                for p in previo["placements"]
            ],
        },
    )


def cuerpo(racks: list[dict[str, Any]], **cambios: Any) -> dict[str, Any]:
    """Publicación válida de 3 racks. `cambios` sustituye claves del nivel raíz."""
    base: dict[str, Any] = {
        "plan_name": "prueba-layout.png",
        "plan_width_px": 3200,
        "plan_height_px": 909,
        "pixels_per_meter": 26.72,
        "origin_x_px": 0.0,
        "origin_y_px": 0.0,
        "is_calibrated": True,
        "placements": [
            {
                "rack_node_id": r["rack_id"],
                "x_m": 10.0 + i * 3,
                "y_m": 4.25,
                "rotation_deg": 37.5 if i == 0 else 0.0,
                "width_m": 1.1,
                "length_m": 12.0,
                "height_m": 8.5,
                "color": "#f59e0b" if i == 1 else None,
                "is_locked": i == 2,
            }
            for i, r in enumerate(racks)
        ],
    }
    base.update(cambios)
    return base


# ══ 1 · Contrato ═══════════════════════════════════════════════════════════
async def test_las_tres_operaciones_estan_publicadas(api: AsyncClient) -> None:
    paths = api._transport.app.openapi()["paths"]  # type: ignore[attr-defined]
    metodos = paths["/v1/spatial/warehouses/{warehouse_id}/layout"]
    assert set(metodos) == {"get", "put", "delete"}


@pytest.mark.parametrize("metodo", ["get", "put", "delete"])
async def test_sin_token_es_401(api: AsyncClient, metodo: str, warehouse_id: str) -> None:
    r = await api.request(metodo.upper(), RUTA.format(wh=warehouse_id))
    assert r.status_code == 401


async def test_un_almacen_ajeno_es_404_no_403(api: AsyncClient, auth: dict[str, str]) -> None:
    """404 y no 403: un 403 confirmaría que el almacén existe."""
    ajeno = "00000000-0000-0000-0000-0000000000ff"
    r = await api.get(RUTA.format(wh=ajeno), headers=auth)
    assert r.status_code == 404, r.text[:300]


# ══ 2 · Sin plano publicado ════════════════════════════════════════════════
async def test_sin_layout_devuelve_hueco_vacio_no_404(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str
) -> None:
    """El editor necesita distinguir «no hay plano» de «no puedo leerlo»."""
    await api.delete(RUTA.format(wh=warehouse_id), headers=auth)
    r = await api.get(RUTA.format(wh=warehouse_id), headers=auth)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["data"] == {
        "layout": None,
        "placements": [],
        "published": None,
        "calibrated": None,
        "derived_locations": None,
    }


async def test_retirar_lo_que_no_existe_es_404(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str
) -> None:
    await api.delete(RUTA.format(wh=warehouse_id), headers=auth)
    r = await api.delete(RUTA.format(wh=warehouse_id), headers=auth)
    assert r.status_code == 404


# ══ 3 · Publicar y releer ══════════════════════════════════════════════════
async def test_publicar_devuelve_lo_que_se_lee_despues(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """La respuesta de PUT y la de GET describen el mismo layout.

    No es redundante: PUT devuelve lo que acaba de insertar y GET lo lee de la
    vista `v_rack_placements`, que es otro camino. Si la vista se quedara atrás
    —una columna renombrada, un JOIN mal— el editor recargaría otra cosa de la
    que guardó.
    """
    puesto = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks))
    assert puesto.status_code == 200, puesto.text[:400]
    leido = await api.get(RUTA.format(wh=warehouse_id), headers=auth)
    assert leido.status_code == 200

    a, b = puesto.json()["data"], leido.json()["data"]
    assert a["placements"] == b["placements"]
    assert a["layout"]["id"] == b["layout"]["id"]
    assert a["published"] == 3
    assert b["published"] is None, "leer no publica nada, no hay recuento que dar"


async def test_los_metros_llegan_y_vuelven_sin_redondearse(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Un milímetro sobrevive al viaje.

    El editor permite mover 1 mm; si la columna fuera `numeric(6,2)` o el esquema
    devolviera enteros, el rack «volvería» a 10,00 al recargar y el usuario lo
    viviría como que no se guarda.
    """
    c = cuerpo(racks)
    c["placements"][0]["x_m"] = 10.001
    c["placements"][0]["rotation_deg"] = 37.5
    await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    p = (await api.get(RUTA.format(wh=warehouse_id), headers=auth)).json()["data"]["placements"]
    mio = next(x for x in p if x["rack_node_id"] == racks[0]["rack_id"])
    assert mio["x_m"] == pytest.approx(10.001, abs=1e-6)
    assert mio["rotation_deg"] == pytest.approx(37.5, abs=1e-6)


async def test_republicar_reemplaza_y_no_acumula(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Publicar es «este es el layout completo», no «añade estos racks»."""
    await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks))
    recortado = cuerpo(racks)
    recortado["placements"] = recortado["placements"][:1]
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=recortado)
    assert r.status_code == 200, r.text[:300]
    assert len(r.json()["data"]["placements"]) == 1


async def test_republicar_mantiene_el_mismo_layout(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """El id no cambia y `updated_at` sí: es el mismo espacio de trabajo editado.

    Si cada publicación creara un layout nuevo, `uq_layout_warehouse` lo
    rechazaría; esta prueba comprueba que el `ON CONFLICT` está haciendo su
    trabajo en lugar de que la unicidad esté haciendo de red.
    """
    uno = (
        await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks))
    ).json()["data"]["layout"]
    dos = (
        await api.put(
            RUTA.format(wh=warehouse_id),
            headers=auth,
            json=cuerpo(racks, plan_name="otro-plano.png"),
        )
    ).json()["data"]["layout"]
    assert uno["id"] == dos["id"]
    assert dos["plan_name"] == "otro-plano.png"
    assert dos["updated_at"] >= uno["updated_at"]


async def test_publicar_sin_racks_deja_el_espacio_de_trabajo(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Calibrar el plano antes de colocar nada es un estado legítimo y se guarda."""
    r = await api.put(
        RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks, placements=[])
    )
    assert r.status_code == 200, r.text[:300]
    d = r.json()["data"]
    assert d["placements"] == []
    assert d["layout"]["pixels_per_meter"] == pytest.approx(26.72)
    assert d["published"] == 0


async def test_sin_calibrar_se_publica_pero_se_declara(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """No se prohíbe guardar a medias, pero la respuesta lo dice.

    Un layout sin calibrar tiene las posiciones en la escala por defecto; el
    editor tiene que poder avisar antes de que alguien mida sobre él.
    """
    r = await api.put(
        RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks, is_calibrated=False)
    )
    assert r.status_code == 200, r.text[:300]
    assert r.json()["data"]["calibrated"] is False
    assert r.json()["data"]["layout"]["is_calibrated"] is False


# ══ 4 · Lo que la base no debe aceptar ═════════════════════════════════════
async def test_un_rack_de_otro_almacen_se_rechaza(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Y el mensaje nombra el id, no la restricción de PostgreSQL.

    El id usado no es de otro almacén: no existe. Da igual —ambos casos son el
    mismo para quien publica, «ese rack no es de aquí»— y un uuid inventado no
    depende de que el segundo almacén tenga catálogo.
    """
    c = cuerpo(racks)
    c["placements"][0]["rack_node_id"] = "11111111-2222-3333-4444-555555555555"
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert r.status_code == 422, r.text[:300]
    cuerpo_err = r.json()["error"]
    assert cuerpo_err["code"] == "BUSINESS_RULE_VIOLATION"
    assert "11111111-2222-3333-4444-555555555555" in cuerpo_err["message"]
    assert "fk_placement_node" not in cuerpo_err["message"]


async def test_publicar_es_atomico(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Una publicación rechazada no deja NI el layout NI las colocaciones.

    Es el caso que produce un mapa que miente: escala nueva con racks viejos.
    Se publica algo válido, se intenta algo inválido con OTRA escala, y lo que
    queda tiene que ser exactamente lo primero.
    """
    bueno = cuerpo(racks)
    await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=bueno)

    malo = cuerpo(racks, pixels_per_meter=99.0, plan_name="no-debe-quedar.png")
    malo["placements"][2]["rack_node_id"] = "11111111-2222-3333-4444-555555555555"
    assert (
        await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=malo)
    ).status_code == 422

    d = (await api.get(RUTA.format(wh=warehouse_id), headers=auth)).json()["data"]
    assert d["layout"]["plan_name"] == "prueba-layout.png"
    assert d["layout"]["pixels_per_meter"] == pytest.approx(26.72)
    assert len(d["placements"]) == 3


@pytest.mark.parametrize(
    ("campo", "valor", "porque"),
    [
        ("rotation_deg", 360.0, "360 es 0; el rango es [0,360) para que no haya dos"),
        ("rotation_deg", -1.0, "girar en negativo se normaliza en el editor, no aquí"),
        ("width_m", 0.0, "un rack de ancho cero no se puede dibujar ni clicar"),
        ("width_m", 500.0, "medio kilómetro de ancho es una unidad equivocada"),
        ("height_m", 61.0, "60 m es el tope; más alto es un error de unidades"),
        ("x_m", 99999.0, "coordenada en píxeles colada como metros"),
        ("color", "rojo", "el canvas necesita #rrggbb, no un nombre"),
        ("color", "#ff00", "hex incompleto"),
    ],
)
async def test_una_colocacion_imposible_se_rechaza_con_400(
    api: AsyncClient,
    auth: dict[str, str],
    warehouse_id: str,
    racks: list[dict[str, Any]],
    campo: str,
    valor: Any,
    porque: str,
) -> None:
    c = cuerpo(racks)
    c["placements"][0][campo] = valor
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert r.status_code == 400, f"{campo}={valor!r} debería rechazarse: {porque}"
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_el_mismo_rack_dos_veces_se_rechaza(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Un rack está en un sitio. Dos colocaciones del mismo rack son dos sitios,
    y el visor 3D no sabría cuál dibujar."""
    c = cuerpo(racks)
    c["placements"][1]["rack_node_id"] = c["placements"][0]["rack_node_id"]
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert r.status_code in {400, 409, 422}, r.text[:400]
    assert r.status_code != 500, "una violación de unicidad no es un error interno"


# ══ 4b · Racks agrupados: el rack doble ════════════════════════════════════
#
# Dos racks puestos de espaldas forman un rack doble con los frentes opuestos. Mover uno sin
# el otro lo partiría por la mitad, así que quien modela los agrupa y el grupo VIAJA CON EL
# PLANO — si viviera solo en el navegador, el rack doble sería doble para quien lo modeló y
# dos racks sueltos para todos los demás—.
async def test_los_agrupados_conservan_la_clave(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    c = cuerpo(racks)
    c["placements"][0]["group_key"] = "g-PAREJA"
    c["placements"][1]["group_key"] = "g-PAREJA"
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert r.status_code == 200, r.text[:400]

    leido = (await api.get(RUTA.format(wh=warehouse_id), headers=auth)).json()["data"]
    por_nodo = {p["rack_node_id"]: p["group_key"] for p in leido["placements"]}
    assert por_nodo[c["placements"][0]["rack_node_id"]] == "g-PAREJA"
    assert por_nodo[c["placements"][1]["rack_node_id"]] == "g-PAREJA"
    #  El tercero sigue suelto: agrupar dos no arrastra al resto del plano.
    assert por_nodo[c["placements"][2]["rack_node_id"]] is None


async def test_una_clave_de_solo_espacios_se_rechaza(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Esto pasaba: 200, y el rack se quedaba sin grupo.

    `min_length=1` no para `'   '` —mide tres— y el repositorio lo normalizaba a `NULL`. Se
    midió publicando las 30 colocaciones reales con espacios en la primera: la respuesta fue
    200 y en la base quedó `RCL21 → NULL` con `RCL22 → g-RCL21-RCL22`. Media pareja
    desagrupada, sin un solo aviso, y en pantalla no se ve — hasta que alguien arrastra una
    mitad del rack doble y lo parte—.
    """
    c = cuerpo(racks)
    c["placements"][0]["group_key"] = "g-PAREJA"
    c["placements"][1]["group_key"] = "   "
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert r.status_code == 400, f"una clave en blanco no puede salir {r.status_code}"
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_un_grupo_de_un_solo_rack_se_rechaza(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """0096 justificó la clave en la propia colocación diciendo que así no quedan grupos
    huérfanos. Un grupo de uno es ese huérfano: no agrupa nada y quien mire la base creerá
    que al rack le falta la pareja."""
    c = cuerpo(racks)
    c["placements"][0]["group_key"] = "g-SOLO"
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert r.status_code == 400, r.text[:400]


async def test_desagrupar_es_publicar_sin_la_clave(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Separar no tiene endpoint propio: se republica sin clave y no queda rastro."""
    c = cuerpo(racks)
    c["placements"][0]["group_key"] = "g-PAREJA"
    c["placements"][1]["group_key"] = "g-PAREJA"
    await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)

    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks))
    assert r.status_code == 200, r.text[:400]
    leido = (await api.get(RUTA.format(wh=warehouse_id), headers=auth)).json()["data"]
    assert all(p["group_key"] is None for p in leido["placements"])


# ══ 5 · Retirar ════════════════════════════════════════════════════════════
async def test_retirar_arrastra_las_colocaciones(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """El CASCADE de `layout_id`: retirar el plano no deja colocaciones huérfanas
    apuntando a una escala que ya no existe."""
    await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks))
    assert (await api.delete(RUTA.format(wh=warehouse_id), headers=auth)).status_code == 204
    d = (await api.get(RUTA.format(wh=warehouse_id), headers=auth)).json()["data"]
    assert d["layout"] is None
    assert d["placements"] == []


async def test_retirar_no_toca_el_catalogo(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """La colocación es una capa SOBRE el catálogo, no parte de él.

    Si el CASCADE fuera al revés —del rack a la colocación está bien; de la
    colocación al rack sería catastrófico— retirar un plano borraría 347 racks y
    29.310 ubicaciones importadas del Excel.
    """
    antes = (
        await api.get(
            f"/v1/spatial/warehouses/{warehouse_id}/floor-plan",
            params={"limit": 1, "include_total": True},
            headers=auth,
        )
    ).json()["pagination"]["total"]
    await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=cuerpo(racks))
    await api.delete(RUTA.format(wh=warehouse_id), headers=auth)
    despues = (
        await api.get(
            f"/v1/spatial/warehouses/{warehouse_id}/floor-plan",
            params={"limit": 1, "include_total": True},
            headers=auth,
        )
    ).json()["pagination"]["total"]
    assert antes == despues


# ══ 6 · Geometría derivada (0066) ═══════════════════════════════════════════
#
# Lo que hace concluyentes estas pruebas: la posición esperada se calcula AQUÍ, en
# Python, con trigonometría escrita a mano. No se compara el endpoint con otra
# consulta al mismo dato —eso aprobaría igual si las dos estuvieran mal—; se
# compara con una cuenta independiente, y dos cuentas equivocadas no coinciden al
# micrómetro con un giro de 37,5 grados.


def _ubicaciones_del_rack(datos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Solo las que tienen cuerpo y nivel: son las que se pueden situar."""
    return [u for u in datos if u.get("bay_code") and u.get("level") is not None]


async def test_publicar_calibrado_deriva_la_geometria(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Y el recuento coincide con las ubicaciones del rack colocado.

    `derived_locations` no es decorativo: es cómo el operador sabe que publicar
    hizo algo más que guardar un dibujo.
    """
    uno = racks[0]
    c = cuerpo(racks)
    c["placements"] = [c["placements"][0]]
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert r.status_code == 200, r.text[:400]
    assert r.json()["data"]["derived_locations"] == uno["location_count"]


async def test_la_posicion_derivada_cuadra_con_la_trigonometria(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Cuerpo a cuerpo y nivel a nivel, con el rack girado.

    El giro es 37,5 grados a propósito y no 90: con múltiplos de 90 el seno y el
    coseno son 0 y ±1, así que confundir los dos ejes o perder el signo daría el
    mismo resultado y el test pasaría.
    """
    rack = racks[0]
    x, y, rot = 40.0, 12.0, 37.5
    ancho, largo, alto = 1.10, 12.0, 8.50

    c = cuerpo(racks)
    c["placements"] = [
        {
            "rack_node_id": rack["rack_id"],
            "x_m": x, "y_m": y, "rotation_deg": rot,
            "width_m": ancho, "length_m": largo, "height_m": alto,
            "color": None, "is_locked": False,
        }
    ]
    assert (
        await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    ).status_code == 200

    datos = (
        await api.get(
            "/v1/spatial/locations",
            params={"warehouse_id": warehouse_id, "rack_id": rack["rack_id"], "limit": 200},
            headers=auth,
        )
    ).json()["data"]
    ubis = _ubicaciones_del_rack(datos)
    assert ubis, "el rack no tiene ubicaciones con cuerpo y nivel"

    cuerpos = sorted({u["bay_code"] for u in ubis})
    n = len(cuerpos)
    niveles = max(u["level"] for u in ubis)
    posiciones = max(u["position"] or 1 for u in ubis)
    rad = math.radians(rot)

    for u in ubis:
        i = cuerpos.index(u["bay_code"]) + 1
        uu = ((i - 0.5) / n) * largo - largo / 2
        vv = (((u["position"] or 1) - 0.5) / posiciones) * ancho - ancho / 2
        zz = ((u["level"] - 0.5) / niveles) * alto
        assert u["world_x_m"] == pytest.approx(
            x + uu * math.cos(rad) - vv * math.sin(rad), abs=1e-6
        ), u["full_code"]
        assert u["world_y_m"] == pytest.approx(
            y + uu * math.sin(rad) + vv * math.cos(rad), abs=1e-6
        ), u["full_code"]
        assert u["world_z_m"] == pytest.approx(zz, abs=1e-6), u["full_code"]


async def test_los_extremos_del_rack_son_simetricos(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """El primer y el último cuerpo caen a la misma distancia del centro.

    Es la prueba de que el rack se coloca por su CENTRO y no por una esquina: si el
    reparto no estuviera centrado, el primer cuerpo saldría en 0 y el último en el
    largo entero, y todo el rack aparecería desplazado media longitud en el mapa.
    """
    rack = racks[0]
    largo = 12.0
    c = cuerpo(racks)
    c["placements"] = [
        {
            "rack_node_id": rack["rack_id"],
            # Sin giro: aquí se mide la simetría, no la rotación.
            "x_m": 50.0, "y_m": 20.0, "rotation_deg": 0.0,
            "width_m": 1.10, "length_m": largo, "height_m": 8.0,
            "color": None, "is_locked": False,
        }
    ]
    assert (
        await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    ).status_code == 200

    datos = (
        await api.get(
            "/v1/spatial/locations",
            params={"warehouse_id": warehouse_id, "rack_id": rack["rack_id"], "limit": 200},
            headers=auth,
        )
    ).json()["data"]
    xs = [u["world_x_m"] for u in _ubicaciones_del_rack(datos)]
    assert min(xs) - 50.0 == pytest.approx(-(max(xs) - 50.0), abs=1e-6)
    # Y todo el rack cabe en su largo: nada se sale por los extremos.
    assert max(xs) - min(xs) < largo


async def test_sin_calibrar_no_se_deriva_nada(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Sin escala medida, «metros» no significa nada y no se escribe geometría.

    Y lo que hubiera derivado antes se LIMPIA: dejarlo sería geometría de una
    escala vieja colgando de una colocación nueva, que es indistinguible de un
    dato bueno.
    """
    rack = racks[0]
    c = cuerpo(racks)
    c["placements"] = [c["placements"][0]]
    assert (
        await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    ).status_code == 200

    sin_cal = cuerpo(racks, is_calibrated=False)
    sin_cal["placements"] = [sin_cal["placements"][0]]
    r = await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=sin_cal)
    assert r.status_code == 200, r.text[:300]
    assert r.json()["data"]["derived_locations"] == 0

    datos = (
        await api.get(
            "/v1/spatial/locations",
            params={"warehouse_id": warehouse_id, "rack_id": rack["rack_id"], "limit": 50},
            headers=auth,
        )
    ).json()["data"]
    assert all(u["world_x_m"] is None for u in datos)


async def test_retirar_borra_la_geometria_derivada(
    api: AsyncClient, auth: dict[str, str], warehouse_id: str, racks: list[dict[str, Any]]
) -> None:
    """Retirar el plano no deja 29.310 coordenadas apuntando a racks sin colocar."""
    rack = racks[0]
    c = cuerpo(racks)
    c["placements"] = [c["placements"][0]]
    await api.put(RUTA.format(wh=warehouse_id), headers=auth, json=c)
    assert (await api.delete(RUTA.format(wh=warehouse_id), headers=auth)).status_code == 204

    datos = (
        await api.get(
            "/v1/spatial/locations",
            params={"warehouse_id": warehouse_id, "rack_id": rack["rack_id"], "limit": 50},
            headers=auth,
        )
    ).json()["data"]
    assert all(u["world_x_m"] is None for u in datos)
    # `origin` no se toca ni al derivar ni al limpiar: dice de donde salio la
    # UBICACION, no su geometria. Si la derivacion lo pisara,
    # `warehouse_summary.inferred_count` —documentado como «una anomalia que hay que
    # poder contar»— pasaria de 0 a 29.310 al publicar un plano.
    assert all(u["origin"] == "catalog" for u in datos)
