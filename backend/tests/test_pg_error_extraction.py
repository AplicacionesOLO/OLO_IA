"""El extractor de errores de PostgreSQL y la exhaustividad del mapa.

    pytest tests/test_pg_error_extraction.py

La mayoría no necesita base de datos: prueban el extractor con excepciones
construidas a mano, imitando cada forma que puede tomar la cadena de causas. Eso
es lo que permite comprobar que sobrevive a un cambio de SQLAlchemy sin tener que
instalar otra versión.

La prueba central es `test_01_exhaustividad`: lee los archivos de migración, saca
cada `DETAIL = '...'` y falla si alguno no está en el registro. Es la única forma
de que el mapa esté demostrablemente completo — mantenerlo a mano garantiza que
algún día un trigger emita un código que nadie tradujo, y eso sale como 500.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from olo.core.errors import (
    ArchitectureInUseError,
    ClassIndexConflictError,
    ConflictError,
    CrossProjectReferenceError,
    ModelContractImmutableError,
    VersionTransitionError,
)
from olo.db.pg_errors import PgError, extract_pg_error
from olo.services.ai.errors import codigos_registrados, translate_pg_error

_MIGRACIONES = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


@pytest.fixture
async def cfg_real() -> object:
    """Motor real, solo para `test_16b`. El resto del archivo no toca la base.

    Marcada `integration` a través de la propia prueba que la usa: se omite si no
    hay configuración, en lugar de fallar por un problema de entorno.
    """
    from olo.core.config import get_settings
    from olo.db.session import dispose_engine, init_engine

    try:
        cfg = get_settings()
    except Exception as exc:
        pytest.skip(f"sin configuración válida: {type(exc).__name__}")
    if "supabase.co" not in cfg.supabase_url:
        pytest.skip("SUPABASE_URL no apunta a un proyecto real")

    init_engine(cfg, null_pool=True)
    yield cfg
    await dispose_engine()

# `DETAIL = 'CODIGO'` en cualquier RAISE de las migraciones. Se acepta comilla
# simple porque es lo que usa PL/pgSQL, y se exige mayúsculas con subrayado para no
# capturar los DETAIL que PostgreSQL genera solo.
_RE_DETAIL = re.compile(r"DETAIL\s*=\s*'([A-Z][A-Z0-9_]+)'")


# ══ 01 · Exhaustividad ═════════════════════════════════════════════════════
def test_01_exhaustividad_del_registro() -> None:
    """Todo `DETAIL` emitido por una migración tiene traducción.

    Lee la FUENTE DE VERDAD —los archivos SQL— en lugar de una lista mantenida a
    mano. Si mañana alguien añade un trigger con un código nuevo y se olvida del
    mapa, esta prueba lo dice antes de que el código llegue a producción como 500.
    """
    assert _MIGRACIONES.is_dir(), f"no encuentro las migraciones en {_MIGRACIONES}"

    emitidos: dict[str, list[str]] = {}
    for archivo in sorted(_MIGRACIONES.glob("*.sql")):
        for codigo in _RE_DETAIL.findall(archivo.read_text(encoding="utf-8")):
            emitidos.setdefault(codigo, []).append(archivo.name)

    assert emitidos, "ninguna migración emite DETAIL: el regex o la ruta están mal"

    registrados = codigos_registrados()
    sin_mapear = {c: v for c, v in emitidos.items() if c not in registrados}

    assert not sin_mapear, (
        "códigos internos emitidos por migraciones y SIN traducción en "
        f"olo.services.ai.errors._REGISTRO: {sin_mapear}. "
        "Cada uno saldría como 500 en lugar de 409 o 422."
    )


def test_02_el_registro_no_tiene_codigos_muertos() -> None:
    """Al revés: un código registrado que ninguna migración emite.

    No es un fallo grave —puede ser una preparación deliberada, como los códigos de
    vocabulario que los triggers de 0026 y 0039 emitirán en el Bloque 1— pero
    conviene verlo para que la lista no acumule restos de refactorizaciones.
    """
    emitidos: set[str] = set()
    for archivo in _MIGRACIONES.glob("*.sql"):
        emitidos.update(_RE_DETAIL.findall(archivo.read_text(encoding="utf-8")))

    pendientes = codigos_registrados() - emitidos
    # Estos cuatro están registrados por adelantado, a propósito.
    esperados = {
        "AI_MODEL_VOCABULARY_FROZEN",
        "AI_CLASS_INDEX_CONFLICT",
        "AI_CLASS_INACTIVE",
        "AI_CROSS_PROJECT_REFERENCE",
    }
    inesperados = pendientes - esperados
    assert not inesperados, (
        f"códigos registrados que ninguna migración emite y no estaban previstos: "
        f"{sorted(inesperados)}"
    )


# ══ 03-10 · El extractor, con cada forma de cadena ═════════════════════════
#
# Las tres clases de abajo imitan las excepciones del driver y NO llevan sufijo
# `Error` a propósito: no son errores del proyecto, son dobles de prueba de las
# excepciones de asyncpg y SQLAlchemy. Llamarlas `...Error` las haría parecer
# errores del dominio en cualquier traza y en cualquier búsqueda.
# ruff: noqa: N818
class _FalsoAsyncpg(Exception):
    """Imita la forma de `asyncpg.PostgresError`: campos como atributos."""

    def __init__(
        self,
        message: str,
        *,
        sqlstate: str | None = None,
        detail: str | None = None,
        constraint_name: str | None = None,
        table_name: str | None = None,
        schema_name: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.sqlstate = sqlstate
        self.detail = detail
        self.constraint_name = constraint_name
        self.table_name = table_name
        self.schema_name = schema_name


class _FalsoDialecto(Exception):
    """Imita el envoltorio del dialecto: conserva sqlstate y PIERDE detail.

    Es la forma medida contra el stack real, y la razón de que el extractor tenga
    que recorrer la cadena en lugar de leer `e.orig`.
    """

    def __init__(self, message: str, *, sqlstate: str | None = None) -> None:
        super().__init__(message)
        self.sqlstate = sqlstate


class _FalsoSQLAlchemy(Exception):
    """Imita `DBAPIError`: expone `.orig` y encadena con `__cause__`."""

    def __init__(self, message: str, orig: BaseException) -> None:
        super().__init__(message)
        self.orig = orig


def test_03_extrae_de_asyncpg_directo() -> None:
    exc = _FalsoAsyncpg(
        "Mensaje humano",
        sqlstate="P0001",
        detail="AI_MODEL_CONTRACT_IMMUTABLE",
        constraint_name="chk_algo",
        table_name="models",
        schema_name="ai",
    )
    pg = extract_pg_error(exc)
    assert pg is not None
    assert pg.sqlstate == "P0001"
    assert pg.detail == "AI_MODEL_CONTRACT_IMMUTABLE"
    assert pg.constraint == "chk_algo"
    assert pg.table == "models"
    assert pg.schema == "ai"
    assert pg.es_error_de_negocio
    assert pg.tiene_codigo_interno


def test_04_extrae_atravesando_el_envoltorio_de_sqlalchemy() -> None:
    """LA FORMA REAL DEL STACK. `e.orig` no tiene `detail`; su causa sí.

    Si el extractor leyera solo `e.orig`, el código interno se perdería y todo
    error de negocio saldría como 500.
    """
    raiz = _FalsoAsyncpg(
        "Mensaje humano", sqlstate="P0001", detail="AI_VERSION_TRANSITION_INVALID"
    )
    dialecto = _FalsoDialecto("envoltorio", sqlstate="P0001")
    dialecto.__cause__ = raiz
    externo = _FalsoSQLAlchemy("(sqlalchemy)", orig=dialecto)
    externo.__cause__ = dialecto

    pg = extract_pg_error(externo)
    assert pg is not None
    assert pg.detail == "AI_VERSION_TRANSITION_INVALID"
    assert pg.sqlstate == "P0001"


def test_05_compone_campos_de_capas_distintas() -> None:
    """Los campos se recogen por separado, no de una sola excepción.

    Si una capa expone `sqlstate` y otra `detail`, se toman de donde estén. Es lo
    que hace al extractor indiferente a cómo reparta los datos una versión futura.
    """
    raiz = _FalsoAsyncpg("humano", detail="AI_ARCHITECTURE_IN_USE")  # sin sqlstate
    externo = _FalsoDialecto("envoltorio", sqlstate="P0001")        # sin detail
    externo.__cause__ = raiz

    pg = extract_pg_error(externo)
    assert pg is not None
    assert pg.sqlstate == "P0001"
    assert pg.detail == "AI_ARCHITECTURE_IN_USE"


def test_06_devuelve_none_si_no_es_error_de_postgres() -> None:
    """Distinguir «la base rechazó esto» de «algo se rompió».

    Confundirlos convertiría una conexión caída en un 409 engañoso que nadie
    investigaría.
    """
    assert extract_pg_error(TimeoutError("se cayó la red")) is None
    assert extract_pg_error(ValueError("un bug nuestro")) is None
    # Con detail pero sin sqlstate tampoco: no viene del servidor.
    assert extract_pg_error(_FalsoAsyncpg("x", detail="ALGO")) is None


def test_07_sobrevive_a_una_cadena_circular() -> None:
    """Una cadena con ciclo no debe colgar el proceso."""
    a = _FalsoAsyncpg("a", sqlstate="P0001", detail="AI_CLASS_INACTIVE")
    b = _FalsoDialecto("b", sqlstate="P0001")
    a.__cause__ = b
    b.__cause__ = a

    pg = extract_pg_error(a)
    assert pg is not None
    assert pg.detail == "AI_CLASS_INACTIVE"


def test_08_ignora_cadenas_vacias() -> None:
    """Un `''` de una capa no debe tapar el valor real de otra más abajo."""
    raiz = _FalsoAsyncpg("humano", sqlstate="P0001", detail="AI_ARCHITECTURE_IN_USE")
    externo = _FalsoAsyncpg("envoltorio", sqlstate="P0001", detail="")
    externo.__cause__ = raiz

    pg = extract_pg_error(externo)
    assert pg is not None
    assert pg.detail == "AI_ARCHITECTURE_IN_USE"


def test_09_sigue_el_contexto_implicito() -> None:
    """`__context__`, no solo `__cause__`.

    Un `raise` dentro de un `except` sin `from` encadena por contexto. Perder ese
    caso dejaría sin traducir errores lanzados desde bloques de manejo.
    """
    raiz = _FalsoAsyncpg("humano", sqlstate="23505", constraint_name="uq_mv_publicada")
    externo = RuntimeError("otra cosa")
    externo.__context__ = raiz

    pg = extract_pg_error(externo)
    assert pg is not None
    assert pg.constraint == "uq_mv_publicada"


def test_10_p0001_es_el_unico_codigo_de_negocio() -> None:
    """P0002-P0004 tienen semántica propia de PL/pgSQL y no son reglas nuestras."""
    assert PgError(sqlstate="P0001").es_error_de_negocio
    for otro in ("P0002", "P0003", "P0004", "23505", "42501"):
        assert not PgError(sqlstate=otro).es_error_de_negocio


# ══ 11-16 · La traducción a errores de dominio ═════════════════════════════
@pytest.mark.parametrize(
    ("codigo", "esperado", "status"),
    [
        ("AI_MODEL_CONTRACT_IMMUTABLE", ModelContractImmutableError, 409),
        ("AI_VERSION_TRANSITION_INVALID", VersionTransitionError, 409),
        ("AI_ARCHITECTURE_IN_USE", ArchitectureInUseError, 409),
        ("AI_ARCHITECTURE_FRAMEWORK_IMMUTABLE", ArchitectureInUseError, 409),
        ("AI_CROSS_PROJECT_REFERENCE", CrossProjectReferenceError, 422),
    ],
)
def test_11_traduce_por_codigo_interno(
    codigo: str, esperado: type[Exception], status: int
) -> None:
    exc = _FalsoAsyncpg("mensaje del trigger", sqlstate="P0001", detail=codigo)
    err = translate_pg_error(exc)
    assert isinstance(err, esperado)
    assert err.http_status == status


def test_12_las_capacidades_son_422_no_409() -> None:
    """No es conflicto de estado: es una combinación que el catálogo no admite."""
    exc = _FalsoAsyncpg(
        "no soporta la tarea", sqlstate="P0001", detail="AI_ARCHITECTURE_TASK_UNSUPPORTED"
    )
    err = translate_pg_error(exc)
    assert err is not None
    assert err.http_status == 422


def test_13_traduce_por_nombre_de_constraint() -> None:
    """Cuando el `DETAIL` lo genera PostgreSQL y no lo controlamos.

    Una violación de unicidad no lleva nuestro código, pero el nombre del
    constraint SÍ es nuestro y está escrito en la migración.
    """
    exc = _FalsoAsyncpg(
        "duplicate key", sqlstate="23505", constraint_name="uq_mv_publicada"
    )
    err = translate_pg_error(exc)
    assert isinstance(err, VersionTransitionError)


def test_14_el_codigo_interno_manda_sobre_el_constraint() -> None:
    """El `DETAIL` expresa intención; el nombre del constraint es implementación.

    Si un día se renombra un índice al reorganizarlos, el despacho no debe cambiar.
    """
    exc = _FalsoAsyncpg(
        "x",
        sqlstate="P0001",
        detail="AI_MODEL_CONTRACT_IMMUTABLE",
        constraint_name="uq_mc_indice",   # apuntaría a ClassIndexConflictError
    )
    err = translate_pg_error(exc)
    assert isinstance(err, ModelContractImmutableError)
    assert not isinstance(err, ClassIndexConflictError)


def test_15_un_codigo_desconocido_no_se_traduce() -> None:
    """`None`, para que salga como 500.

    Devolver un 409 genérico ante un código desconocido convertiría un fallo real
    en algo que parece una regla de negocio y que nadie investigaría.
    """
    exc = _FalsoAsyncpg("x", sqlstate="P0001", detail="AI_CODIGO_QUE_NO_EXISTE")
    assert translate_pg_error(exc) is None


async def test_16b_contra_el_stack_real(cfg_real: object) -> None:
    """LA PRUEBA QUE CIERRA EL HUECO DE LAS OTRAS DIECISÉIS.

    Las demás usan excepciones fabricadas a mano, así que demuestran que el
    extractor maneja las formas que YO CREO que produce SQLAlchemy. Esta demuestra
    que maneja la que produce DE VERDAD.

    Sin ella, una actualización de SQLAlchemy que moviera `detail` a otro sitio
    dejaría las dieciséis en verde y el mapeo roto en producción: los dobles de
    prueba seguirían teniendo la forma antigua.

    Provoca un error real —una transición de estado inválida— a través de la misma
    capa que usa la aplicación, y comprueba que el código interno llega intacto.
    """
    from sqlalchemy import text as sa_text
    from sqlalchemy.exc import DBAPIError

    from olo.db.session import unscoped_session

    with pytest.raises(DBAPIError) as capturada:
        async with unscoped_session() as s:
            await s.execute(
                sa_text(
                    "DO $$ BEGIN RAISE EXCEPTION 'mensaje del trigger' "
                    "USING ERRCODE='P0001', DETAIL='AI_MODEL_CONTRACT_IMMUTABLE'; END $$;"
                )
            )

    pg = extract_pg_error(capturada.value)
    assert pg is not None, "el extractor no reconoció un error real de PostgreSQL"
    assert pg.sqlstate == "P0001"
    assert pg.detail == "AI_MODEL_CONTRACT_IMMUTABLE", (
        "el codigo interno no sobrevivio al envoltorio de SQLAlchemy. "
        "Si esta prueba falla tras actualizar SQLAlchemy, el sitio a arreglar es "
        "olo/db/pg_errors.py y NADA MAS: es el unico acoplado al driver."
    )

    err = translate_pg_error(capturada.value)
    assert isinstance(err, ModelContractImmutableError)
    assert err.http_status == 409


def test_16_no_filtra_el_mensaje_del_motor_ni_el_esquema() -> None:
    """El mensaje del trigger nombra tablas y constraints: no puede salir al cliente.

    Es la comprobación de que un error de negocio no revela la forma del esquema.
    """
    exc = _FalsoAsyncpg(
        'relation "ai.model_versions" violates check constraint "chk_mv_marcas" '
        "en la columna deprecated_at",
        sqlstate="P0001",
        detail="AI_MODEL_CONTRACT_IMMUTABLE",
        table_name="model_versions",
        schema_name="ai",
        constraint_name="chk_mv_marcas",
    )
    err = translate_pg_error(exc)
    assert isinstance(err, ConflictError)

    texto = f"{err.message} {err.details}"
    for filtracion in ("chk_mv_marcas", "model_versions", "deprecated_at", "relation"):
        assert filtracion not in texto, (
            f"el mensaje devuelto al cliente contiene {filtracion!r}: "
            "filtra la forma del esquema"
        )
