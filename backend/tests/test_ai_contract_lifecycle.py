"""Pruebas de las migraciones 0042 y 0043.

    pytest -m integration tests/test_ai_contract_lifecycle.py

Tres bloques:

  01-10  contrato del modelo: los agujeros medidos, cerrados
  11-14  la vista resuelta y su `security_invoker`
  15-26  ciclo de vida de las versiones y matriz de transiciones

Todas las comprobaciones de error verifican el **código interno** (`DETAIL`) y no
el mensaje humano. El mensaje puede reescribirse sin aviso; una prueba que dependa
de él es frágil, y ese fue un defecto real de la primera versión de estas pruebas.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy import text

from olo.core.config import Settings, get_settings
from olo.core.context import TenantContext, set_request_ids
from olo.db.session import dispose_engine, init_engine, tenant_session

from .admin_conn import admin_tx

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

pytestmark = pytest.mark.integration

OWNER_EMAIL = "arojas@ologistics.com"
NON_OWNER_EMAIL = "mgr@olo-dev.test"


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
    init_engine(cfg, null_pool=True)
    yield
    await dispose_engine()


@pytest.fixture(scope="module")
async def ids() -> dict[str, Any]:
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT email, id, auth_id FROM core.users "
            "WHERE email = ANY($1::text[]) AND deleted_at IS NULL",
            [OWNER_EMAIL, NON_OWNER_EMAIL],
        )
        tenant = await c.fetchval("SELECT id FROM core.tenants WHERE slug = 'olo-demo'")
    por = {r["email"]: r for r in filas}
    if OWNER_EMAIL not in por or NON_OWNER_EMAIL not in por or tenant is None:
        pytest.skip("faltan los usuarios del escenario de desarrollo")
    return {
        "tenant_id": tenant,
        "owner_user_id": por[OWNER_EMAIL]["id"],
        "owner_auth_id": por[OWNER_EMAIL]["auth_id"],
        "other_auth_id": por[NON_OWNER_EMAIL]["auth_id"],
    }


# ══ 01-10 · Contrato del modelo ════════════════════════════════════════════
async def test_01_framework_code_no_persiste_en_models() -> None:
    """No es que esté protegido: es que no existe.

    El invariante pasó de «vigilado por un trigger» a **inexpresable**, que es
    estrictamente mejor. No puede divergir algo que solo vive en un sitio.
    """
    async with admin_tx() as c:
        cols = {
            r["column_name"]
            for r in await c.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='ai' AND table_name='models'"
            )
        }
    assert "framework_code" not in cols
    assert "current_version_id" not in cols, "0043 debía eliminar también el puntero"


async def test_02_input_type_mutable_sin_versiones(ids: dict[str, Any]) -> None:
    """Antes de tener pesos, el contrato todavía se está definiendo."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        await c.execute("UPDATE ai.models SET input_type='frames' WHERE id=$1", m)
        assert await c.fetchval("SELECT input_type FROM ai.models WHERE id=$1", m) == "frames"


@pytest.mark.parametrize("campo", ["architecture_code", "task", "input_type"])
async def test_03_contrato_congelado_con_versiones(ids: dict[str, Any], campo: str) -> None:
    valores = {
        "architecture_code": "'florence-2-base'",
        "task": "'detect'",
        "input_type": "'video'",
    }
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "sam2-b", "segment", "image")
        await _version(c, ids, p, m, 1)
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute(
                f"UPDATE ai.models SET {campo} = {valores[campo]} WHERE id=$1",  # noqa: S608
                m,
            )
    assert exc.value.detail == "AI_MODEL_CONTRACT_IMMUTABLE"


async def test_04_requires_training_no_se_edita(ids: dict[str, Any]) -> None:
    """Ni con versiones ni sin ellas: se deriva de la arquitectura y se congela."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute("UPDATE ai.models SET requires_training=false WHERE id=$1", m)
    assert exc.value.detail == "AI_MODEL_CONTRACT_IMMUTABLE"


async def test_05_framework_de_la_arquitectura_es_inmutable_siempre() -> None:
    """Incluso sin modelos: es identidad, no una propiedad editable.

    Que `yolo11n` sea de Ultralytics no cambia. Editarlo no es una edición
    legítima, es corrupción — y determina el adaptador del worker.
    """
    async with admin_tx() as c:
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute(
                "UPDATE ai.architectures SET framework_code='pytorch' WHERE code='yolo11n'"
            )
    assert exc.value.detail == "AI_ARCHITECTURE_FRAMEWORK_IMMUTABLE"


async def test_06_requires_training_de_la_arquitectura_con_modelos(ids: dict[str, Any]) -> None:
    """La divergencia E del sondeo: modelo=true, arquitectura=false."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        await _modelo(c, ids, p, "yolo11n", "detect", "image")
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute(
                "UPDATE ai.architectures SET requires_training=false WHERE code='yolo11n'"
            )
    assert exc.value.detail == "AI_ARCHITECTURE_IN_USE"


async def test_07_no_se_retira_una_tarea_en_uso(ids: dict[str, Any]) -> None:
    """El agujero F: el modelo quedaría referenciando una capacidad inexistente."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        await _modelo(c, ids, p, "yolo11n", "detect", "image")
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute(
                "UPDATE ai.architectures SET supported_tasks=ARRAY['segment']::ai.task[] "
                "WHERE code='yolo11n'"
            )
    assert exc.value.detail == "AI_ARCHITECTURE_TASK_IN_USE"


async def test_08_no_se_retira_una_entrada_en_uso(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        await _modelo(c, ids, p, "yolo11n", "detect", "image")
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute(
                "UPDATE ai.architectures "
                "SET supported_input_types=ARRAY['video']::ai.input_type[] "
                "WHERE code='yolo11n'"
            )
    assert exc.value.detail == "AI_ARCHITECTURE_INPUT_IN_USE"


async def test_09_ampliar_capacidades_sigue_permitido(ids: dict[str, Any]) -> None:
    """La asimetría es deliberada: el catálogo debe poder crecer sin ceremonia.

    Si añadir estuviera restringido igual que retirar, incorporar una tarea nueva
    a YOLO exigiría una migración por cada capacidad.
    """
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        await _modelo(c, ids, p, "yolo11n", "detect", "image")
        await c.execute(
            "UPDATE ai.architectures SET supported_tasks = "
            " ARRAY['detect','segment','classify','pose','count','track']::ai.task[] "
            "WHERE code='yolo11n'"
        )
        tareas = await c.fetchval(
            "SELECT supported_tasks FROM ai.architectures WHERE code='yolo11n'"
        )
    assert "track" in tareas


async def test_10_campos_descriptivos_del_catalogo_son_libres(ids: dict[str, Any]) -> None:
    """`hyperparam_schema` evoluciona SIN invalidar versiones registradas.

    No es descuido: cada `ai.training_runs` congelará su `config_snapshot`, así que
    una versión ya registrada lleva los parámetros con los que se entrenó de
    verdad. El esquema describe lo que las ejecuciones NUEVAS pueden pedir.
    Sin esa instantánea este campo tendría que ser inmutable y el catálogo no
    podría corregirse nunca.
    """
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        await _version(c, ids, p, m, 1)   # con versión registrada
        await c.execute(
            "UPDATE ai.architectures SET "
            " display_name = display_name || ' (rev)', "
            " notes = 'actualizado', "
            " min_images_recommended = 250, "
            " approx_weights_mb = 7, "
            " hyperparam_schema = hyperparam_schema "
            "   || '{\"cos_lr\":{\"type\":\"boolean\"}}'::jsonb "
            "WHERE code='yolo11n'"
        )
        esquema = await c.fetchval(
            "SELECT hyperparam_schema ? 'cos_lr' FROM ai.architectures WHERE code='yolo11n'"
        )
    assert esquema is True


# ══ 11-14 · La vista resuelta ══════════════════════════════════════════════
async def test_11_la_vista_resuelve_framework_y_adaptador(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "sam2-b", "segment", "image")
        f = await c.fetchrow(
            "SELECT framework_code, framework_name, framework_adapter, "
            "       architecture_name, weights_extension "
            "FROM ai.models_resolved WHERE id=$1",
            m,
        )
    assert f["framework_code"] == "pytorch"
    assert f["framework_adapter"] == "torch"
    assert f["architecture_name"] == "SAM 2 base"
    assert f["weights_extension"] == ".pt"


async def test_12_la_vista_declara_security_invoker() -> None:
    """Sin `security_invoker`, la vista sería un agujero de RLS.

    Una vista normal se evalúa con los privilegios de su PROPIETARIO —aquí
    `postgres`, que tiene `rolbypassrls`—, así que la política de `ai.models` no se
    aplicaría al llamante y la vista expondría los modelos a cualquier usuario
    autenticado, saltándose `is_platform_owner()`.
    """
    async with admin_tx() as c:
        opciones = await c.fetchval(
            "SELECT c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='ai' AND c.relname='models_resolved'"
        )
    assert opciones is not None, "la vista no tiene reloptions: falta security_invoker"
    assert "security_invoker=true" in opciones


async def test_13_la_vista_respeta_rls_para_un_no_owner(ids: dict[str, Any]) -> None:
    """La prueba que de verdad importa: comportamiento, no metadatos.

    Un usuario con identidad válida y membresía activa, pero que no es Platform
    Owner, debe ver **cero filas** a través de la vista. Comprobar la reloption
    dice que la declaración está; esto dice que funciona.
    """
    set_request_ids("contract-test", "contract-test")
    ctx = TenantContext(
        auth_user_id=ids["other_auth_id"], tenant_id=ids["tenant_id"], tenant_wide_access=False
    )
    async with tenant_session(ctx) as s:
        n = (await s.execute(text("SELECT count(1) FROM ai.models_resolved"))).scalar_one()
    assert n == 0, f"la vista expone {n} filas a un usuario que no es owner"


async def test_14_la_vista_si_sirve_al_owner(ids: dict[str, Any]) -> None:
    set_request_ids("contract-test", "contract-test")
    ctx = TenantContext(
        auth_user_id=ids["owner_auth_id"], tenant_id=ids["tenant_id"], tenant_wide_access=True
    )
    async with tenant_session(ctx) as s:
        # No hay modelos sembrados, así que lo que se comprueba es que la consulta
        # se resuelve sin error de permisos: 0 filas, no 42501.
        n = (await s.execute(text("SELECT count(1) FROM ai.models_resolved"))).scalar_one()
    assert n >= 0


# ══ 15-26 · Ciclo de vida ══════════════════════════════════════════════════
async def test_15_una_version_nace_registered(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v = await _version(c, ids, p, m, 1)
        assert await c.fetchval(
            "SELECT status FROM ai.model_versions WHERE id=$1", v
        ) == "registered"


@pytest.mark.parametrize("antiguo", ["candidate", "active", "rejected"])
async def test_16_el_vocabulario_antiguo_ya_no_existe(
    ids: dict[str, Any], antiguo: str
) -> None:
    """Los tres estados de 0038 quedan rechazados.

    Los ataja `chk_mv_marcas` antes que `chk_mv_status`, porque su rama `ELSE
    false` cubre también cualquier valor desconocido. Son dos capas y las dos son
    correctas, así que la aserción acepta cualquiera de las dos en lugar de fijar
    un orden de evaluación que PostgreSQL no garantiza.
    """
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        with pytest.raises(asyncpg.CheckViolationError) as exc:
            await c.execute(
                "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
                " weights_asset_id, source_reference, status, created_by) "
                "VALUES ($1,$2,1,'imported',$3,'vocabulario antiguo',$4,$5)",
                p, m, await _asset(c, ids, p), antiguo, ids["owner_user_id"],
            )
    assert exc.value.constraint_name in ("chk_mv_status", "chk_mv_marcas")


@pytest.mark.parametrize(
    ("desde", "hacia"),
    [
        ("registered", "published"),   # sin validar
        ("registered", "validated"),   # sin evaluar
        ("published", "archived"),     # sin degradar
        ("archived", "validating"),    # archived es terminal
        ("deprecated", "validating"),  # reevaluar no es un cambio de estado
    ],
)
async def test_17_transiciones_invalidas(ids: dict[str, Any], desde: str, hacia: str) -> None:
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v = await _version(c, ids, p, m, 1)
        await _llevar_a(c, ids, v, desde, m, p)
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute(
                "UPDATE ai.model_versions SET status=$2 WHERE id=$1", v, hacia
            )
    assert exc.value.detail == "AI_VERSION_TRANSITION_INVALID"


async def test_18_el_camino_completo(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v = await _version(c, ids, p, m, 1)
        await _llevar_a(c, ids, v, "published", m, p)
        fila = await c.fetchrow(
            "SELECT status, validated_at, published_at, published_by "
            "FROM ai.model_versions WHERE id=$1",
            v,
        )
    assert fila["status"] == "published"
    assert fila["validated_at"] is not None
    assert fila["published_at"] is not None
    assert fila["published_by"] is not None


async def test_19_publicar_exige_degradar(ids: dict[str, Any]) -> None:
    """El índice parcial hace que degradar sea EXPLÍCITO, no opcional."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v1 = await _version(c, ids, p, m, 1)
        v2 = await _version(c, ids, p, m, 2)
        await _llevar_a(c, ids, v1, "published", m, p)
        await _llevar_a(c, ids, v2, "validated", m, p)
        with pytest.raises(asyncpg.UniqueViolationError, match="uq_mv_publicada"):
            await c.execute(
                "UPDATE ai.model_versions SET status='published', published_at=now(), "
                " published_by=$2 WHERE id=$1",
                v2, ids["owner_user_id"],
            )


async def test_20_publicar_degradando_en_la_misma_transaccion(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v1 = await _version(c, ids, p, m, 1)
        v2 = await _version(c, ids, p, m, 2)
        await _llevar_a(c, ids, v1, "published", m, p)
        await _llevar_a(c, ids, v2, "validated", m, p)

        await c.execute(
            "UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id=$1",
            v1,
        )
        await c.execute(
            "UPDATE ai.model_versions SET status='published', published_at=now(), "
            " published_by=$2 WHERE id=$1",
            v2, ids["owner_user_id"],
        )
        publicada = await c.fetchval(
            "SELECT id FROM ai.model_versions WHERE model_id=$1 AND status='published'", m
        )
    assert publicada == v2


async def test_21_el_rollback_es_la_misma_operacion(ids: dict[str, Any]) -> None:
    """Volver a publicar una degradada. Mismo camino de código que publicar.

    Y limpia `deprecated_at`: las marcas son del hito más reciente, no un
    historial. Dos columnas no pueden representar dos periodos en producción; el
    historial completo está en platform.privileged_operation_log.
    """
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v1 = await _version(c, ids, p, m, 1)
        v2 = await _version(c, ids, p, m, 2)
        await _llevar_a(c, ids, v1, "published", m, p)
        await _llevar_a(c, ids, v2, "validated", m, p)

        # publicar v2
        await c.execute(
            "UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id=$1", v1
        )
        await c.execute(
            "UPDATE ai.model_versions SET status='published', published_at=now(), "
            " published_by=$2 WHERE id=$1", v2, ids["owner_user_id"],
        )
        # rollback a v1
        await c.execute(
            "UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id=$1", v2
        )
        await c.execute(
            "UPDATE ai.model_versions SET status='published', published_at=now(), "
            " published_by=$2, deprecated_at=NULL WHERE id=$1", v1, ids["owner_user_id"],
        )
        publicada = await c.fetchval(
            "SELECT id FROM ai.model_versions WHERE model_id=$1 AND status='published'", m
        )
    assert publicada == v1


async def test_22_republicar_sin_limpiar_deprecated_at_falla(ids: dict[str, Any]) -> None:
    """La garantía de que la publicación no deja marcas contradictorias."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v = await _version(c, ids, p, m, 1)
        await _llevar_a(c, ids, v, "published", m, p)
        await c.execute(
            "UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id=$1", v
        )
        with pytest.raises(asyncpg.CheckViolationError, match="chk_mv_marcas"):
            await c.execute(
                "UPDATE ai.model_versions SET status='published', published_at=now(), "
                " published_by=$2 WHERE id=$1", v, ids["owner_user_id"],
            )


async def test_23_failed_exige_motivo_y_admite_reintento(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v = await _version(c, ids, p, m, 1)
        await c.execute("UPDATE ai.model_versions SET status='validating' WHERE id=$1", v)

        with pytest.raises(asyncpg.CheckViolationError, match="chk_mv_marcas"):
            await c.execute("UPDATE ai.model_versions SET status='failed' WHERE id=$1", v)

    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v = await _version(c, ids, p, m, 1)
        await c.execute("UPDATE ai.model_versions SET status='validating' WHERE id=$1", v)
        await c.execute(
            "UPDATE ai.model_versions SET status='failed', "
            " failure_reason='mAP50 0.31, por debajo del minimo' WHERE id=$1",
            v,
        )
        # Reintento explícito
        await c.execute("UPDATE ai.model_versions SET status='validating' WHERE id=$1", v)
        assert await c.fetchval(
            "SELECT status FROM ai.model_versions WHERE id=$1", v
        ) == "validating"


@pytest.mark.parametrize("origen", ["trained", "pretrained", "imported"])
async def test_24_los_tres_origenes_comparten_el_ciclo(
    ids: dict[str, Any], origen: str
) -> None:
    """Invariante 6. `status` no menciona `origin` en ninguna condición."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        a = await _asset(c, ids, p)
        ref = None if origen == "trained" else "procedencia de la prueba"
        v = await c.fetchval(
            "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
            " weights_asset_id, source_reference, created_by) "
            "VALUES ($1,$2,1,$3,$4,$5,$6) RETURNING id",
            p, m, origen, a, ref, ids["owner_user_id"],
        )
        await _llevar_a(c, ids, v, "published", m, p)
        assert await c.fetchval(
            "SELECT status FROM ai.model_versions WHERE id=$1", v
        ) == "published"


async def test_25_la_version_publicada_se_resuelve_sin_puntero(ids: dict[str, Any]) -> None:
    """Lo que sustituye a `current_version_id`: una sonda al índice único."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        m = await _modelo(c, ids, p, "yolo11n", "detect", "image")
        v = await _version(c, ids, p, m, 1)

        assert await c.fetchval(
            "SELECT id FROM ai.model_versions WHERE model_id=$1 AND status='published'", m
        ) is None, "sin publicar, la consulta debe devolver NULL"

        await _llevar_a(c, ids, v, "published", m, p)
        assert await c.fetchval(
            "SELECT id FROM ai.model_versions WHERE model_id=$1 AND status='published'", m
        ) == v


async def test_26_dos_modelos_pueden_tener_su_propia_publicada(ids: dict[str, Any]) -> None:
    """El índice es por modelo, no por proyecto: cinco modelos, cinco publicadas."""
    async with admin_tx() as c:
        p = await _proyecto(c, ids)
        for arq, tarea in (("yolo11n", "detect"), ("sam2-b", "segment")):
            m = await _modelo(c, ids, p, arq, tarea, "image")
            v = await _version(c, ids, p, m, 1)
            await _llevar_a(c, ids, v, "published", m, p)
        n = await c.fetchval(
            "SELECT count(1) FROM ai.model_versions mv "
            "JOIN ai.models m ON m.id = mv.model_id "
            "WHERE m.project_id=$1 AND mv.status='published'",
            p,
        )
    assert n == 2


# ── Ayudantes ──────────────────────────────────────────────────────────────
async def _proyecto(c: asyncpg.Connection, ids: dict[str, Any]) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.projects (name, slug, created_by) VALUES ($1,$2,$3) RETURNING id",
        f"P {uuid4().hex[:8]}", f"p-{uuid4().hex[:8]}", ids["owner_user_id"],
    )


async def _modelo(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any,
    arquitectura: str, tarea: str, entrada: str,
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.models (project_id, name, slug, architecture_code, "
        " task, input_type, requires_training, created_by) "
        "VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING id",
        proyecto, f"M {uuid4().hex[:8]}", f"m-{uuid4().hex[:8]}",
        arquitectura, tarea, entrada, ids["owner_user_id"],
    )


async def _asset(c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.assets (project_id, kind, bucket, object_path, original_filename, "
        " content_type, bytes, sha256, created_by) "
        "VALUES ($1,'weights','ai-weights',$2,'best.pt','application/octet-stream',"
        "        2048,$3,$4) RETURNING id",
        proyecto, f"w/{proyecto}/{uuid4()}.pt",
        (uuid4().hex + uuid4().hex)[:64], ids["owner_user_id"],
    )


async def _version(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any, modelo: Any, n: int
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
        " weights_asset_id, source_reference, created_by) "
        "VALUES ($1,$2,$3,'imported',$4,'pesos de prueba',$5) RETURNING id",
        proyecto, modelo, n, await _asset(c, ids, proyecto), ids["owner_user_id"],
    )


async def _llevar_a(
    c: asyncpg.Connection, ids: dict[str, Any], version: Any, destino: str,
    modelo: Any, proyecto: Any,
) -> None:
    """Recorre el ciclo hasta `destino` por el camino legítimo.

    No atajos: si el trigger rechaza un paso, es que el camino no existe y la
    prueba debe enterarse aquí.
    """
    if destino == "registered":
        return
    await c.execute("UPDATE ai.model_versions SET status='validating' WHERE id=$1", version)
    if destino == "validating":
        return
    await c.execute(
        "UPDATE ai.model_versions SET status='validated', validated_at=now() WHERE id=$1", version
    )
    if destino == "validated":
        return
    if destino == "archived":
        await c.execute(
            "UPDATE ai.model_versions SET status='archived', archived_at=now() WHERE id=$1",
            version,
        )
        return
    await c.execute(
        "UPDATE ai.model_versions SET status='published', published_at=now(), "
        " published_by=$2 WHERE id=$1",
        version, ids["owner_user_id"],
    )
    if destino == "published":
        return
    if destino == "deprecated":
        await c.execute(
            "UPDATE ai.model_versions SET status='deprecated', deprecated_at=now() WHERE id=$1",
            version,
        )
        return
    msg = f"destino no contemplado: {destino}"
    raise AssertionError(msg)
