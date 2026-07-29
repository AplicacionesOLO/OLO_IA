"""Pruebas del Bloque 0.5: schemas, agnosticidad y modelo lógico.

    pytest -m integration tests/test_ai_block05.py

Cinco bloques:

  01-05  estructura: los 4 schemas, privilegios, `platform` solo con gobierno
  06-10  aislamiento RLS sobre las 12 tablas de `ai`
  11-16  el catálogo de capacidades CON EFECTO, no como documentación
  17-22  modelo lógico, versiones y los tres orígenes
  23-28  vocabulario compartido y los 6 tipos de anotación

La compatibilidad con el Bloque 0 se prueba en `test_platform_block0.py`: sus 17
pruebas siguen pasando con los nombres nuevos, y eso es lo que demuestra que el
movimiento no rompió nada.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy import text

from olo.core.config import Settings, get_settings
from olo.core.context import TenantContext, set_request_ids
from olo.db.session import dispose_engine, init_engine, tenant_session, unscoped_session

from .admin_conn import admin_tx

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

# Las 12 tablas de `ai` tras el Bloque 0.5: las 7 movidas más las 5 nuevas.
TABLAS_AI = (
    "ai.projects",
    "ai.classes",
    "ai.assets",
    "ai.images",
    "ai.dataset_versions",
    "ai.dataset_items",
    "ai.annotations",
    "ai.frameworks",
    "ai.architectures",
    "ai.models",
    "ai.model_versions",
    "ai.model_classes",
)


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

    por_email = {r["email"]: r for r in filas}
    if OWNER_EMAIL not in por_email or NON_OWNER_EMAIL not in por_email or tenant is None:
        pytest.skip("faltan los usuarios o el tenant del escenario de desarrollo")

    return {
        "tenant_id": tenant,
        "owner_user_id": por_email[OWNER_EMAIL]["id"],
        "owner_auth_id": por_email[OWNER_EMAIL]["auth_id"],
        "other_auth_id": por_email[NON_OWNER_EMAIL]["auth_id"],
    }


def _ctx(auth_id: Any, tenant_id: Any, *, wide: bool = True) -> TenantContext:
    set_request_ids("block05-test", "block05-test")
    return TenantContext(auth_user_id=auth_id, tenant_id=tenant_id, tenant_wide_access=wide)


# ══ 01-05 · Estructura ═════════════════════════════════════════════════════
async def test_01_existen_los_cuatro_schemas() -> None:
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT nspname FROM pg_namespace "
            "WHERE nspname = ANY($1::text[]) ORDER BY nspname",
            ["core", "platform", "ai", "perception"],
        )
    assert {r["nspname"] for r in filas} == {"core", "platform", "ai", "perception"}


async def test_02_platform_solo_conserva_gobierno() -> None:
    """`platform` queda reducido a gobierno de plataforma (decisión 2).

    Es el resultado observable del movimiento: si quedara alguna tabla `ai_*`, el
    schema seguiría siendo una mezcla de gobierno y dominio de IA.
    """
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'platform' AND c.relkind = 'r' ORDER BY c.relname"
        )
    nombres = {r["relname"] for r in filas}
    assert nombres == {"owners", "privileged_operation_log"}, (
        f"platform debe tener solo gobierno, tiene: {sorted(nombres)}"
    )


async def test_03_las_doce_tablas_estan_en_ai() -> None:
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'ai' AND c.relkind = 'r'"
        )
    esperadas = {t.split(".", 1)[1] for t in TABLAS_AI}
    assert {r["relname"] for r in filas} == esperadas


async def test_04_perception_preparado_y_sin_tablas() -> None:
    """Privilegios listos, cero tablas operativas (decisión D y 14).

    Los default privileges tienen que existir ANTES de la primera tabla o no se
    heredan. Que el schema esté vacío es parte de la prueba: las tablas de
    percepción son del Bloque 7.
    """
    async with admin_tx() as c:
        usage = await c.fetchval("SELECT has_schema_privilege('olo_app','perception','USAGE')")
        create = await c.fetchval("SELECT has_schema_privilege('olo_app','perception','CREATE')")
        tablas = await c.fetchval(
            "SELECT count(1) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'perception' AND c.relkind = 'r'"
        )
        defaults = await c.fetchval(
            "SELECT count(1) FROM pg_default_acl d "
            "JOIN pg_namespace n ON n.oid = d.defaclnamespace "
            "WHERE n.nspname = 'perception' AND d.defaclrole = 'postgres'::regrole"
        )
    assert usage is True
    assert create is False, "olo_app no debe poder crear objetos"
    assert tablas == 0, "perception debe quedar sin tablas operativas"
    assert defaults > 0, "los default privileges deben preceder a la primera tabla"


async def test_05_projects_sin_columnas_de_modelo() -> None:
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'ai' AND table_name = 'projects'"
        )
    cols = {r["column_name"] for r in filas}
    assert "base_model" not in cols
    assert "task" not in cols
    # Los de extracción de frames se quedan: alimentan el pool del proyecto.
    assert {"frame_interval_seconds", "max_frames_per_video",
            "max_video_duration_secs"} <= cols


# ══ 06-10 · Aislamiento RLS ════════════════════════════════════════════════
async def test_06_sin_identidad_no_ve_ninguna_de_las_doce(ids: dict[str, Any]) -> None:
    async with unscoped_session() as s:
        await s.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"),
            {"t": str(ids["tenant_id"])},
        )
        for tabla in TABLAS_AI:
            n = (await s.execute(text(f"SELECT count(1) FROM {tabla}"))).scalar_one()  # noqa: S608
            assert n == 0, f"{tabla} expone {n} filas SIN identidad"


async def test_07_no_owner_no_ve_ninguna_de_las_doce(ids: dict[str, Any]) -> None:
    """Incluidos los catálogos.

    `frameworks` y `architectures` no contienen datos de cliente, pero revelan la
    hoja de ruta técnica de la plataforma. Van bajo la misma política.
    """
    ctx = _ctx(ids["other_auth_id"], ids["tenant_id"], wide=False)
    async with tenant_session(ctx) as s:
        for tabla in TABLAS_AI:
            n = (await s.execute(text(f"SELECT count(1) FROM {tabla}"))).scalar_one()  # noqa: S608
            assert n == 0, f"{tabla} expone {n} filas a un usuario que no es owner"


async def test_08_owner_ve_los_catalogos(ids: dict[str, Any]) -> None:
    ctx = _ctx(ids["owner_auth_id"], ids["tenant_id"])
    async with tenant_session(ctx) as s:
        fw = (await s.execute(text("SELECT count(1) FROM ai.frameworks"))).scalar_one()
        arch = (await s.execute(text("SELECT count(1) FROM ai.architectures"))).scalar_one()
    assert fw == 6, f"se esperaban 6 frameworks, el owner ve {fw}"
    assert arch == 16, f"se esperaban 16 arquitecturas, el owner ve {arch}"


async def test_09_las_doce_tienen_rls_forzada() -> None:
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'ai' AND c.relkind = 'r'"
        )
    for r in filas:
        assert r["relrowsecurity"], f"ai.{r['relname']} sin RLS"
        assert r["relforcerowsecurity"], f"ai.{r['relname']} sin FORCE RLS"


async def test_10_ninguna_fk_apunta_a_platform() -> None:
    """El movimiento no debe dejar referencias cruzadas entre schemas."""
    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT t.relname AS tabla, c.conname "
            "FROM pg_constraint c "
            "JOIN pg_class t ON t.oid = c.conrelid "
            "JOIN pg_class rt ON rt.oid = c.confrelid "
            "JOIN pg_namespace n ON n.oid = t.relnamespace "
            "JOIN pg_namespace rn ON rn.oid = rt.relnamespace "
            "WHERE n.nspname = 'ai' AND c.contype = 'f' AND rn.nspname = 'platform'"
        )
    assert not filas, f"FK de ai apuntando a platform: {[dict(r) for r in filas]}"


# ══ 11-16 · El catálogo de capacidades con efecto ══════════════════════════
async def test_11_tarea_no_soportada_se_rechaza(ids: dict[str, Any]) -> None:
    """Un modelo `ocr` sobre `yolo11n` no llega a existir.

    Es la diferencia entre un catálogo que documenta y uno que decide: sin el
    trigger, este modelo se crearía y el fallo aparecería al lanzar el
    entrenamiento, después de reservar una GPU.
    """
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        with pytest.raises(asyncpg.RaiseError, match="no soporta la tarea"):
            await _modelo(c, ids, proyecto, "yolo11n", "ocr", "image")


async def test_12_entrada_no_soportada_se_rechaza(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        with pytest.raises(asyncpg.RaiseError, match="no soporta la entrada"):
            await _modelo(c, ids, proyecto, "yolo11n", "detect", "thermal")


async def test_13_el_framework_ya_no_puede_ser_incoherente(ids: dict[str, Any]) -> None:
    """La incoherencia dejó de ser posible: la columna no existe.

    Esta prueba comprobaba antes que un `framework_code` distinto al de la
    arquitectura se rechazara. La migración 0042 eliminó la columna de
    `ai.models` —era duplicado puro— así que el invariante pasó de «protegido» a
    **inexpresable**, que es estrictamente mejor. Lo que se prueba ahora es eso.
    """
    async with admin_tx() as c:
        cols = {
            r["column_name"]
            for r in await c.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'ai' AND table_name = 'models'"
            )
        }
        assert "framework_code" not in cols, "framework_code no debe persistirse en ai.models"

        # Y la vista lo resuelve por JOIN, con su adaptador.
        proyecto = await _proyecto(c, ids)
        modelo = await _modelo(c, ids, proyecto, "yolo11n", "detect", "image")
        fila = await c.fetchrow(
            "SELECT framework_code, framework_adapter, architecture_name "
            "FROM ai.models_resolved WHERE id = $1",
            modelo,
        )
    assert fila["framework_code"] == "ultralytics"
    assert fila["framework_adapter"] == "ultralytics"
    assert fila["architecture_name"] == "YOLO11 nano"


async def test_14_requires_training_se_copia_de_la_arquitectura(ids: dict[str, Any]) -> None:
    """El cliente no decide si un modelo entrena: lo dice la arquitectura.

    Se envía `true` para un SAM2 y debe quedar en `false`, ignorando lo enviado.
    """
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        modelo = await _modelo(
            c, ids, proyecto, "sam2-b", "segment", "image", requiere=True
        )
        valor = await c.fetchval(
            "SELECT requires_training FROM ai.models WHERE id = $1", modelo
        )
    assert valor is False, "requires_training debía copiarse de sam2-b (false)"


async def test_15_los_dominios_validan_los_arrays() -> None:
    """La propiedad de la que depende todo el catálogo.

    Si los CHECK de un DOMAIN no se aplicaran a los elementos de un array, las
    capacidades no serían fiables y habría que añadir CHECK explícitos con `<@`.
    """
    # Una transacción por violación: tras un error, PostgreSQL aborta la
    # transacción y toda sentencia posterior devuelve InFailedSQLTransactionError
    # en lugar del error que se quería comprobar.
    async with admin_tx() as c:
        with pytest.raises(asyncpg.CheckViolationError):
            await c.execute("SELECT ARRAY['detect','tarea_inventada']::ai.task[]")

    async with admin_tx() as c:
        with pytest.raises(asyncpg.CheckViolationError):
            await c.execute("SELECT ARRAY['image','entrada_inventada']::ai.input_type[]")

    async with admin_tx() as c:
        with pytest.raises(asyncpg.CheckViolationError):
            await c.execute("SELECT ARRAY['bbox','tipo_inventado']::ai.annotation_kind[]")


async def test_16_coherencia_entre_entrenamiento_y_anotaciones() -> None:
    """Una arquitectura que entrena tiene que declarar qué anotaciones consume."""
    async with admin_tx() as c:
        with pytest.raises(asyncpg.CheckViolationError, match="chk_arch_anotaciones"):
            await c.execute(
                "INSERT INTO ai.architectures (code, framework_code, display_name, family, "
                " supported_tasks, supported_input_types, supported_annotation_kinds, "
                " requires_training, requires_annotations) "
                "VALUES ('mala-1','custom','Mala','mala', "
                "        ARRAY['detect']::ai.task[], ARRAY['image']::ai.input_type[], "
                "        ARRAY['bbox']::ai.annotation_kind[], false, false)"
            )

    async with admin_tx() as c:
        with pytest.raises(asyncpg.CheckViolationError, match="chk_arch_entrena"):
            await c.execute(
                "INSERT INTO ai.architectures (code, framework_code, display_name, family, "
                " supported_tasks, supported_input_types, supported_annotation_kinds, "
                " requires_training, requires_annotations) "
                "VALUES ('mala-2','custom','Mala','mala', "
                "        ARRAY['detect']::ai.task[], ARRAY['image']::ai.input_type[], "
                "        '{}'::ai.annotation_kind[], true, false)"
            )


# ══ 17-22 · Modelo lógico y versiones ══════════════════════════════════════
async def test_17_varios_modelos_en_el_mismo_proyecto(ids: dict[str, Any]) -> None:
    """El caso que motivó todo el ajuste: cinco modelos, un proyecto."""
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        await _modelo(c, ids, proyecto, "yolo11m", "detect", "image")
        await _modelo(c, ids, proyecto, "rtdetr-l", "detect", "image")
        await _modelo(c, ids, proyecto, "sam2-b", "segment", "image")
        await _modelo(c, ids, proyecto, "florence-2-base", "ocr", "image")
        await _modelo(c, ids, proyecto, "yolo11s", "classify", "image")
        n = await c.fetchval(
            "SELECT count(1) FROM ai.models WHERE project_id = $1", proyecto
        )
    assert n == 5


async def test_18_slug_unico_por_proyecto(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        await c.execute(
            "INSERT INTO ai.models (project_id, name, slug, "
            " architecture_code, task, input_type, requires_training, created_by) "
            "VALUES ($1,'Uno','repetido','yolo11n','detect','image',true,$2)",
            proyecto,
            ids["owner_user_id"],
        )
        with pytest.raises(asyncpg.UniqueViolationError):
            await c.execute(
                "INSERT INTO ai.models (project_id, name, slug, "
                " architecture_code, task, input_type, requires_training, created_by) "
                "VALUES ($1,'Dos','repetido','yolo11n','detect','image',true,$2)",
                proyecto,
                ids["owner_user_id"],
            )


async def test_19_version_pretrained_sin_entrenamiento(ids: dict[str, Any]) -> None:
    """LA DECISIÓN 9. SAM2 no se entrena: se registra y se publica.

    Sin `origin`, esta versión habría necesitado un `run_id` que no existe, y cada
    modelo zero-shot un camino paralelo en el código.
    """
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        modelo = await _modelo(c, ids, proyecto, "sam2-b", "segment", "image")
        asset = await _asset(c, ids, proyecto, kind="weights")
        version = await c.fetchval(
            "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
            " weights_asset_id, source_reference, created_by) "
            "VALUES ($1,$2,1,'pretrained',$3,'https://ai.meta.com/sam2',$4) RETURNING id",
            proyecto,
            modelo,
            asset,
            ids["owner_user_id"],
        )
        # Nace `registered` y recorre el MISMO ciclo que una entrenada: es la
        # invariante 6. El ciclo no menciona `origin` en ninguna condición.
        assert await c.fetchval(
            "SELECT status FROM ai.model_versions WHERE id = $1", version
        ) == "registered"

        await c.execute("UPDATE ai.model_versions SET status='validating' WHERE id=$1", version)
        await c.execute(
            "UPDATE ai.model_versions SET status='validated', validated_at=now() WHERE id=$1",
            version,
        )
        await c.execute(
            "UPDATE ai.model_versions SET status='published', published_at=now(), "
            " published_by=$2 WHERE id = $1",
            version,
            ids["owner_user_id"],
        )
        estado = await c.fetchval(
            "SELECT status FROM ai.model_versions WHERE id = $1", version
        )
    assert estado == "published"


async def test_20_importada_sin_procedencia_se_rechaza(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        modelo = await _modelo(c, ids, proyecto, "clip-vit-b32", "embed", "image")
        asset = await _asset(c, ids, proyecto, kind="weights")
        with pytest.raises(asyncpg.CheckViolationError, match="chk_mv_procedencia"):
            await c.execute(
                "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
                " weights_asset_id, created_by) VALUES ($1,$2,1,'imported',$3,$4)",
                proyecto,
                modelo,
                asset,
                ids["owner_user_id"],
            )


async def test_21_una_sola_publicada_por_modelo(ids: dict[str, Any]) -> None:
    """Lo garantiza el índice parcial, no el código.

    Y con el ciclo de 0043 hace algo más: **obliga a que degradar la anterior sea
    explícito**. Publicar sin degradar no cabe, así que no existe un camino que
    deje dos versiones en producción.
    """
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        modelo = await _modelo(c, ids, proyecto, "yolo11n", "detect", "image")
        asset = await _asset(c, ids, proyecto, kind="weights")

        for v in (1, 2):
            await c.execute(
                "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
                " weights_asset_id, source_reference, created_by) "
                "VALUES ($1,$2,$3,'imported',$4,'prueba de unicidad',$5)",
                proyecto, modelo, v, asset, ids["owner_user_id"],
            )
            await c.execute(
                "UPDATE ai.model_versions SET status='validating' "
                "WHERE model_id=$1 AND version=$2", modelo, v,
            )
            await c.execute(
                "UPDATE ai.model_versions SET status='validated', validated_at=now() "
                "WHERE model_id=$1 AND version=$2", modelo, v,
            )

        await c.execute(
            "UPDATE ai.model_versions SET status='published', published_at=now(), "
            " published_by=$2 WHERE model_id = $1 AND version = 1",
            modelo, ids["owner_user_id"],
        )
        with pytest.raises(asyncpg.UniqueViolationError, match="uq_mv_publicada"):
            await c.execute(
                "UPDATE ai.model_versions SET status='published', published_at=now(), "
                " published_by=$2 WHERE model_id = $1 AND version = 2",
                modelo, ids["owner_user_id"],
            )


@pytest.mark.parametrize(
    ("columna", "valor"),
    [
        ("architecture_code", "'florence-2-base'"),
        ("task", "'detect'"),
        ("input_type", "'frames'"),          # AGUJERO A: era mutable hasta 0042
    ],
)
async def test_22_contrato_inmutable_con_versiones(
    ids: dict[str, Any], columna: str, valor: str
) -> None:
    """Los TRES campos del contrato, y por `DETAIL`, no por texto.

    `input_type` es el que la migración 0042 añadió: el sondeo lo midió mutable
    con versiones existentes, y cambiarlo altera cómo se alimentan los pesos.

    Se comprueba el código interno estable y no el mensaje humano: el mensaje puede
    reescribirse sin previo aviso y una prueba que dependa de él es frágil.
    """
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        # sam2-b acepta image/video/frames, así que 'frames' es un valor VÁLIDO:
        # lo que lo rechaza es la inmutabilidad, no la compatibilidad.
        modelo = await _modelo(c, ids, proyecto, "sam2-b", "segment", "image")
        asset = await _asset(c, ids, proyecto, kind="weights")
        await c.execute(
            "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
            " weights_asset_id, source_reference, created_by) "
            "VALUES ($1,$2,1,'pretrained',$3,'pesos oficiales',$4)",
            proyecto, modelo, asset, ids["owner_user_id"],
        )
        with pytest.raises(asyncpg.RaiseError) as exc:
            await c.execute(
                f"UPDATE ai.models SET {columna} = {valor} WHERE id = $1",  # noqa: S608
                modelo,
            )
    assert exc.value.detail == "AI_MODEL_CONTRACT_IMMUTABLE"
    assert exc.value.sqlstate == "P0001"


# ══ 23-28 · Vocabulario compartido y tipos de anotación ═══════════════════
async def test_23_dos_modelos_comparten_imagenes_y_anotaciones(ids: dict[str, Any]) -> None:
    """LA DECISIÓN 6, y la razón de que los datasets cuelguen del modelo.

    YOLO11 y RT-DETR sobre los MISMOS datos: una imagen, una anotación, dos
    modelos. Si las anotaciones colgaran del modelo, este experimento —el más
    común del aprendizaje automático— exigiría volver a anotar todo.
    """
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        clase = await _clase(c, ids, proyecto, "pallet", 0)
        imagen = await _imagen(c, ids, proyecto, await _asset(c, ids, proyecto))
        await c.execute(
            "INSERT INTO ai.annotations (project_id, image_id, class_id, kind, "
            " cx, cy, w, h, created_by) "
            "VALUES ($1,$2,$3,'bbox',0.5,0.5,0.2,0.2,$4)",
            proyecto, imagen, clase, ids["owner_user_id"],
        )

        m1 = await _modelo(c, ids, proyecto, "yolo11m", "detect", "image")
        m2 = await _modelo(c, ids, proyecto, "rtdetr-l", "detect", "image")
        for m in (m1, m2):
            await c.execute(
                "INSERT INTO ai.model_classes (model_id, class_id, project_id, "
                " training_index, created_by) VALUES ($1,$2,$3,0,$4)",
                m, clase, proyecto, ids["owner_user_id"],
            )

        imagenes = await c.fetchval(
            "SELECT count(1) FROM ai.images WHERE project_id = $1", proyecto
        )
        anotaciones = await c.fetchval(
            "SELECT count(1) FROM ai.annotations WHERE project_id = $1", proyecto
        )
        modelos = await c.fetchval(
            "SELECT count(DISTINCT model_id) FROM ai.model_classes WHERE project_id = $1",
            proyecto,
        )
    assert imagenes == 1, "la imagen no debe duplicarse por modelo"
    assert anotaciones == 1, "la anotación no debe duplicarse por modelo"
    assert modelos == 2, "los dos modelos deben compartirla"


async def test_24_model_classes_rechaza_clase_de_otro_proyecto(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        p_a = await _proyecto(c, ids)
        p_b = await _proyecto(c, ids)
        modelo_a = await _modelo(c, ids, p_a, "yolo11n", "detect", "image")
        clase_b = await _clase(c, ids, p_b, "ajena", 0)
        with pytest.raises(asyncpg.ForeignKeyViolationError, match="fk_mc_class"):
            await c.execute(
                "INSERT INTO ai.model_classes (model_id, class_id, project_id, "
                " training_index, created_by) VALUES ($1,$2,$3,0,$4)",
                modelo_a, clase_b, p_a, ids["owner_user_id"],
            )


async def test_25_training_index_congelado_con_versiones(ids: dict[str, Any]) -> None:
    """Antes de tener pesos se puede reordenar; después, no."""
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        clase = await _clase(c, ids, proyecto, "pallet", 0)
        modelo = await _modelo(c, ids, proyecto, "yolo11n", "detect", "image")
        await c.execute(
            "INSERT INTO ai.model_classes (model_id, class_id, project_id, "
            " training_index, created_by) VALUES ($1,$2,$3,0,$4)",
            modelo, clase, proyecto, ids["owner_user_id"],
        )
        # Sin versiones: reordenable
        await c.execute(
            "UPDATE ai.model_classes SET training_index = 3 "
            "WHERE model_id = $1 AND class_id = $2",
            modelo, clase,
        )

        asset = await _asset(c, ids, proyecto, kind="weights")
        await c.execute(
            "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
            " weights_asset_id, source_reference, created_by) "
            "VALUES ($1,$2,1,'imported',$3,'prueba',$4)",
            proyecto, modelo, asset, ids["owner_user_id"],
        )
        with pytest.raises(asyncpg.RaiseError, match="training_index es inmutable"):
            await c.execute(
                "UPDATE ai.model_classes SET training_index = 7 "
                "WHERE model_id = $1 AND class_id = $2",
                modelo, clase,
            )


async def test_26_image_label_sin_geometria(ids: dict[str, Any]) -> None:
    """Un clasificador anota la imagen entera. Era imposible antes de 0040."""
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        clase = await _clase(c, ids, proyecto, "danado", 0)
        imagen = await _imagen(c, ids, proyecto, await _asset(c, ids, proyecto))
        creada = await c.fetchval(
            "INSERT INTO ai.annotations (project_id, image_id, class_id, kind, created_by) "
            "VALUES ($1,$2,$3,'image_label',$4) RETURNING id",
            proyecto, imagen, clase, ids["owner_user_id"],
        )
    assert creada is not None


async def test_27_text_region_y_count(ids: dict[str, Any]) -> None:
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        clase = await _clase(c, ids, proyecto, "etiqueta", 0)
        imagen = await _imagen(c, ids, proyecto, await _asset(c, ids, proyecto))

        await c.execute(
            "INSERT INTO ai.annotations (project_id, image_id, class_id, kind, "
            " cx, cy, w, h, text_value, created_by) "
            "VALUES ($1,$2,$3,'text_region',0.5,0.5,0.3,0.1,'SSCC 00345678',$4)",
            proyecto, imagen, clase, ids["owner_user_id"],
        )
        await c.execute(
            "INSERT INTO ai.annotations (project_id, image_id, class_id, kind, "
            " numeric_value, created_by) VALUES ($1,$2,$3,'count',24,$4)",
            proyecto, imagen, clase, ids["owner_user_id"],
        )
        n = await c.fetchval(
            "SELECT count(1) FROM ai.annotations WHERE project_id = $1", proyecto
        )
    assert n == 2


@pytest.mark.parametrize(
    ("kind", "columnas", "valores"),
    [
        ("bbox", "", ""),                                  # sin coordenadas
        ("text_region", ", cx, cy, w, h", ", 0.5, 0.5, 0.2, 0.2"),  # sin texto
        ("count", "", ""),                                 # sin cantidad
        ("polygon", "", ""),                               # sin geometría
    ],
)
async def test_28_la_matriz_rechaza_lo_incompleto(
    ids: dict[str, Any], kind: str, columnas: str, valores: str
) -> None:
    """Cada tipo exige exactamente sus columnas. La matriz la impone el motor."""
    async with admin_tx() as c:
        proyecto = await _proyecto(c, ids)
        clase = await _clase(c, ids, proyecto, "x", 0)
        imagen = await _imagen(c, ids, proyecto, await _asset(c, ids, proyecto))
        with pytest.raises(asyncpg.CheckViolationError, match="chk_ann_forma"):
            await c.execute(
                f"INSERT INTO ai.annotations (project_id, image_id, class_id, kind"  # noqa: S608
                f"{columnas}, created_by) VALUES ($1,$2,$3,'{kind}'{valores},$4)",
                proyecto, imagen, clase, ids["owner_user_id"],
            )


# ── Ayudantes ──────────────────────────────────────────────────────────────
async def _proyecto(c: asyncpg.Connection, ids: dict[str, Any]) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.projects (name, slug, created_by) VALUES ($1,$2,$3) RETURNING id",
        f"P {uuid4().hex[:8]}",
        f"p-{uuid4().hex[:8]}",
        ids["owner_user_id"],
    )


async def _modelo(
    c: asyncpg.Connection,
    ids: dict[str, Any],
    proyecto: Any,
    arquitectura: str,
    tarea: str,
    entrada: str,
    *,
    requiere: bool = True,
) -> Any:
    """Sin `framework`: la migración 0042 eliminó la columna de `ai.models`.

    Era duplicado puro del framework de la arquitectura y podía divergir si se
    editaba el catálogo. Ahora se resuelve por JOIN en `ai.models_resolved`.
    """
    return await c.fetchval(
        "INSERT INTO ai.models (project_id, name, slug, "
        " architecture_code, task, input_type, requires_training, created_by) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        proyecto,
        f"M {uuid4().hex[:8]}",
        f"m-{uuid4().hex[:8]}",
        arquitectura,
        tarea,
        entrada,
        requiere,
        ids["owner_user_id"],
    )


async def _clase(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any, nombre: str, indice: int
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.classes (project_id, name, class_index, color, created_by) "
        "VALUES ($1,$2,$3,'#FF8800',$4) RETURNING id",
        proyecto, nombre, indice, ids["owner_user_id"],
    )


async def _asset(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any, *, kind: str = "image"
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.assets (project_id, kind, bucket, object_path, original_filename, "
        " content_type, bytes, sha256, width, height, created_by) "
        "VALUES ($1,$2,'ai-source',$3,'f.jpg','image/jpeg',1024,$4,640,480,$5) RETURNING id",
        proyecto,
        kind,
        f"p/{proyecto}/{uuid4()}",
        (uuid4().hex + uuid4().hex)[:64],
        ids["owner_user_id"],
    )


async def _imagen(
    c: asyncpg.Connection, ids: dict[str, Any], proyecto: Any, asset: Any
) -> Any:
    return await c.fetchval(
        "INSERT INTO ai.images (project_id, asset_id, source, created_by) "
        "VALUES ($1,$2,'upload',$3) RETURNING id",
        proyecto, asset, ids["owner_user_id"],
    )
