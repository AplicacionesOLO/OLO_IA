"""Traducción de códigos internos de PostgreSQL a errores de dominio.

DOS PIEZAS SEPARADAS A PROPÓSITO:

  · `olo.db.pg_errors.extract_pg_error()` es MECÁNICO. Saca campos de una
    excepción y no sabe nada del dominio. Es el único sitio acoplado a los
    internos de SQLAlchemy y asyncpg.
  · este módulo es POLÍTICA. Decide qué código interno corresponde a qué error de
    dominio y, por tanto, a qué respuesta HTTP.

Separarlas permite cambiar el driver sin tocar la política, y añadir una regla de
negocio sin tocar el driver.

EXHAUSTIVIDAD. `tests/test_pg_error_extraction.py` lee los archivos de
`supabase/migrations/`, extrae cada literal `DETAIL = '...'` y falla si alguno no
está en `_REGISTRO`. Es la única forma de que el mapa esté demostrablemente
completo: mantenerlo a mano garantiza que algún día un trigger emita un código que
nadie tradujo, y eso sale como 500.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from olo.core.errors import (
    ArchitectureCapabilityError,
    ArchitectureInUseError,
    ClassInactiveError,
    ClassIndexConflictError,
    CrossProjectReferenceError,
    ModelContractImmutableError,
    ModelVocabularyFrozenError,
    NotFoundError,
    OloError,
    SpatialCodeInconsistentError,
    SpatialExternalCodeConflictError,
    SpatialHierarchyError,
    VersionTransitionError,
)
from olo.core.logging import get_logger
from olo.db.pg_errors import extract_pg_error

if TYPE_CHECKING:
    from olo.db.pg_errors import PgError

_log = get_logger(__name__)


# ── El registro ────────────────────────────────────────────────────────────
#
# Código interno (el DETAIL que emite el trigger) → clase de error de dominio.
_REGISTRO: dict[str, type[OloError]] = {
    # Contrato del modelo (migración 0042)
    "AI_MODEL_CONTRACT_IMMUTABLE": ModelContractImmutableError,
    # Catálogo de capacidades (0042)
    "AI_ARCHITECTURE_NOT_FOUND": NotFoundError,
    "AI_ARCHITECTURE_INACTIVE": ArchitectureCapabilityError,
    "AI_ARCHITECTURE_TASK_UNSUPPORTED": ArchitectureCapabilityError,
    "AI_ARCHITECTURE_INPUT_UNSUPPORTED": ArchitectureCapabilityError,
    "AI_ARCHITECTURE_FRAMEWORK_IMMUTABLE": ArchitectureInUseError,
    "AI_ARCHITECTURE_IN_USE": ArchitectureInUseError,
    "AI_ARCHITECTURE_TASK_IN_USE": ArchitectureInUseError,
    "AI_ARCHITECTURE_INPUT_IN_USE": ArchitectureInUseError,
    # Ciclo de vida de versiones (0043)
    "AI_VERSION_TRANSITION_INVALID": VersionTransitionError,
    # Vocabulario y clases — los triggers de 0026 y 0039 pasarán a emitir estos
    # códigos en el Bloque 1; el registro los espera ya para que la prueba de
    # exhaustividad no sea la que los descubra.
    "AI_MODEL_VOCABULARY_FROZEN": ModelVocabularyFrozenError,
    "AI_CLASS_INDEX_CONFLICT": ClassIndexConflictError,
    "AI_CLASS_INACTIVE": ClassInactiveError,
    "AI_CROSS_PROJECT_REFERENCE": CrossProjectReferenceError,
    # Jerarquía espacial (migración 0050). Los emite core.spatial_node_guard().
    #
    # Son 422 y no 409: el árbol no está en un estado conflictivo, es la petición la
    # que describe una jerarquía imposible. Un 409 invitaría al cliente a reintentar
    # esperando que el servidor cambie, y no va a cambiar.
    "SPATIAL_NODE_EDGE_INVALID": SpatialHierarchyError,
    "SPATIAL_NODE_CYCLE": SpatialHierarchyError,
    # Coherencia del direccionamiento (migración 0055).
    "SPATIAL_CODE_INCONSISTENT": SpatialCodeInconsistentError,
    "SPATIAL_BAY_INDEX_MISMATCH": SpatialCodeInconsistentError,
    "SPATIAL_LOCATION_PARENT_INVALID": SpatialHierarchyError,
    # `SPATIAL_EXTERNAL_CODE_CONFLICT` NO va aquí: ese conflicto lo detecta un
    # índice único, que produce `unique_violation` con nombre de constraint y no un
    # `DETAIL`. Vive en `_CONSTRAINTS`, unas líneas más abajo. Lo descubrió la
    # prueba de códigos muertos: registrarlo aquí lo dejaba sin emisor.
}

# Constraints del motor cuyo nombre identifica una regla de negocio sin que haya
# un trigger de por medio. Aquí el `DETAIL` lo genera PostgreSQL y no lo
# controlamos, así que se despacha por el NOMBRE DEL CONSTRAINT — que sí es
# nuestro y sí es estable, porque está escrito en la migración.
_CONSTRAINTS: dict[str, type[OloError]] = {
    "uq_mv_publicada": VersionTransitionError,
    "uq_mc_indice": ClassIndexConflictError,
    "uq_class_indice": ClassIndexConflictError,
    "fk_mc_class": CrossProjectReferenceError,
    "fk_mc_model": CrossProjectReferenceError,
    "fk_ann_class": CrossProjectReferenceError,
    "fk_ann_image": CrossProjectReferenceError,
    "fk_img_asset": CrossProjectReferenceError,
    "fk_img_video": CrossProjectReferenceError,
    "fk_mv_model": CrossProjectReferenceError,
    "fk_mv_weights": CrossProjectReferenceError,
    "fk_dsi_image": CrossProjectReferenceError,
    "fk_dsi_version": CrossProjectReferenceError,
    # Espacial (0053, 0054). El motor detecta estos conflictos con un índice único,
    # así que el despacho es por NOMBRE DE CONSTRAINT: es nuestro y está escrito en
    # la migración, luego es estable.
    "uq_node_external": SpatialExternalCodeConflictError,
    "uq_loc_external_code": SpatialExternalCodeConflictError,
    "uq_node_indice_en_padre": SpatialCodeInconsistentError,
    "uq_loc_direccion": SpatialCodeInconsistentError,
}


def codigos_registrados() -> frozenset[str]:
    """Para la prueba de exhaustividad. No usar en la ruta de la petición."""
    return frozenset(_REGISTRO)


def translate_pg_error(exc: BaseException) -> OloError | None:
    """Convierte un error de PostgreSQL en un error de dominio, o devuelve `None`.

    `None` significa «no lo reconozco», y quien llama debe dejarlo propagar como
    500. Es deliberado: tragarse un error desconocido y devolver un 409 genérico
    convertiría un fallo real —una conexión caída, un bug— en algo que parece una
    regla de negocio y que nadie investigaría.

    El mensaje del error de dominio NO se toma del `MESSAGE` de PostgreSQL. Los
    mensajes de los triggers están pensados para quien depura y pueden nombrar
    tablas, columnas y constraints; devolverlos al cliente filtraría la forma del
    esquema. Se registra en el log y se responde con el mensaje de la clase.
    """
    pg = extract_pg_error(exc)
    if pg is None:
        return None

    clase = _resolver(pg)
    if clase is None:
        # Se registra con detalle: es lo que permite añadir el código que falte en
        # lugar de descubrirlo por un 500 sin contexto.
        _log.error(
            "codigo de error de postgres sin traducir",
            extra={
                "sqlstate": pg.sqlstate,
                "detail": pg.detail,
                "constraint": pg.constraint,
                "pg_table": pg.table,
            },
        )
        return None

    _log.info(
        "error de negocio del motor traducido",
        extra={
            "sqlstate": pg.sqlstate,
            "codigo_interno": pg.detail,
            "constraint": pg.constraint,
            # El mensaje humano del trigger va al log, NUNCA a la respuesta.
            "mensaje_motor": pg.message,
        },
    )
    return clase(details_pg=pg.detail or pg.constraint)


def _resolver(pg: PgError) -> type[OloError] | None:
    """Código interno primero, nombre de constraint después.

    Ese orden importa: el `DETAIL` lo escribimos nosotros y expresa la intención;
    el nombre del constraint es un accidente de implementación que podría cambiar
    al reorganizar índices. Si ambos están, manda el explícito.
    """
    if pg.detail and pg.detail in _REGISTRO:
        return _REGISTRO[pg.detail]

    if pg.constraint and pg.constraint in _CONSTRAINTS:
        return _CONSTRAINTS[pg.constraint]

    return None
