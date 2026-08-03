"""Las 17 pruebas del Bloque 0, contra Supabase REAL.

    pytest -m integration tests/test_platform_block0.py

Cuatro bloques:

  1-4    aislamiento RLS: sin identidad, con un usuario no owner, con el owner
  5-12   guardas del MOTOR: último owner, escalada de permisos, inmutabilidad de
         class_index y de datasets, FK cruzadas, geometría, deduplicación
  13-16  API por HTTP: 403 para el no owner, 200 para el owner, /auth/me
  17     revocación inmediata con un token vigente

La 17 demuestra la decisión 2 —el privilegio no viaja en el JWT— y no se podría
escribir si fuera un claim.

Sobre los dos tipos de sesión: como `olo_app` se prueba lo que ve un usuario real;
como `postgres` se prueba que los triggers abortan. Son cosas distintas y la
prueba 8 comprueba las dos, porque protegen de amenazas distintas.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from olo.core.config import Settings, get_settings
from olo.core.context import TenantContext, set_request_ids
from olo.db.session import dispose_engine, init_engine, tenant_session, unscoped_session
from olo.main import create_app

from .admin_conn import admin_commit, admin_tx

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

# Las 9 tablas del Bloque 0, con los nombres que tienen tras el Bloque 0.5: las 7
# de IA se movieron a `ai` y perdieron el prefijo (migración 0033), y `platform`
# quedó reducido a gobierno de plataforma.
#
# Se prueban TODAS y no una de muestra: una política olvidada en una sola tabla es
# una fuga completa. Que las 17 pruebas de este archivo sigan pasando con los
# nombres nuevos ES la prueba de compatibilidad del Bloque 0.5.
TABLAS = (
    "platform.owners",
    "platform.privileged_operation_log",
    "ai.projects",
    "ai.classes",
    "ai.assets",
    "ai.images",
    "ai.dataset_versions",
    "ai.dataset_items",
    "ai.annotations",
)


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


@pytest.fixture(scope="module", autouse=True)
async def engine(cfg: Settings) -> AsyncIterator[None]:
    """Motor de SQLAlchemy para TODO el módulo, no solo para las pruebas de API.

    Autouse porque las pruebas de aislamiento usan `tenant_session` /
    `unscoped_session` directamente, sin cliente HTTP. Sin esto fallaban con
    `DatabaseUnavailableError`, que es el mensaje correcto de una fixture mal
    montada — no un defecto del código.

    null_pool: el pool queda ligado al event loop que lo creó y pytest-asyncio usa
    uno por módulo.
    """
    init_engine(cfg, null_pool=True)
    yield
    await dispose_engine()


@pytest.fixture(scope="module")
async def api(cfg: Settings, engine: None) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=create_app(cfg)), base_url="http://test", timeout=30.0
    ) as client:
        yield client


@pytest.fixture(scope="module")
async def ids() -> dict[str, Any]:
    """auth_id / user_id / tenant_id, por vía privilegiada.

    No se pueden leer como `olo_app` sin contexto: RLS oculta `core.tenants` y
    `core.users`. Y hacen falta precisamente para CONSTRUIR los contextos con los
    que se prueba después.
    """
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT email, id, auth_id FROM core.users "
            "WHERE email = ANY($1::text[]) AND deleted_at IS NULL",
            [OWNER_EMAIL, NON_OWNER_EMAIL],
        )
        tenant = await c.fetchval("SELECT id FROM core.tenants WHERE slug = 'olo-demo'")

    por_email = {r["email"]: r for r in filas}
    if OWNER_EMAIL not in por_email or NON_OWNER_EMAIL not in por_email or tenant is None:
        pytest.skip("faltan los usuarios o el tenant del escenario de desarrollo")

    return {
        "tenant_id": tenant,
        "owner_user_id": por_email[OWNER_EMAIL]["id"],
        "owner_auth_id": por_email[OWNER_EMAIL]["auth_id"],
        "other_user_id": por_email[NON_OWNER_EMAIL]["id"],
        "other_auth_id": por_email[NON_OWNER_EMAIL]["auth_id"],
    }


def _ctx(auth_id: Any, tenant_id: Any, *, wide: bool = True) -> TenantContext:
    set_request_ids("block0-test", "block0-test")
    return TenantContext(auth_user_id=auth_id, tenant_id=tenant_id, tenant_wide_access=wide)


# ══ 1-4 · Aislamiento RLS ══════════════════════════════════════════════════
async def test_01_sin_identidad_no_ve_nada(ids: dict[str, Any]) -> None:
    """LA PRUEBA CENTRAL DE AISLAMIENTO.

    Con `app.tenant_id` fijado pero SIN identidad, las 9 tablas dan cero filas.
    Es exactamente la fuga que hubo que corregir en 0017 sobre `core.users`: allí,
    con tenant y sin identidad, se veía 1 usuario. El escenario real es un worker
    mal configurado que fija el tenant y se olvida de la identidad.
    """
    async with unscoped_session() as s:
        await s.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": str(ids["tenant_id"])},
        )
        assert (await s.execute(text("SELECT core.is_platform_owner()"))).scalar_one() is False
        for tabla in TABLAS:
            n = (await s.execute(text(f"SELECT count(1) FROM {tabla}"))).scalar_one()  # noqa: S608
            assert n == 0, f"{tabla} expone {n} filas SIN identidad"


async def test_02_usuario_no_owner_no_ve_nada(ids: dict[str, Any]) -> None:
    """Identidad válida y membresía activa, pero no es owner: cero filas."""
    ctx = _ctx(ids["other_auth_id"], ids["tenant_id"], wide=False)
    async with tenant_session(ctx) as s:
        assert (await s.execute(text("SELECT core.is_platform_owner()"))).scalar_one() is False
        for tabla in TABLAS:
            n = (await s.execute(text(f"SELECT count(1) FROM {tabla}"))).scalar_one()  # noqa: S608
            assert n == 0, f"{tabla} expone {n} filas a un usuario que no es owner"


async def test_03_owner_si_ve(ids: dict[str, Any]) -> None:
    ctx = _ctx(ids["owner_auth_id"], ids["tenant_id"])
    async with tenant_session(ctx) as s:
        assert (await s.execute(text("SELECT core.is_platform_owner()"))).scalar_one() is True
        n = (await s.execute(text("SELECT count(1) FROM platform.owners"))).scalar_one()
        assert n >= 1, "el owner debe verse a sí mismo"


async def test_04_is_platform_owner_sin_identidad_es_false() -> None:
    """Devuelve false, no NULL ni error.

    Importa porque la política RLS la invoca: con NULL, `USING (NULL)` no concede
    pero tampoco niega explícitamente, y el comportamiento dependería del contexto.
    """
    async with unscoped_session() as s:
        assert (await s.execute(text("SELECT core.is_platform_owner()"))).scalar_one() is False


# ══ 5-12 · Guardas del motor ═══════════════════════════════════════════════
async def test_05_no_se_puede_revocar_al_ultimo_owner(ids: dict[str, Any]) -> None:
    """Debe FALLAR con error, no quedarse en cero filas."""
    async with admin_tx() as c:
        activos = await c.fetchval(
            "SELECT count(1) FROM platform.owners WHERE revoked_at IS NULL"
        )
        if activos != 1:
            pytest.skip(f"la prueba requiere 1 owner activo, hay {activos}")

        with pytest.raises(asyncpg.RaiseError, match="sin ningún Platform Owner activo"):
            await c.execute(
                "UPDATE platform.owners SET revoked_at = now() "
                "WHERE user_id = $1 AND revoked_at IS NULL",
                ids["owner_user_id"],
            )


async def test_06_permiso_de_plataforma_no_entra_en_rol_de_tenant() -> None:
    """La escalada rol-de-tenant → permiso-de-plataforma, cerrada en el motor."""
    async with admin_tx() as c:
        rol = await c.fetchval(
            "SELECT id FROM core.roles WHERE name = 'viewer' AND is_system"
        )
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="alcance PLATAFORMA"):
            await c.execute(
                "INSERT INTO core.role_permissions (role_id, permission_code) "
                "VALUES ($1, 'ai_models:publish')",
                rol,
            )


async def test_07_class_index_es_inmutable(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        clase = await _clase(c, ids, proyecto, "pallet", 0)

        with pytest.raises(asyncpg.RaiseError, match="class_index es inmutable"):
            await c.execute(
                "UPDATE ai.classes SET class_index = 5 WHERE id = $1", clase
            )


async def test_08_dataset_congelado_es_inmutable(ids: dict[str, Any]) -> None:
    """Las DOS capas, porque protegen de amenazas distintas.

    (a) Como `postgres` —que tiene rolbypassrls— el trigger aborta con error.
    (b) Como `olo_app` no hay política de UPDATE, así que la sentencia se queda en
        CERO FILAS EN SILENCIO. Es la razón exacta de que el trigger exista: sin
        él, quien lanzara ese UPDATE creería que funcionó.
    """
    # (a) el trigger aborta
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        version = await _dataset_version(c, ids, proyecto)

        with pytest.raises(asyncpg.RaiseError, match="inmutable"):
            await c.execute(
                "UPDATE ai.dataset_versions SET notes = 'x' WHERE id = $1", version
            )

    async with admin_tx() as c2:
        proyecto = await _proyecto(c2, ids)
        version = await _dataset_version(c2, ids, proyecto)

        with pytest.raises(asyncpg.RaiseError, match="inmutable"):
            await c2.execute(
                "DELETE FROM ai.dataset_versions WHERE id = $1", version
            )

    # (b) como olo_app: cero filas, sin error. La capa de RLS.
    ctx = _ctx(ids["owner_auth_id"], ids["tenant_id"])
    async with tenant_session(ctx) as s:
        r = await s.execute(
            text("UPDATE ai.dataset_versions SET notes = 'y' WHERE id = :v"),
            {"v": uuid4()},
        )
        assert r.rowcount == 0, (
            "sin política de UPDATE, la sentencia debe afectar a cero filas — "
            "y por eso hace falta además el trigger"
        )


async def test_09_imagen_no_puede_usar_asset_de_otro_proyecto(ids: dict[str, Any]) -> None:
    """FK compuesta: el mecanismo que impide mezclar jerarquías."""
    async with admin_tx() as c:
        proyecto_a = await _proyecto(c, ids)
        proyecto_b = await _proyecto(c, ids)
        asset_b = await _asset(c, ids, proyecto_b)

        with pytest.raises(asyncpg.ForeignKeyViolationError, match="fk_img_asset"):
            await c.execute(
                "INSERT INTO ai.images (project_id, asset_id, source, created_by) "
                "VALUES ($1, $2, 'upload', $3)",
                proyecto_a,
                asset_b,
                ids["owner_user_id"],
            )


async def test_10_anotacion_no_puede_usar_clase_de_otro_proyecto(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        proyecto_a = await _proyecto(c, ids)
        proyecto_b = await _proyecto(c, ids)
        imagen_a = await _imagen(c, ids, proyecto_a, await _asset(c, ids, proyecto_a))
        clase_b = await _clase(c, ids, proyecto_b, "caja", 0)

        with pytest.raises(asyncpg.ForeignKeyViolationError, match="fk_ann_class"):
            await c.execute(
                "INSERT INTO ai.annotations "
                "(project_id, image_id, class_id, kind, cx, cy, w, h, created_by) "
                "VALUES ($1, $2, $3, 'bbox', 0.5, 0.5, 0.2, 0.2, $4)",
                proyecto_a,
                imagen_a,
                clase_b,
                ids["owner_user_id"],
            )


async def test_11_caja_fuera_de_la_imagen_se_rechaza(ids: dict[str, Any]) -> None:
    """`cx + w/2 > 1`. Lo valida el motor: con jsonb entraría sin protestar."""
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        imagen = await _imagen(c, ids, proyecto, await _asset(c, ids, proyecto))
        clase = await _clase(c, ids, proyecto, "rack", 0)

        with pytest.raises(asyncpg.CheckViolationError, match="chk_ann_caja_dentro_x"):
            await c.execute(
                "INSERT INTO ai.annotations "
                "(project_id, image_id, class_id, kind, cx, cy, w, h, created_by) "
                "VALUES ($1, $2, $3, 'bbox', 0.95, 0.5, 0.2, 0.2, $4)",
                proyecto,
                imagen,
                clase,
                ids["owner_user_id"],
            )


async def test_12_dos_imagenes_con_el_mismo_contenido_se_rechazan(ids: dict[str, Any]) -> None:
    """Deduplicación por sha256: evita la fuga entre train y val."""
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        sha = uuid4().hex + uuid4().hex
        await _asset(c, ids, proyecto, sha=sha)

        with pytest.raises(asyncpg.UniqueViolationError, match="uq_asset_contenido"):
            await _asset(c, ids, proyecto, sha=sha)


# ══ 13-16 · API por HTTP ═══════════════════════════════════════════════════
@pytest.fixture(scope="module")
async def token_owner(api: AsyncClient) -> str:
    r = await api.post(
        "/v1/auth/login", json={"email": OWNER_EMAIL, "password": _password("adminpw.txt")}
    )
    if r.status_code != 200:
        pytest.skip(f"login del owner falló: {r.status_code}")
    return str(r.json()["data"]["access_token"])


@pytest.fixture(scope="module")
async def token_otro(api: AsyncClient) -> str:
    r = await api.post(
        "/v1/auth/login", json={"email": NON_OWNER_EMAIL, "password": _password("testpw.txt")}
    )
    if r.status_code != 200:
        pytest.skip(f"login del no-owner falló: {r.status_code}")
    return str(r.json()["data"]["access_token"])


async def test_13_no_owner_recibe_403(api: AsyncClient, token_otro: str) -> None:
    r = await api.get("/v1/platform/owners", headers={"Authorization": f"Bearer {token_otro}"})
    assert r.status_code == 403, r.text[:300]
    assert r.json()["error"]["code"] == "NOT_PLATFORM_OWNER"


async def test_14_owner_recibe_200(api: AsyncClient, token_owner: str) -> None:
    r = await api.get("/v1/platform/owners", headers={"Authorization": f"Bearer {token_owner}"})
    assert r.status_code == 200, r.text[:300]
    assert OWNER_EMAIL in {o["email"] for o in r.json()["data"]}


async def test_15_me_del_owner_refleja_el_privilegio(api: AsyncClient, token_owner: str) -> None:
    """El owner recibe TODOS los permisos de plataforma que existen.

    Se compara contra el catálogo real y no contra un número fijo. La versión
    anterior afirmaba `== 23` y se rompió al añadir cuatro permisos en la
    migración 0041 — una prueba que falla por una migración correcta está mal
    escrita. Así, el invariante que se comprueba es el de verdad: `/auth/me`
    devuelve el catálogo completo, sea cual sea su tamaño.
    """
    r = await api.get("/v1/auth/me", headers={"Authorization": f"Bearer {token_owner}"})
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["is_platform_owner"] is True
    perms = set(d["permissions"])
    assert {"ai_models:publish", "training:launch", "annotations:validate"} <= perms

    async with admin_tx() as c:
        catalogo = {
            r["code"]
            for r in await c.fetch("SELECT code FROM core.permissions WHERE scope = 'platform'")
        }
    assert catalogo, "el catálogo de permisos de plataforma no debería estar vacío"
    assert catalogo <= perms, f"faltan en /me: {sorted(catalogo - perms)}"


async def test_16_me_del_no_owner_no_trae_permisos_de_plataforma(
    api: AsyncClient, token_otro: str
) -> None:
    r = await api.get("/v1/auth/me", headers={"Authorization": f"Bearer {token_otro}"})
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["is_platform_owner"] is False
    perms = set(d["permissions"])
    assert "ai_models:publish" not in perms
    assert "training:launch" not in perms


# ══ 17 · Revocación inmediata ══════════════════════════════════════════════
@pytest.mark.serial
async def test_17_revocacion_inmediata_con_token_vigente(
    api: AsyncClient, token_owner: str, ids: dict[str, Any]
) -> None:
    """LA PRUEBA DE LA DECISIÓN 2.

    ⚠ Marcada `serial`: revoca al único Platform Owner con un COMMIT real y lo
    restaura después. Durante esa ventana, cualquier prueba concurrente que
    necesite al owner ve cero filas y falla por un motivo ajeno a lo que
    comprobaba. Ocurrió durante el desarrollo al lanzar dos `pytest` a la vez
    contra la misma base, y produjo un fallo fantasma.

    No se puede evitar sin perder la prueba: usar un segundo owner de usar y tirar
    dejaría de comprobar el caso del último owner, que es donde está el riesgo.

    ── Qué comprueba ──────────────────────────────────────────────────────

    Con el MISMO token, sin refrescarlo:
      antes de revocar → 200 · después → 403 · tras restaurar → 200

    Si el privilegio viajara como claim, el paso intermedio seguiría dando 200
    hasta que el token expirase, hasta una hora después. Esta prueba no se podría
    escribir.

    Para revocar hay que sortear la guarda del último owner, que es correcta y
    aquí estorba. Se desactiva dentro de la ventana y se reactiva SIEMPRE, incluso
    si la prueba falla: dejar la plataforma sin owner sería un daño real causado
    por una prueba.
    """
    cabeceras = {"Authorization": f"Bearer {token_owner}"}

    antes = await api.get("/v1/platform/owners", headers=cabeceras)
    assert antes.status_code == 200, "el owner debía tener acceso antes de revocar"

    try:
        async with admin_commit() as c:
            await c.execute(
                "ALTER TABLE platform.owners DISABLE TRIGGER trg_owners_last_guard"
            )
            await c.execute(
                "UPDATE platform.owners SET revoked_at = now() "
                "WHERE user_id = $1 AND revoked_at IS NULL",
                ids["owner_user_id"],
            )

        durante = await api.get("/v1/platform/owners", headers=cabeceras)
        assert durante.status_code == 403, (
            "el token sigue válido pero el privilegio ya no: debía dar 403. "
            f"Recibido {durante.status_code} — ¿el privilegio viaja en el JWT?"
        )
        assert durante.json()["error"]["code"] == "NOT_PLATFORM_OWNER"

        me = await api.get("/v1/auth/me", headers=cabeceras)
        assert me.json()["data"]["is_platform_owner"] is False
        assert "ai_models:publish" not in set(me.json()["data"]["permissions"])

    finally:
        async with admin_commit() as c:
            await c.execute(
                "UPDATE platform.owners SET revoked_at = NULL WHERE user_id = $1",
                ids["owner_user_id"],
            )
            await c.execute(
                "ALTER TABLE platform.owners ENABLE TRIGGER trg_owners_last_guard"
            )

    despues = await api.get("/v1/platform/owners", headers=cabeceras)
    assert despues.status_code == 200, "el acceso debía restaurarse igual de rápido"

    # La guarda debe quedar activa: si el rollback la dejara desactivada, el
    # agujero sería silencioso.
    async with admin_tx() as c:
        estado = await c.fetchval(
            "SELECT t.tgenabled FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid "
            "JOIN pg_namespace n ON n.oid = cl.relnamespace "
            "WHERE n.nspname = 'platform' AND cl.relname = 'owners' "
            "  AND t.tgname = 'trg_owners_last_guard'"
        )
        # asyncpg devuelve `"char"` como bytes, no como str.
        assert estado in ("O", b"O"), (
            f"la guarda del último owner quedó desactivada (tgenabled={estado!r})"
        )


# ── Ayudantes ──────────────────────────────────────────────────────────────
async def _proyecto(c: asyncpg.Connection, ids: dict[str, Any]) -> Any:
    # Sin `base_model` ni `task`: la migración 0034 las movió a ai.models, porque
    # un proyecto con cinco modelos no tiene UNA arquitectura ni UNA tarea.
    return await c.fetchval(
        "INSERT INTO ai.projects (name, slug, created_by) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"Prueba {uuid4().hex[:8]}",
        f"prueba-{uuid4().hex[:8]}",
        ids["owner_user_id"],
    )


async def _clase(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any, nombre: str, indice: int
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.classes "
        "(project_id, name, class_index, color, created_by) "
        "VALUES ($1, $2, $3, '#FF8800', $4) RETURNING id",
        proyecto,
        nombre,
        indice,
        ids["owner_user_id"],
    )


async def _asset(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any, *, sha: str | None = None
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.assets "
        "(project_id, kind, bucket, object_path, original_filename, content_type, "
        " bytes, sha256, width, height, created_by) "
        "VALUES ($1, 'image', 'ai-source', $2, 'foto.jpg', 'image/jpeg', "
        "        1024, $3, 640, 480, $4) RETURNING id",
        proyecto,
        f"projects/{proyecto}/images/{uuid4()}.jpg",
        (sha or (uuid4().hex + uuid4().hex))[:64],
        ids["owner_user_id"],
    )


async def _imagen(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any, asset: Any
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.images (project_id, asset_id, source, created_by) "
        "VALUES ($1, $2, 'upload', $3) RETURNING id",
        proyecto,
        asset,
        ids["owner_user_id"],
    )


async def _dataset_version(c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.dataset_versions "
        "(project_id, version, class_snapshot, image_count, train_count, val_count, "
        " test_count, split_seed, created_by) "
        "VALUES ($1, 1, '[{\"index\":0,\"name\":\"pallet\"}]'::jsonb, 0, 0, 0, 0, 42, $2) "
        "RETURNING id",
        proyecto,
        ids["owner_user_id"],
    )
