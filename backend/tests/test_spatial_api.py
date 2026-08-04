"""Pruebas del explorador espacial contra Supabase REAL, con datos importados.

Marcada `integration`: necesita el catálogo de `ReporteUbicaciones.xlsx` ya
importado en `WH-001` (347 racks, 2.701 cuerpos, 29.310 ubicaciones).

    pytest -m integration tests/test_spatial_api.py

── Qué hacen concluyentes estas pruebas ────────────────────────────────────
El usuario del escenario es `warehouse_manager` con acceso a UN almacén de los
dos que existen. Todo lo que se afirma aquí se afirma DESPUÉS de que RLS haya
filtrado, así que:

  · un fallo de política se ve como «no veo mi almacén», no como un test verde;
  · una fuga entre tenants se vería como «veo dos almacenes» en
    `test_solo_ve_su_almacen`, que es la prueba que no se puede aprobar por
    accidente.

Las cifras están escritas a mano a propósito. Un test que compare el endpoint
con otra consulta al mismo dato pasaría igual si los dos estuvieran mal; 347,
2.701 y 29.310 vienen del archivo Excel, no de la base.
"""

from __future__ import annotations

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

# Contraseñas de los usuarios de prueba: fuera de git, en `.secrets\` (ver .gitignore).
_SCRATCH = Path(
    os.environ.get(
        "OLO_TEST_SCRATCH",
        r"C:\OLO_IA\.secrets",
    )
)
TEST_EMAIL = "mgr@olo-dev.test"

# Del archivo, no de la base. Ver la nota del módulo.
RACKS_ESPERADOS = 347
CUERPOS_ESPERADOS = 2701
UBICACIONES_IMPORTADAS = 29_310
# El seed crea 2 ubicaciones `opaque` colgadas de un `storage_area`. El total de
# la base es la suma, y distinguirlas importa: si el importador empezara a crear
# ubicaciones opacas, este número lo delataría.
UBICACIONES_SEED = 2
UBICACIONES_TOTALES = UBICACIONES_IMPORTADAS + UBICACIONES_SEED


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
    r = await api.post(
        "/v1/auth/login", json={"email": TEST_EMAIL, "password": _test_password()}
    )
    assert r.status_code == 200, f"login falló: {r.status_code} {r.text[:300]}"
    return str(r.json()["data"]["access_token"])


@pytest.fixture
def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
async def almacen(api: AsyncClient, token: str) -> dict[str, Any]:
    """El resumen del almacén con datos. Se resuelve UNA vez por módulo."""
    r = await api.get("/v1/spatial/warehouses", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text[:300]
    conteo = [w for w in r.json()["data"] if w["location_count"] > 0]
    if not conteo:
        pytest.skip("no hay catálogo espacial importado en ningún almacén accesible")
    return dict(conteo[0])


@pytest.fixture(scope="module")
async def rack(api: AsyncClient, token: str, almacen: dict[str, Any]) -> dict[str, Any]:
    """Un rack con cuerpos, para el alzado. No el primero cualquiera: uno que
    tenga cuerpos, porque un rack sin cuerpos no probaría el alzado."""
    r = await api.get(
        f"/v1/spatial/warehouses/{almacen['warehouse_id']}/floor-plan",
        params={"limit": 200},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text[:300]
    con_cuerpos = [c for c in r.json()["data"] if c["bay_count"] > 0]
    assert con_cuerpos, "ningún rack tiene cuerpos"
    return dict(max(con_cuerpos, key=lambda c: c["location_count"]))


# ══ 1 · Contrato y protección ══════════════════════════════════════════════
async def test_las_nueve_rutas_estan_publicadas(api: AsyncClient) -> None:
    paths = (await api.get("/openapi.json")).json()["paths"]
    esperadas = {
        "/v1/spatial/warehouses",
        "/v1/spatial/warehouses/{warehouse_id}/summary",
        "/v1/spatial/warehouses/{warehouse_id}/tree",
        "/v1/spatial/warehouses/{warehouse_id}/floor-plan",
        "/v1/spatial/nodes/{node_id}",
        "/v1/spatial/nodes/{node_id}/children",
        "/v1/spatial/racks/{rack_id}/front-view",
        "/v1/spatial/locations",
        "/v1/spatial/locations/{location_id}",
    }
    assert esperadas <= set(paths)
    # SOLO LECTURA: el catálogo se escribe por importador auditado. Si alguien
    # añade un POST aquí, esta prueba lo dice antes de que llegue a producción.
    for p in esperadas:
        assert set(paths[p]) == {"get"}, f"{p} expone algo más que GET: {set(paths[p])}"


@pytest.mark.parametrize(
    "path",
    [
        "/v1/spatial/warehouses",
        "/v1/spatial/locations",
        "/v1/spatial/nodes/00000000-0000-0000-0000-000000000000",
    ],
)
async def test_sin_token_es_401(api: AsyncClient, path: str) -> None:
    r = await api.get(path)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHENTICATED"


# ══ 2 · RLS: la prueba que no se aprueba por accidente ═════════════════════
async def test_solo_ve_su_almacen(api: AsyncClient, auth: dict[str, str]) -> None:
    """`warehouse_manager` tiene acceso a UN almacén; en la base hay dos.

    Si RLS o `core.can_access_warehouse()` fallaran, aquí saldrían dos. El test
    no comprueba que la lista «tenga datos»: comprueba cuántos NO tiene.
    """
    r = await api.get("/v1/spatial/warehouses", headers=auth)
    assert r.status_code == 200
    datos = r.json()["data"]
    assert len(datos) == 1, f"se ven {len(datos)} almacenes; RLS debería dejar 1"


async def test_un_almacen_ajeno_es_404_no_403(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """404 y no 403: un 403 confirmaría que el recurso existe."""
    ajeno = "11111111-2222-3333-4444-555555555555"
    r = await api.get(f"/v1/spatial/warehouses/{ajeno}/summary", headers=auth)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


# ══ 3 · Resumen: los números del archivo ═══════════════════════════════════
async def test_el_resumen_cuadra_con_el_archivo(almacen: dict[str, Any]) -> None:
    assert almacen["rack_count"] == RACKS_ESPERADOS
    assert almacen["bay_count"] == CUERPOS_ESPERADOS
    assert almacen["location_count"] == UBICACIONES_TOTALES
    # El importador NO inventa pasillos: la familia de letras del código abarca
    # 2 preámbulos, 2 tipos y 11 zonas, así que no es un pasillo (ADR-013).
    assert almacen["aisle_count"] == 0

    # ── `with_world_geometry` ya NO es siempre 0 ──────────────────────────
    #
    # Este test afirmaba `== 0` y era correcto: no existía ninguna medida métrica y
    # el comentario decía «eso llega con el importador CAD». La migración 0066 lo
    # cambió: la geometría se DERIVA de la colocación de los racks sobre un plano
    # calibrado, que sí es una medida de una persona.
    #
    # Así que ahora depende de si hay layout publicado, y eso lo decide otro módulo.
    # Volver a fijar el 0 haría fallar la suite según quién hubiera publicado antes
    # —el defecto de estado compartido más difícil de diagnosticar— así que lo que se
    # afirma es lo que sigue siendo INVARIANTE: la geometría es un subconjunto de las
    # ubicaciones, nunca inventa filas.
    assert 0 <= almacen["with_world_geometry"] <= almacen["location_count"]
    # Ni ubicaciones inferidas: todas vienen del catálogo.
    assert almacen["inferred_count"] == 0
    # Las 2 opacas son las del seed.
    assert almacen["opaque_count"] == UBICACIONES_SEED
    assert almacen["total_rows_rejected"] == 0
    assert almacen["last_import_at"] is not None


async def test_disponibles_mas_bloqueadas_es_el_total(almacen: dict[str, Any]) -> None:
    """`status` particiona el total. Es la invariante que 0059 restauró.

    Antes existía `occupied_count`, que salía de otra columna y solapaba: los
    tres sumaban 45.174 sobre 29.312. Si alguien lo reintroduce, esta prueba y la
    verificación de 0059 lo dicen las dos.
    """
    assert almacen["available_count"] + almacen["blocked_count"] == almacen["location_count"]
    assert "occupied_count" not in almacen
    assert "occupancy_percentage" not in almacen


async def test_el_histograma_del_wms_suma_el_total(almacen: dict[str, Any]) -> None:
    """Vocabulario ABIERTO expuesto entero, sin privilegiar ningún valor."""
    hist = almacen["wms_situation_counts"]
    assert isinstance(hist, dict) and hist
    assert sum(hist.values()) == almacen["location_count"]
    # OCUP existe en el histograma pero NO como estado del espacio: la ocupación
    # es del inventario (SPA-11). Que esté aquí y no en `status` es el punto.
    assert "OCUP" in hist


async def test_las_contradicciones_del_origen_se_exponen(
    almacen: dict[str, Any],
) -> None:
    """El WMS tiene 2.365 filas donde «Estado» y «Situación» se contradicen.

    Se expone en lugar de esconderse. Si el número fuera 0 habría que sospechar
    del cálculo, no celebrar: se midió sobre el archivo.
    """
    assert almacen["status_situation_conflicts"] == 2365


async def test_las_dos_clases_de_capacidad_ausente_se_distinguen(
    almacen: dict[str, Any],
) -> None:
    """«El WMS dijo ilimitado» (26.244) y «no dijo nada» (727) son distintos.

    Antes de la migración 0058 ambos eran el mismo `NULL` y no había forma de
    saber cuál de las dos cosas pasaba. Operativamente no son lo mismo: una
    ubicación sin límite declarado se puede usar; una sin dato hay que ir a
    medirla.
    """
    assert almacen["capacity_unlimited_count"] == 26_244
    assert almacen["capacity_unknown_count"] == 727
    assert (
        almacen["capacity_unlimited_count"] + almacen["capacity_unknown_count"]
        < almacen["location_count"]
    )


# ══ 4 · Árbol ══════════════════════════════════════════════════════════════
async def test_el_arbol_por_niveles_no_devuelve_todo(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    """`depth=0` da solo las raíces: 348, no 3.048.

    Es la diferencia entre una navegación y una descarga. `child_count` en cada
    raíz dice si vale la pena expandirla, sin una petición extra por nodo.
    """
    wid = almacen["warehouse_id"]
    r0 = await api.get(f"/v1/spatial/warehouses/{wid}/tree?depth=0", headers=auth)
    assert r0.status_code == 200
    raices = r0.json()["data"]
    # 347 racks + el `storage_area` del seed, todos raíz porque no hay pasillos.
    assert len(raices) == RACKS_ESPERADOS + 1
    assert all(n["parent_node_id"] is None for n in raices)
    assert all(n["depth"] == 0 for n in raices)

    r1 = await api.get(f"/v1/spatial/warehouses/{wid}/tree?depth=1", headers=auth)
    con_hijos = r1.json()["data"]
    assert len(con_hijos) == RACKS_ESPERADOS + 1 + CUERPOS_ESPERADOS
    assert {n["depth"] for n in con_hijos} == {0, 1}
    # Los hijos son cuerpos, y ningún cuerpo tiene hijos: el árbol acaba ahí.
    cuerpos = [n for n in con_hijos if n["depth"] == 1]
    assert all(n["node_type"] == "bay" for n in cuerpos)
    assert all(n["child_count"] == 0 for n in cuerpos)


async def test_no_existen_nodos_de_nivel_ni_de_posicion(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    """El nivel y la posición son ATRIBUTOS de la ubicación, no nodos.

    Crearlos habría multiplicado el árbol por 29.310/2.701 sin añadir nada que
    no esté ya en `level` y `position`.
    """
    wid = almacen["warehouse_id"]
    r = await api.get(f"/v1/spatial/warehouses/{wid}/tree?depth=6", headers=auth)
    tipos = {n["node_type"] for n in r.json()["data"]}
    assert tipos <= {"rack", "bay", "storage_area", "site"}
    assert "aisle" not in tipos


async def test_los_hijos_se_paginan_por_cursor(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    wid = almacen["warehouse_id"]
    raices = (
        await api.get(f"/v1/spatial/warehouses/{wid}/tree?depth=0", headers=auth)
    ).json()["data"]
    # El nodo con más hijos: el que de verdad ejercita la paginación.
    padre = max(raices, key=lambda n: n["child_count"])
    assert padre["child_count"] > 3, "ningún nodo tiene hijos suficientes para paginar"

    r = await api.get(
        f"/v1/spatial/nodes/{padre['node_id']}/children",
        params={"limit": 3, "with_total": True},
        headers=auth,
    )
    assert r.status_code == 200
    cuerpo = r.json()
    assert len(cuerpo["data"]) == 3
    assert cuerpo["pagination"]["total"] == padre["child_count"]
    assert cuerpo["pagination"]["next_cursor"]

    r2 = await api.get(
        f"/v1/spatial/nodes/{padre['node_id']}/children",
        params={"limit": 3, "cursor": cuerpo["pagination"]["next_cursor"]},
        headers=auth,
    )
    assert r2.status_code == 200
    # Sin solape: la segunda página no repite ni se salta nada.
    primeros = {n["node_id"] for n in cuerpo["data"]}
    segundos = {n["node_id"] for n in r2.json()["data"]}
    assert not (primeros & segundos)


# ══ 5 · Plano de planta ════════════════════════════════════════════════════
async def test_el_plano_agrega_y_no_descarga_el_catalogo(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    wid = almacen["warehouse_id"]
    r = await api.get(
        f"/v1/spatial/warehouses/{wid}/floor-plan",
        params={"limit": 200, "with_total": True},
        headers=auth,
    )
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["pagination"]["total"] == RACKS_ESPERADOS + 1
    assert cuerpo["pagination"]["total_pages"] == 2
    assert len(cuerpo["data"]) == 200

    # La suma de las celdas del plano es el total de ubicaciones: si el plano
    # multiplicara filas —el error que 0059 introdujo y su propia verificación
    # atrapó— este número saldría 98.334 en lugar de 29.312.
    todas: list[dict[str, Any]] = list(cuerpo["data"])
    cursor = cuerpo["pagination"]["next_cursor"]
    while cursor:
        r2 = await api.get(
            f"/v1/spatial/warehouses/{wid}/floor-plan",
            params={"limit": 200, "cursor": cursor},
            headers=auth,
        )
        cuerpo2 = r2.json()
        todas.extend(cuerpo2["data"])
        cursor = cuerpo2["pagination"]["next_cursor"]

    assert len(todas) == RACKS_ESPERADOS + 1
    assert sum(c["location_count"] for c in todas) == UBICACIONES_TOTALES
    assert sum(c["bay_count"] for c in todas) == CUERPOS_ESPERADOS
    for c in todas:
        assert c["available_count"] + c["blocked_count"] == c["location_count"], c["rack_code"]


async def test_la_busqueda_del_plano_es_por_prefijo(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    wid = almacen["warehouse_id"]
    r = await api.get(
        f"/v1/spatial/warehouses/{wid}/floor-plan",
        params={"search": "MZ", "limit": 200},
        headers=auth,
    )
    assert r.status_code == 200
    datos = r.json()["data"]
    assert datos, "el prefijo MZ debería encontrar racks"
    assert all(c["rack_code"].startswith("MZ") for c in datos)


# ══ 6 · Alzado ═════════════════════════════════════════════════════════════
async def test_el_alzado_trae_la_rejilla_dimensionada(
    api: AsyncClient, auth: dict[str, str], rack: dict[str, Any]
) -> None:
    """El cliente no tiene que hacer `max()` sobre las celdas para dibujar."""
    r = await api.get(f"/v1/spatial/racks/{rack['rack_id']}/front-view", headers=auth)
    assert r.status_code == 200
    v = r.json()["data"]
    assert v["rack_code"] == rack["rack_code"]
    assert v["bay_count"] == rack["bay_count"]
    assert len(v["cells"]) == rack["location_count"]
    assert v["max_level"] == max(c["level"] for c in v["cells"])
    assert v["max_position"] == max(c["position"] for c in v["cells"])
    assert v["max_level"] == rack["max_level"]


async def test_ninguna_celda_obliga_a_parsear_el_codigo(
    api: AsyncClient, auth: dict[str, str], rack: dict[str, Any]
) -> None:
    """`bay_code`, `level` y `position` llegan descompuestos (ADR-013).

    La comprobación es que el código COMPUESTO coincide con las partes, no que
    las partes se puedan extraer del código: la dirección del contrato importa.
    """
    r = await api.get(f"/v1/spatial/racks/{rack['rack_id']}/front-view", headers=auth)
    for c in r.json()["data"]["cells"][:40]:
        esperado = (
            f"{rack['rack_code']}-{c['bay_code']}-N{c['level']:02d}-{c['position']}"
        )
        assert c["full_code"] == esperado, f"{c['full_code']} != {esperado}"


# ══ 7 · Ubicaciones ════════════════════════════════════════════════════════
async def test_el_cursor_no_repite_ni_se_salta_filas(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    """Cinco páginas seguidas por cursor, sin solape y en orden creciente."""
    vistos: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params: dict[str, Any] = {"limit": 25, "warehouse_id": almacen["warehouse_id"]}
        if cursor:
            params["cursor"] = cursor
        r = await api.get("/v1/spatial/locations", params=params, headers=auth)
        assert r.status_code == 200, r.text[:300]
        cuerpo = r.json()
        assert len(cuerpo["data"]) == 25
        vistos.extend(loc["full_code"] for loc in cuerpo["data"])
        cursor = cuerpo["pagination"]["next_cursor"]
        assert cursor

    assert len(vistos) == len(set(vistos)) == 125
    assert vistos == sorted(vistos)


async def test_cursor_y_page_juntos_se_rechazan(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """Son dos formas de decir dónde empezar; juntas no significan nada.

    Elegir una en silencio sería peor: el cliente creería estar en la página 5.
    """
    r = await api.get(
        "/v1/spatial/locations", params={"page": 2, "cursor": "abc"}, headers=auth
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "BUSINESS_RULE_VIOLATION"


async def test_page_profunda_se_rechaza_en_lugar_de_ejecutarse(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    """`page=999999` con `page_size=200` sería un OFFSET de 200 millones."""
    r = await api.get("/v1/spatial/locations", params={"page": 999_999}, headers=auth)
    assert r.status_code == 422


async def test_el_total_es_opcional_y_su_ausencia_es_null(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    """Sin `with_total`, `total` es `null` — «no se contó», no «no hay nada»."""
    wid = almacen["warehouse_id"]
    sin = await api.get(
        "/v1/spatial/locations", params={"warehouse_id": wid, "limit": 5}, headers=auth
    )
    assert sin.json()["pagination"]["total"] is None
    assert sin.json()["pagination"]["total_pages"] is None

    con = await api.get(
        "/v1/spatial/locations",
        params={"warehouse_id": wid, "limit": 5, "with_total": True},
        headers=auth,
    )
    p = con.json()["pagination"]
    assert p["total"] == UBICACIONES_TOTALES
    assert p["total_pages"] == -(-UBICACIONES_TOTALES // 5)


async def test_los_filtros_se_combinan_y_el_total_los_respeta(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    """El `count` se hace sobre la tabla y el listado sobre la vista.

    Son dos consultas distintas sobre dos relaciones distintas, así que hay que
    demostrar que dan el mismo número con los mismos filtros: si `count` usara
    `logical_level` y el listado `level` con semánticas distintas, el cliente
    vería «página 3 de 2».
    """
    wid = almacen["warehouse_id"]
    r = await api.get(
        "/v1/spatial/locations",
        params={
            "warehouse_id": wid,
            "status": "blocked",
            "level": 1,
            "limit": 200,
            "with_total": True,
        },
        headers=auth,
    )
    assert r.status_code == 200
    cuerpo = r.json()
    total = cuerpo["pagination"]["total"]
    assert total > 0
    assert all(loc["location_status"] == "blocked" for loc in cuerpo["data"])
    assert all(loc["level"] == 1 for loc in cuerpo["data"])

    # Recorrer todas las páginas debe dar exactamente `total`.
    contadas = len(cuerpo["data"])
    cursor = cuerpo["pagination"]["next_cursor"]
    while cursor:
        r2 = await api.get(
            "/v1/spatial/locations",
            params={
                "warehouse_id": wid,
                "status": "blocked",
                "level": 1,
                "limit": 200,
                "cursor": cursor,
            },
            headers=auth,
        )
        cuerpo2 = r2.json()
        contadas += len(cuerpo2["data"])
        cursor = cuerpo2["pagination"]["next_cursor"]
    assert contadas == total, f"el cursor devolvió {contadas} y el count dijo {total}"


async def test_filtrar_por_rack_incluye_los_cuerpos(
    api: AsyncClient, auth: dict[str, str], rack: dict[str, Any]
) -> None:
    """`node_id` apunta al cuerpo, no al rack: el filtro debe subir un nivel.

    Si el `count` filtrara por `node_id = rack_id` daría 0 y el listado, que va
    por la vista resuelta, daría cientos. La prueba es que coinciden.
    """
    r = await api.get(
        "/v1/spatial/locations",
        params={"rack_id": rack["rack_id"], "limit": 200, "with_total": True},
        headers=auth,
    )
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["pagination"]["total"] == rack["location_count"]
    assert all(loc["rack_id"] == rack["rack_id"] for loc in cuerpo["data"])


async def test_la_busqueda_encuentra_por_codigo_externo_exacto(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    """El valor externo se conserva EXACTO, con eñes y espacios.

    `DAÑADO-C001-N01-1` y `PHA LO-C001-N01-1` existen en el catálogo con esa
    grafía; el código normalizado es `DANADO-…` y `PHA_LO-…`. Buscar por el
    externo tiene que encontrarlos: si el importador hubiera guardado solo el
    normalizado, el operario que lee la etiqueta del estante no encontraría nada.
    """
    wid = almacen["warehouse_id"]
    for externo, normalizado in (
        ("DAÑADO", "DANADO"),
        ("PHA LO", "PHA_LO"),
    ):
        r = await api.get(
            "/v1/spatial/locations",
            params={"warehouse_id": wid, "search": externo, "limit": 10},
            headers=auth,
        )
        assert r.status_code == 200, r.text[:300]
        datos = r.json()["data"]
        assert datos, f"no se encontró nada con el prefijo {externo!r}"
        assert all(loc["external_code"].startswith(externo) for loc in datos)
        assert all(loc["full_code"].startswith(normalizado) for loc in datos)


async def test_una_ubicacion_trae_su_direccion_completa(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    wid = almacen["warehouse_id"]
    listado = (
        await api.get(
            "/v1/spatial/locations",
            params={"warehouse_id": wid, "code_form": "structured", "limit": 1},
            headers=auth,
        )
    ).json()["data"]
    assert listado
    lid = listado[0]["location_id"]

    r = await api.get(f"/v1/spatial/locations/{lid}", headers=auth)
    assert r.status_code == 200
    loc = r.json()["data"]

    # Toda la dirección, ya resuelta. Sin `split`, sin expresiones regulares.
    assert loc["warehouse_code"]
    assert loc["rack_code"] and loc["rack_id"]
    assert loc["bay_code"] and loc["bay_id"]
    assert loc["level"] is not None and loc["position"] is not None
    assert loc["code_form"] == "structured"
    assert loc["full_code"] == (
        f"{loc['rack_code']}-{loc['bay_code']}-N{loc['level']:02d}-{loc['position']}"
    )
    # Y ninguna coordenada métrica sin marco: sería un número sin unidad.
    assert loc["logical_x"] is None or isinstance(loc["logical_x"], int)


async def test_ninguna_ubicacion_supera_el_techo_de_capacidad(
    api: AsyncClient, auth: dict[str, str], almacen: dict[str, Any]
) -> None:
    """50 t en un hueco no es una capacidad, y la API no puede devolverla.

    Se recorre una muestra amplia en lugar de las 29.310 para no convertir una
    prueba de contrato en una descarga: el CHECK del motor cubre el resto, y esta
    prueba comprueba que la API no lo esquiva por otro camino.
    """
    wid = almacen["warehouse_id"]
    r = await api.get(
        "/v1/spatial/locations",
        params={"warehouse_id": wid, "limit": 200},
        headers=auth,
    )
    for loc in r.json()["data"]:
        if loc["max_weight_kg"] is not None:
            assert 0 < loc["max_weight_kg"] < 50_000, loc["full_code"]
            assert loc["capacity_declared_unlimited"] is False
        # La bandera solo puede estar puesta si NO hay capacidad.
        if loc["capacity_declared_unlimited"]:
            assert loc["max_weight_kg"] is None


async def test_una_ubicacion_inexistente_es_404(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    r = await api.get(
        "/v1/spatial/locations/99999999-8888-7777-6666-555555555555", headers=auth
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NOT_FOUND"


async def test_un_cursor_manipulado_es_422_no_500(
    api: AsyncClient, auth: dict[str, str]
) -> None:
    r = await api.get(
        "/v1/spatial/locations", params={"cursor": "no-es-base64-valido!!"}, headers=auth
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "BUSINESS_RULE_VIOLATION"
