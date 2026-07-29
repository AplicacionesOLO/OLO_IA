"""Repositorios de IA contra Supabase REAL.

    pytest -m integration tests/test_ai_repositories.py

Lo que estas pruebas cubren y las de dominio no pueden: paginación keyset estable,
bloqueo optimista, la vista como read model, y **la serialización de `class_index`
con dos transacciones concurrentes de verdad** — que es la única forma de demostrar
que el advisory lock hace su trabajo.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import pytest
from sqlalchemy.exc import DBAPIError

from olo.core.config import Settings, get_settings
from olo.core.context import TenantContext, set_request_ids
from olo.db.pg_errors import extract_pg_error
from olo.db.session import dispose_engine, init_engine, tenant_session
from olo.domain.ai.model import ModelStatus, Task
from olo.domain.ai.project import ProjectStatus
from olo.repositories.ai import (
    CatalogRepository,
    ClassRepository,
    ModelClassRepository,
    ModelRepository,
    ProjectRepository,
)

from .admin_conn import admin_commit, admin_tx

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.integration

OWNER_EMAIL = "arojas@ologistics.com"


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
        fila = await c.fetchrow(
            "SELECT id, auth_id FROM core.users WHERE email = $1 AND deleted_at IS NULL",
            OWNER_EMAIL,
        )
        tenant = await c.fetchval("SELECT id FROM core.tenants WHERE slug = 'olo-demo'")
    if fila is None or tenant is None:
        pytest.skip("falta el owner o el tenant del escenario de desarrollo")
    return {"user_id": fila["id"], "auth_id": fila["auth_id"], "tenant_id": tenant}


@pytest.fixture
async def sesion(ids: dict[str, Any]) -> AsyncIterator[AsyncSession]:
    """Sesión con el contexto del owner, que se DESHACE al terminar.

    El rollback es lo que hace que estas pruebas no siembren nada: crean proyectos,
    modelos y clases de usar y tirar, y dejarlos contaminaría las siguientes y la
    base de desarrollo.
    """
    set_request_ids("repo-test", "repo-test")
    ctx = TenantContext(
        auth_user_id=ids["auth_id"], tenant_id=ids["tenant_id"], tenant_wide_access=True
    )
    async with tenant_session(ctx) as s:
        yield s
        await s.rollback()


# ══ Proyectos ══════════════════════════════════════════════════════════════
async def test_01_crear_y_leer_un_proyecto(sesion: AsyncSession, ids: dict[str, Any]) -> None:
    repo = ProjectRepository(sesion)
    slug = f"p-{uuid4().hex[:8]}"

    creado = await repo.create(
        {"name": "Inventario EPA", "slug": slug, "description": "prueba"},
        created_by=ids["user_id"],
    )
    assert creado.slug == slug
    assert creado.version == 1
    assert creado.status is ProjectStatus.DRAFT
    # Los defaults de frames vienen de la migración 0025, no del cliente.
    assert creado.frame_interval_seconds == 1.0
    assert creado.max_frames_per_video == 1000
    assert creado.max_video_duration_secs == 1200

    leido = await repo.get_by_id(creado.id)
    assert leido is not None
    assert leido.slug == slug


async def test_02_bloqueo_optimista(sesion: AsyncSession, ids: dict[str, Any]) -> None:
    """Con la versión correcta actualiza; con una obsoleta devuelve `None`.

    El repositorio no lanza: devolver `None` deja que el servicio distinga 412 de
    404 releyendo, que es algo que aquí no se puede saber.
    """
    repo = ProjectRepository(sesion)
    p = await repo.create(
        {"name": "Optimista", "slug": f"o-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )

    actualizado = await repo.update(
        p.id, {"name": "Nombre nuevo"}, expected_version=1, updated_by=ids["user_id"]
    )
    assert actualizado is not None
    assert actualizado.name == "Nombre nuevo"
    assert actualizado.version == 2

    obsoleto = await repo.update(
        p.id, {"name": "No debería"}, expected_version=1, updated_by=ids["user_id"]
    )
    assert obsoleto is None, "una versión obsoleta no debe aplicar el cambio"


async def test_03_paginacion_keyset_es_estable(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """El cursor apunta a la última fila vista, no a un desplazamiento.

    Se inserta una fila ENTRE las dos páginas —justo el caso que rompe `OFFSET`— y
    se comprueba que la segunda página no repite ni se salta nada de la primera.
    """
    repo = ProjectRepository(sesion)
    prefijo = f"pag{uuid4().hex[:6]}"
    for n in range(5):
        await repo.create(
            {"name": f"Proyecto {n}", "slug": f"{prefijo}-{n}"}, created_by=ids["user_id"]
        )

    pagina1 = await repo.list_page(limit=2, search=prefijo)
    assert len(pagina1) == 3, "pide limit+1 para saber si hay más"
    primeros = [p.slug for p in pagina1[:2]]

    # Una inserción que con OFFSET habría desplazado la ventana.
    await repo.create(
        {"name": "Intruso", "slug": f"{prefijo}-0a"}, created_by=ids["user_id"]
    )

    cursor = (pagina1[1].slug, pagina1[1].id)
    pagina2 = await repo.list_page(limit=2, cursor=cursor, search=prefijo)
    segundos = [p.slug for p in pagina2]

    assert not set(primeros) & set(segundos), (
        f"la segunda página repite filas de la primera: {primeros} vs {segundos}"
    )
    assert all(s > primeros[-1] for s in segundos), "el orden keyset no se respetó"


async def test_04_borrado_logico_desaparece_de_las_lecturas(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    repo = ProjectRepository(sesion)
    p = await repo.create(
        {"name": "Para borrar", "slug": f"b-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    await repo.soft_delete_by_id(p.id, expected_version=1)

    assert await repo.get_by_id(p.id) is None
    assert not await repo.exists(p.id)


async def test_05_has_models_detecta_dependencias(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """Las FK no ven el borrado lógico, así que la comprobación va en la aplicación."""
    proyectos = ProjectRepository(sesion)
    modelos = ModelRepository(sesion)
    p = await proyectos.create(
        {"name": "Con modelos", "slug": f"cm-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    assert not await proyectos.has_models(p.id)

    await modelos.create(
        p.id,
        {
            "name": "Detector",
            "slug": f"d-{uuid4().hex[:8]}",
            "architecture_code": "yolo11n",
            "task": "detect",
            "input_type": "image",
        },
        created_by=ids["user_id"],
    )
    assert await proyectos.has_models(p.id)


# ══ Modelos ════════════════════════════════════════════════════════════════
async def test_06_requires_training_lo_pone_el_motor(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """El repositorio manda `false` y el trigger lo corrige.

    Se comprueba con `yolo11n` (entrena) y `sam2-b` (no entrena): el valor final
    depende de la arquitectura, no de lo que envíe la aplicación.
    """
    proyectos = ProjectRepository(sesion)
    modelos = ModelRepository(sesion)
    p = await proyectos.create(
        {"name": "RT", "slug": f"rt-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )

    entrena = await modelos.create(
        p.id,
        {
            "name": "YOLO",
            "slug": f"y-{uuid4().hex[:8]}",
            "architecture_code": "yolo11n",
            "task": "detect",
            "input_type": "image",
        },
        created_by=ids["user_id"],
    )
    assert entrena.requires_training is True

    zero_shot = await modelos.create(
        p.id,
        {
            "name": "SAM",
            "slug": f"s-{uuid4().hex[:8]}",
            "architecture_code": "sam2-b",
            "task": "segment",
            "input_type": "image",
        },
        created_by=ids["user_id"],
    )
    assert zero_shot.requires_training is False


async def test_07_la_vista_resuelve_el_framework(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """`get_resolved` trae los derivados; el `create` contra la tabla, no.

    Es la distinción read model / entidad hecha visible: el mismo modelo tiene
    `framework_code` en `None` al crearse y resuelto al leerse de la vista.
    """
    proyectos = ProjectRepository(sesion)
    modelos = ModelRepository(sesion)
    p = await proyectos.create(
        {"name": "Vista", "slug": f"v-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    creado = await modelos.create(
        p.id,
        {
            "name": "Detector",
            "slug": f"d-{uuid4().hex[:8]}",
            "architecture_code": "yolo11m",
            "task": "detect",
            "input_type": "image",
        },
        created_by=ids["user_id"],
    )
    assert creado.framework_code is None, "el INSERT va contra la tabla, sin derivados"

    resuelto = await modelos.get_resolved(creado.id)
    assert resuelto is not None
    assert resuelto.framework_code == "ultralytics"
    assert resuelto.framework_adapter == "ultralytics"
    assert resuelto.architecture_name == "YOLO11 medium"
    assert resuelto.weights_extension == ".pt"
    # Sin versiones todavía.
    assert resuelto.version_count == 0
    assert resuelto.published_version_id is None
    assert not resuelto.contrato_congelado


async def test_08_filtros_y_conteo_de_versiones(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    proyectos = ProjectRepository(sesion)
    modelos = ModelRepository(sesion)
    p = await proyectos.create(
        {"name": "Filtros", "slug": f"f-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    for arq, tarea in (("yolo11n", "detect"), ("sam2-b", "segment"), ("yolo11s", "classify")):
        await modelos.create(
            p.id,
            {
                "name": f"M {arq}",
                "slug": f"m-{uuid4().hex[:8]}",
                "architecture_code": arq,
                "task": tarea,
                "input_type": "image",
            },
            created_by=ids["user_id"],
        )

    todos = await modelos.list_page(project_id=p.id, limit=50)
    assert len(todos) == 3

    solo_detect = await modelos.list_page(project_id=p.id, limit=50, task=Task.DETECT)
    assert len(solo_detect) == 1
    assert solo_detect[0].task is Task.DETECT

    ninguno = await modelos.list_page(
        project_id=p.id, limit=50, status=ModelStatus.PUBLISHED
    )
    assert not ninguno


async def test_09_slug_taken_excluye_el_propio(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """`excluding` es lo que permite un PATCH que no cambia el slug.

    Sin él, editar el nombre de un modelo daría 409 contra sí mismo.
    """
    proyectos = ProjectRepository(sesion)
    modelos = ModelRepository(sesion)
    p = await proyectos.create(
        {"name": "Slugs", "slug": f"sl-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    slug = f"repetido-{uuid4().hex[:6]}"
    m = await modelos.create(
        p.id,
        {
            "name": "Uno",
            "slug": slug,
            "architecture_code": "yolo11n",
            "task": "detect",
            "input_type": "image",
        },
        created_by=ids["user_id"],
    )

    assert await modelos.slug_taken(p.id, slug)
    assert not await modelos.slug_taken(p.id, slug, excluding=m.id)


# ══ Clases: el advisory lock ═══════════════════════════════════════════════
async def test_10_class_index_es_monotonico(sesion: AsyncSession, ids: dict[str, Any]) -> None:
    proyectos = ProjectRepository(sesion)
    clases = ClassRepository(sesion)
    p = await proyectos.create(
        {"name": "Clases", "slug": f"c-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )

    indices = []
    for nombre in ("pallet", "caja", "etiqueta"):
        c = await clases.create(p.id, {"name": nombre, "color": "#FF8800"},
                                created_by=ids["user_id"])
        indices.append(c.class_index)
    assert indices == [0, 1, 2]


async def test_11_class_index_no_reutiliza_huecos(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """Borrar la clase 1 no libera el índice 1.

    Reutilizarlo haría que un modelo entrenado con la clase 1 antigua interpretara la
    nueva con esa etiqueta — sin producir ningún error.
    """
    proyectos = ProjectRepository(sesion)
    clases = ClassRepository(sesion)
    p = await proyectos.create(
        {"name": "Huecos", "slug": f"h-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )

    await clases.create(p.id, {"name": "a", "color": "#111111"}, created_by=ids["user_id"])
    b = await clases.create(p.id, {"name": "b", "color": "#222222"}, created_by=ids["user_id"])
    await clases.soft_delete_by_id(b.id, expected_version=1)

    siguiente = await clases.create(
        p.id, {"name": "c", "color": "#333333"}, created_by=ids["user_id"]
    )
    assert siguiente.class_index == 2, "no debe reutilizar el índice 1 de la clase borrada"


async def test_12_dos_transacciones_concurrentes_no_colisionan(
    cfg: Settings, ids: dict[str, Any]
) -> None:
    """LA PRUEBA DEL ADVISORY LOCK, con concurrencia REAL.

    Dos sesiones independientes crean una clase en el MISMO proyecto a la vez. Sin
    `pg_advisory_xact_lock`, las dos leerían el mismo `max(class_index)`, calcularían
    el mismo valor y una violaría `uq_class_indice`. Con él, la segunda espera a que
    la primera confirme.

    El proyecto se crea y se confirma ANTES para que las dos sesiones lo vean: dentro
    de una transacción sin confirmar sería invisible para la otra, y la prueba
    mediría otra cosa.
    """
    set_request_ids("lock-test", "lock-test")
    ctx = TenantContext(
        auth_user_id=ids["auth_id"], tenant_id=ids["tenant_id"], tenant_wide_access=True
    )
    slug = f"lock-{uuid4().hex[:8]}"

    async with tenant_session(ctx) as s:
        proyecto = await ProjectRepository(s).create(
            {"name": "Concurrencia", "slug": slug}, created_by=ids["user_id"]
        )
        await s.commit()

    async def crear(nombre: str) -> int:
        async with tenant_session(ctx) as s:
            c = await ClassRepository(s).create(
                proyecto.id, {"name": nombre, "color": "#ABCDEF"},
                created_by=ids["user_id"],
            )
            await s.commit()
            return c.class_index

    try:
        indices = await asyncio.gather(crear("uno"), crear("dos"), crear("tres"))
        assert sorted(indices) == [0, 1, 2], (
            f"tres creaciones concurrentes debían dar índices distintos, dieron {indices}"
        )
    finally:
        # `admin_commit` y NO `admin_tx`: lo sembrado aquí se confirmó, así que
        # borrarlo dentro de una transacción que se deshace no borraría nada.
        # `admin_tx` con un COMMIT a mano dentro «funcionaba» por accidente, y el
        # accidente habría dejado basura en cuanto asyncpg cambiara de comportamiento.
        async with admin_commit() as c:
            await c.execute("DELETE FROM ai.classes WHERE project_id = $1", proyecto.id)
            await c.execute("DELETE FROM ai.projects WHERE id = $1", proyecto.id)


# ══ Vocabulario ════════════════════════════════════════════════════════════
async def test_13_replace_reordena_sin_violar_el_unico(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """Reemplazar [a,b,c] por [c,a,b] con UPDATE individuales violaría `uq_mc_indice`.

    El repositorio hace DELETE + INSERT, así que no pasa por ningún estado intermedio
    con dos clases compartiendo `training_index`.
    """
    proyectos = ProjectRepository(sesion)
    clases = ClassRepository(sesion)
    modelos = ModelRepository(sesion)
    vocab = ModelClassRepository(sesion)

    p = await proyectos.create(
        {"name": "Vocab", "slug": f"vo-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    a = await clases.create(p.id, {"name": "a", "color": "#111111"}, created_by=ids["user_id"])
    b = await clases.create(p.id, {"name": "b", "color": "#222222"}, created_by=ids["user_id"])
    c = await clases.create(p.id, {"name": "c", "color": "#333333"}, created_by=ids["user_id"])
    m = await modelos.create(
        p.id,
        {
            "name": "Det",
            "slug": f"de-{uuid4().hex[:8]}",
            "architecture_code": "yolo11n",
            "task": "detect",
            "input_type": "image",
        },
        created_by=ids["user_id"],
    )

    await vocab.replace(m.id, p.id, [(a.id, 0), (b.id, 1), (c.id, 2)],
                        created_by=ids["user_id"])
    inicial = await vocab.list_for_model(m.id)
    assert [v.class_name for v in inicial] == ["a", "b", "c"]

    # El reordenamiento que rompería un UPDATE fila a fila.
    await vocab.replace(m.id, p.id, [(c.id, 0), (a.id, 1), (b.id, 2)],
                        created_by=ids["user_id"])
    reordenado = await vocab.list_for_model(m.id)
    assert [v.class_name for v in reordenado] == ["c", "a", "b"]
    assert [v.training_index for v in reordenado] == [0, 1, 2]


async def test_14_detecta_clases_inactivas_y_ajenas(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    proyectos = ProjectRepository(sesion)
    clases = ClassRepository(sesion)
    vocab = ModelClassRepository(sesion)

    p1 = await proyectos.create(
        {"name": "P1", "slug": f"p1-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    p2 = await proyectos.create(
        {"name": "P2", "slug": f"p2-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )

    viva = await clases.create(p1.id, {"name": "viva", "color": "#111111"},
                               created_by=ids["user_id"])
    inactiva = await clases.create(p1.id, {"name": "inactiva", "color": "#222222"},
                                   created_by=ids["user_id"])
    await clases.update(inactiva.id, {"is_active": False}, expected_version=1,
                        updated_by=ids["user_id"])
    ajena = await clases.create(p2.id, {"name": "ajena", "color": "#333333"},
                                created_by=ids["user_id"])

    inusables = await vocab.inactive_class_ids(p1.id, [viva.id, inactiva.id, ajena.id])
    assert set(inusables) == {inactiva.id, ajena.id}
    assert viva.id not in inusables

    inexistente = uuid4()
    faltan = await vocab.missing_class_ids(p1.id, [viva.id, inexistente, ajena.id])
    assert set(faltan) == {inexistente, ajena.id}


async def test_15_el_trigger_congela_el_vocabulario(
    sesion: AsyncSession, ids: dict[str, Any]
) -> None:
    """Con versiones registradas, `replace` falla COMPLETO y no a medias.

    El DELETE es lo primero que hace, así que el trigger aborta antes de borrar nada
    y la transacción se deshace entera. Es lo que garantiza que un `PUT` rechazado no
    deje el modelo sin vocabulario.
    """
    proyectos = ProjectRepository(sesion)
    clases = ClassRepository(sesion)
    modelos = ModelRepository(sesion)
    vocab = ModelClassRepository(sesion)

    p = await proyectos.create(
        {"name": "Congelado", "slug": f"cg-{uuid4().hex[:8]}"}, created_by=ids["user_id"]
    )
    a = await clases.create(p.id, {"name": "a", "color": "#111111"}, created_by=ids["user_id"])
    m = await modelos.create(
        p.id,
        {
            "name": "Det",
            "slug": f"dc-{uuid4().hex[:8]}",
            "architecture_code": "yolo11n",
            "task": "detect",
            "input_type": "image",
        },
        created_by=ids["user_id"],
    )
    await vocab.replace(m.id, p.id, [(a.id, 0)], created_by=ids["user_id"])

    # Una versión hace inmutable el vocabulario.
    from sqlalchemy import text as sa_text

    asset = (
        await sesion.execute(
            sa_text(
                "INSERT INTO ai.assets (project_id, kind, bucket, object_path, "
                " original_filename, content_type, bytes, sha256, created_by) "
                "VALUES (CAST(:p AS uuid),'weights','ai-weights',:path,'best.pt',"
                "        'application/octet-stream',1024,:sha,CAST(:u AS uuid)) "
                "RETURNING id"
            ),
            {
                "p": str(p.id),
                "path": f"w/{uuid4()}.pt",
                "sha": (uuid4().hex + uuid4().hex)[:64],
                "u": str(ids["user_id"]),
            },
        )
    ).scalar_one()
    await sesion.execute(
        sa_text(
            "INSERT INTO ai.model_versions (project_id, model_id, version, origin, "
            " weights_asset_id, source_reference, created_by) "
            "VALUES (CAST(:p AS uuid), CAST(:m AS uuid), 1, 'imported', "
            "        CAST(:a AS uuid), 'pesos de prueba', CAST(:u AS uuid))"
        ),
        {"p": str(p.id), "m": str(m.id), "a": str(asset), "u": str(ids["user_id"])},
    )

    b = await clases.create(p.id, {"name": "b", "color": "#222222"},
                            created_by=ids["user_id"])

    # ⚠ El error llega como `DBAPIError`, NO como `asyncpg.RaiseError`: al pasar por
    # una sesión de SQLAlchemy queda envuelto. La primera versión de esta prueba
    # esperaba la excepción de asyncpg y falló aunque el trigger había hecho
    # exactamente lo correcto.
    #
    # Es el caso para el que existe `extract_pg_error`, así que la prueba lo usa en
    # lugar de mirar el texto: comprueba el CÓDIGO INTERNO, que es estable.
    with pytest.raises(DBAPIError) as exc:
        await vocab.replace(m.id, p.id, [(a.id, 0), (b.id, 1)], created_by=ids["user_id"])

    pg = extract_pg_error(exc.value)
    assert pg is not None
    assert pg.sqlstate == "P0001"
    # El trigger de 0039 todavía usa el `raise_exception` genérico sin DETAIL: se
    # pasará a código estable en el paso de servicios, y entonces esta aserción
    # comprobará `AI_MODEL_VOCABULARY_FROZEN` en lugar del mensaje.
    assert "no se puede retirar" in (pg.message or "").lower()

    # Y la transacción queda abortada, que es lo que garantiza que el vocabulario no
    # se quede a medias: el DELETE es lo primero que hace `replace`.
    await sesion.rollback()


# ══ Catálogo ═══════════════════════════════════════════════════════════════
async def test_16_catalogo_de_frameworks(sesion: AsyncSession) -> None:
    repo = CatalogRepository(sesion)
    activos = await repo.list_frameworks()
    assert len(activos) == 6
    por_codigo = {f.code: f for f in activos}
    assert por_codigo["ultralytics"].adapter == "ultralytics"
    assert por_codigo["pytorch"].adapter == "torch"


async def test_17_catalogo_de_arquitecturas_con_filtros(sesion: AsyncSession) -> None:
    repo = CatalogRepository(sesion)

    todas = await repo.list_architectures()
    assert len(todas) == 16

    de_ultralytics = await repo.list_architectures(framework="ultralytics")
    assert {a.code for a in de_ultralytics} >= {"yolo11n", "rtdetr-l"}

    # El filtro por tarea usa contención de arrays en el motor.
    para_ocr = await repo.list_architectures(task=Task.OCR)
    codigos = {a.code for a in para_ocr}
    assert "florence-2-base" in codigos
    assert "yolo11n" not in codigos, "yolo11n no soporta ocr"


async def test_18_una_arquitectura_trae_sus_capacidades(sesion: AsyncSession) -> None:
    repo = CatalogRepository(sesion)

    yolo = await repo.get_architecture("yolo11m")
    assert yolo is not None
    assert Task.DETECT in yolo.supported_tasks
    assert yolo.requires_training
    assert yolo.hiperparametros_verificados, "yolo11m debe traer hyperparam_schema"

    sam = await repo.get_architecture("sam2-b")
    assert sam is not None
    assert sam.es_zero_shot
    assert not sam.hiperparametros_verificados, "sam2-b lo tiene pendiente a propósito"
    assert not sam.supported_annotation_kinds

    assert await repo.get_architecture("no-existe") is None
