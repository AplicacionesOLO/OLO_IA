"""Errores de dominio y su correspondencia con códigos HTTP.

La capa de dominio lanza estas excepciones; la capa de API las traduce. El
dominio no conoce HTTP.
"""

from __future__ import annotations

from typing import Any


class OloError(Exception):
    """Base de todos los errores propios."""

    code: str = "INTERNAL_ERROR"
    http_status: int = 500
    message: str = "Unexpected error"

    def __init__(self, message: str | None = None, **details: Any) -> None:
        self.message = message or self.message
        self.details: dict[str, Any] = details
        super().__init__(self.message)


# ── 4xx de autenticación y autorización ───────────────────────────────────
class UnauthenticatedError(OloError):
    code = "UNAUTHENTICATED"
    http_status = 401
    message = "Authentication required"


class InvalidTokenError(UnauthenticatedError):
    code = "INVALID_TOKEN"
    message = "Token is invalid or expired"


class NoActiveMembershipError(OloError):
    """El JWT es válido pero no trae tenant activo.

    Se responde 403 y NO 401: la identidad es correcta, lo que falta es la
    pertenencia. Un 401 haría que el cliente intentara refrescar el token en
    bucle sin resolver nada.
    """

    code = "NO_ACTIVE_MEMBERSHIP"
    http_status = 403
    message = "No active tenant membership for this identity"


class ForbiddenError(OloError):
    code = "FORBIDDEN"
    http_status = 403
    message = "Insufficient permissions"


class WarehouseNotAccessibleError(ForbiddenError):
    code = "WAREHOUSE_NOT_ACCESSIBLE"
    message = "The requested warehouse is not accessible for this user"


class NotPlatformOwnerError(ForbiddenError):
    """Zona de administración de plataforma, por encima de los tenants.

    Código propio y distinto de `FORBIDDEN` a propósito. La interfaz debe poder
    decir «esta zona es de administración de plataforma» en lugar de «te falta un
    permiso», que mandaría al usuario a pedírselo a un administrador de tenant
    que **no puede concederlo**: el privilegio no se otorga por rol, sino
    registrando al usuario en `platform.owners`.
    """

    code = "NOT_PLATFORM_OWNER"
    message = "This operation requires Platform Owner privileges"


# ── 4xx de recurso y estado ───────────────────────────────────────────────
class NotFoundError(OloError):
    """404 también cuando el recurso existe pero es de otro tenant.

    Devolver 403 confirmaría su existencia y sería una fuga por canal lateral.
    """

    code = "NOT_FOUND"
    http_status = 404
    message = "Resource not found"


class ConflictError(OloError):
    code = "CONFLICT"
    http_status = 409
    message = "Conflicting state"


class VersionConflictError(ConflictError):
    """Optimistic locking: la versión enviada no coincide con la almacenada."""

    code = "VERSION_CONFLICT"
    http_status = 412
    message = "Resource was modified by another operation"


class PreconditionRequiredError(OloError):
    code = "PRECONDITION_REQUIRED"
    http_status = 428
    message = "If-Match header is required for this operation"


class IdempotencyConflictError(ConflictError):
    """Misma Idempotency-Key con un cuerpo distinto."""

    code = "IDEMPOTENCY_KEY_REUSED"
    message = "Idempotency-Key was already used with a different payload"


class BusinessRuleError(OloError):
    code = "BUSINESS_RULE_VIOLATION"
    http_status = 422
    message = "Business rule violated"


class InsufficientStockError(BusinessRuleError):
    code = "INSUFFICIENT_STOCK"
    message = "Not enough stock for the requested operation"


class RateLimitedError(OloError):
    code = "RATE_LIMITED"
    http_status = 429
    message = "Too many requests"


# ── Errores del dominio de IA ─────────────────────────────────────────────
#
# Cada uno corresponde a un CÓDIGO INTERNO que un trigger emite en el `DETAIL` de
# su excepción. El mapa está en `olo.services.ai.errors`, y hay una prueba que lee
# los archivos de migración y falla si algún `DETAIL` emitido no tiene traducción:
# un código sin mapear es un 500 esperando a ocurrir.
#
# Van al final del archivo porque heredan de `ConflictError` y `BusinessRuleError`,
# que se definen arriba. Colocarlas junto a `NotPlatformOwnerError` —donde
# conceptualmente encajarían mejor— daba NameError al importar el módulo.
class ModelContractImmutableError(ConflictError):
    """Cambiar algo que los pesos ya registrados necesitan para interpretarse.

    409 y no 400: el valor enviado es válido, lo que choca es el ESTADO del
    recurso. Un 400 sugeriría corregir el valor, y la salida real es distinta
    —crear un modelo nuevo—, así que el código debe decirlo.
    """

    code = "AI_MODEL_CONTRACT_IMMUTABLE"
    http_status = 409
    message = "El modelo ya tiene versiones registradas: este campo es inmutable"


class ArchitectureInUseError(ConflictError):
    code = "AI_ARCHITECTURE_IN_USE"
    http_status = 409
    message = "La arquitectura está en uso por modelos existentes"


class ArchitectureCapabilityError(BusinessRuleError):
    """La arquitectura no soporta lo que se le pide.

    422 y no 409: no es un conflicto con el estado del recurso, es una combinación
    que el catálogo de capacidades no admite. La respuesta incluye qué SÍ soporta.
    """

    code = "AI_ARCHITECTURE_CAPABILITY"
    http_status = 422
    message = "La arquitectura no soporta la combinación solicitada"


class VersionTransitionError(ConflictError):
    code = "AI_VERSION_TRANSITION_INVALID"
    http_status = 409
    message = "Esa transición del ciclo de vida no está permitida"


class ModelVocabularyFrozenError(ConflictError):
    code = "AI_MODEL_VOCABULARY_FROZEN"
    http_status = 409
    message = "El modelo ya tiene versiones: su vocabulario de clases no puede cambiar"


class ClassIndexConflictError(ConflictError):
    code = "AI_CLASS_INDEX_CONFLICT"
    http_status = 409
    message = "El índice de clase ya está ocupado en este proyecto"


class ClassInactiveError(BusinessRuleError):
    code = "AI_CLASS_INACTIVE"
    http_status = 422
    message = "No se puede usar una clase desactivada"


class CrossProjectReferenceError(BusinessRuleError):
    """Una FK compuesta rechazó una referencia entre proyectos distintos.

    422: el identificador existe, pero no en este proyecto. Un 404 confundiría
    «no existe» con «no es tuyo», y aquí el llamante sí tiene acceso al proyecto.
    """

    code = "AI_CROSS_PROJECT_REFERENCE"
    http_status = 422
    message = "La entidad referenciada pertenece a otro proyecto"
