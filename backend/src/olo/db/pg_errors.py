"""Extracción de campos estructurados de un error de PostgreSQL.

PUNTO ÚNICO DE ACOPLAMIENTO CON LOS INTERNOS DEL DRIVER. Nada más en el proyecto
debe tocar `.orig`, `.__cause__` ni `.sqlstate`.

MEDIDO, no supuesto. Se comprobó contra este stack qué expone cada capa:

    asyncpg directo      sqlstate='P0001'  detail='AI_MODEL_CONTRACT_IMMUTABLE'  ✓
    SQLAlchemy e.orig    sqlstate='P0001'  detail=(ausente)      ← LO PIERDE
    e.orig.__cause__     sqlstate='P0001'  detail='AI_MODEL…'    ✓

Es decir: `DETAIL` **solo** está en la excepción original de asyncpg, y llegar a
ella exige recorrer la cadena de causas. Eso es un detalle de implementación del
dialecto asyncpg de SQLAlchemy, no una garantía de su contrato público: si una
versión futura coloca los campos en otro sitio, este archivo es el único que hay
que cambiar.

Por eso el extractor NO asume ninguna forma concreta. Recorre la cadena y toma el
primer valor no nulo de cada campo por separado — así funciona igual con asyncpg
crudo, con SQLAlchemy encima, y con cualquier capa futura que envuelva a las dos,
mientras alguna de ellas siga exponiendo los atributos.
"""

from __future__ import annotations

from dataclasses import dataclass

# Los atributos que asyncpg expone y que nos interesan, con el nombre que tienen
# en `PgError`. Se declaran como datos y no como accesos directos para que añadir
# un campo sea una línea.
_CAMPOS: tuple[tuple[str, str], ...] = (
    ("sqlstate", "sqlstate"),
    ("detail", "detail"),
    ("constraint_name", "constraint"),
    ("message", "message"),
    ("table_name", "table"),
    ("schema_name", "schema"),
    ("hint", "hint"),
)

# Cota de seguridad: una cadena de causas circular o absurdamente larga no debe
# colgar el proceso. Seis niveles cubren asyncpg → dialecto → SQLAlchemy con
# margen de sobra.
_PROFUNDIDAD_MAXIMA = 8


@dataclass(frozen=True, slots=True)
class PgError:
    """Lo que un error de PostgreSQL dice, en campos estables.

    `detail` es el CÓDIGO INTERNO del proyecto —`AI_MODEL_CONTRACT_IMMUTABLE` y
    similares—, no una descripción. Es el único campo apto para decidir qué
    respuesta HTTP corresponde.

    `message` está aquí para poder registrarlo, NUNCA para despachar sobre él: es
    texto pensado para una persona y se reescribe sin previo aviso.
    """

    sqlstate: str | None = None
    detail: str | None = None
    constraint: str | None = None
    message: str | None = None
    table: str | None = None
    schema: str | None = None
    hint: str | None = None

    @property
    def es_error_de_negocio(self) -> bool:
        """`P0001` es el `RAISE EXCEPTION` de PL/pgSQL sin condición propia.

        Es el que usan nuestros triggers para los errores de negocio. P0002, P0003
        y P0004 quedan deliberadamente fuera: PL/pgSQL ya les da semántica propia
        —NO_DATA_FOUND, TOO_MANY_ROWS, ASSERT_FAILURE— y confundirlos con reglas de
        negocio haría que un fallo del lenguaje pareciera una regla del dominio.
        """
        return self.sqlstate == "P0001"

    @property
    def tiene_codigo_interno(self) -> bool:
        return bool(self.detail)


def _cadena(exc: BaseException) -> list[BaseException]:
    """La excepción y todo lo que la causó, sin repetir ni ciclar.

    Se sigue `__cause__` (el `raise ... from ...` explícito), `__context__` (el
    implícito) y `.orig`, que es como SQLAlchemy guarda el error del DBAPI. Los
    tres, porque cuál de ellos lleva los datos depende de la capa y no queremos
    depender de esa respuesta.
    """
    vistos: list[BaseException] = []
    ids: set[int] = set()
    pendientes: list[BaseException] = [exc]

    while pendientes and len(vistos) < _PROFUNDIDAD_MAXIMA:
        actual = pendientes.pop(0)
        if actual is None or id(actual) in ids:
            continue
        ids.add(id(actual))
        vistos.append(actual)

        for siguiente in (
            getattr(actual, "orig", None),
            actual.__cause__,
            actual.__context__,
        ):
            if isinstance(siguiente, BaseException) and id(siguiente) not in ids:
                pendientes.append(siguiente)

    return vistos


def extract_pg_error(exc: BaseException) -> PgError | None:
    """Campos estructurados de un error de PostgreSQL, o `None` si no lo es.

    Devuelve `None` cuando la excepción no viene de PostgreSQL —un `TimeoutError`
    de red, un fallo de serialización— para que quien llama pueda distinguir «la
    base rechazó esto por una regla» de «algo se rompió». Confundirlos convertiría
    un problema de infraestructura en un 409 engañoso.

    Los campos se recogen de forma INDEPENDIENTE: si una capa expone `sqlstate` y
    otra `detail`, se toman de donde estén. No se asume que una sola excepción de
    la cadena tenga todo.
    """
    encontrados: dict[str, str] = {}

    for actual in _cadena(exc):
        for atributo, campo in _CAMPOS:
            if campo in encontrados:
                continue
            valor = getattr(actual, atributo, None)
            # asyncpg usa cadenas; se descarta lo vacío para que un '' no tape un
            # valor real que esté más abajo en la cadena.
            if isinstance(valor, str) and valor:
                encontrados[campo] = valor

    if not encontrados.get("sqlstate"):
        # Sin SQLSTATE no es un error del servidor de PostgreSQL. Puede ser un
        # fallo de conexión, un timeout o un error de nuestro propio código.
        return None

    return PgError(**encontrados)
