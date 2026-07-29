"""Esquemas de petición y respuesta.

Solo estructura y validación de forma: las reglas de negocio están en el
dominio y en la base. Estos modelos existen para rechazar entrada malformada
antes de que llegue a la lógica.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

T = TypeVar("T")


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


# ── Envoltorios ───────────────────────────────────────────────────────────
class Envelope(ApiModel, Generic[T]):
    data: T


class PageMeta(ApiModel):
    next_cursor: str | None = None
    page_size: int


class PagedEnvelope(ApiModel, Generic[T]):
    data: list[T]
    pagination: PageMeta


# ── Warehouse ─────────────────────────────────────────────────────────────
class WarehouseOut(ApiModel):
    id: UUID
    company_id: UUID
    name: str
    code: str
    status: str
    timezone: str
    locale: str
    currency_code: str | None
    latitude: float | None
    longitude: float | None
    address: dict[str, Any] | None
    version: int
    created_at: datetime
    updated_at: datetime

    # `tenant_id` NO se expone: el cliente ya opera dentro de un solo tenant y
    # devolverlo solo añadiría un identificador que no necesita.


class WarehouseCreate(ApiModel):
    company_id: UUID
    name: Annotated[str, Field(min_length=2, max_length=200)]
    code: Annotated[str, Field(min_length=2, max_length=20, pattern=r"^[A-Za-z0-9][A-Za-z0-9-]*$")]
    timezone: Annotated[str, Field(min_length=3, max_length=50)]
    locale: Annotated[str, Field(pattern=r"^[a-z]{2}(-[A-Z]{2})?$")] = "es"
    currency_code: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None = None
    latitude: Annotated[float, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180)] | None = None
    address: dict[str, Any] | None = None

    @field_validator("code")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("timezone")
    @classmethod
    def _plausible_timezone(cls, v: str) -> str:
        """Valida el timezone contra la base de datos de zonas de Python.

        La base no puede hacerlo: la única fuente fiable en PostgreSQL es
        `pg_timezone_names`, que es una vista no inmutable y por tanto
        inadmisible en un CHECK. Por eso la validación es responsabilidad de
        esta capa.
        """
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
            msg = f"Zona horaria desconocida: {v!r}"
            raise ValueError(msg) from exc
        return v


# ── Identidad ─────────────────────────────────────────────────────────────
class TenantOut(ApiModel):
    id: UUID
    name: str
    slug: str
    status: str
    plan: str


class RoleAssignmentOut(ApiModel):
    name: str
    scope_type: str
    scope_company_id: UUID | None = None
    scope_warehouse_id: UUID | None = None


class MeOut(ApiModel):
    id: UUID
    email: str
    first_name: str
    last_name: str
    locale: str
    timezone: str
    status: str
    tenant: TenantOut
    roles: list[RoleAssignmentOut]
    permissions: list[str]
    accessible_warehouse_ids: list[UUID]
    tenant_wide_access: bool

    is_platform_owner: bool = False
    """Administración de plataforma, por encima de los tenants.

    Se resuelve contra la base en cada petición, NO desde el JWT: revocar el
    privilegio más potente del sistema debe surtir efecto de inmediato, no en
    hasta una hora.

    Cuando es `true`, `permissions` incluye además los permisos de alcance
    plataforma. El cliente no necesita saber de dónde vienen: sigue ocultando por
    permiso, igual que con los de tenant.
    """


class PlatformOwnerOut(ApiModel):
    """Un Platform Owner. Solo visible para otros Platform Owners."""

    user_id: UUID
    email: str
    first_name: str
    last_name: str
    granted_at: datetime
    granted_by_email: str | None
    revoked_at: datetime | None
    reason: str


class WarehouseUpdate(ApiModel):
    """Actualización parcial. Solo los campos presentes se modifican.

    `code` y `company_id` NO son actualizables: cambiar el código rompe las
    referencias operativas que el personal de almacén usa a diario, y mover un
    almacén de compañía es una operación de reestructuración, no una edición.
    """

    name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    status: Literal["active", "inactive", "maintenance"] | None = None
    timezone: Annotated[str, Field(min_length=3, max_length=50)] | None = None
    locale: Annotated[str, Field(pattern=r"^[a-z]{2}(-[A-Z]{2})?$")] | None = None
    currency_code: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None = None
    latitude: Annotated[float, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180)] | None = None
    address: dict[str, Any] | None = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
            msg = f"Zona horaria desconocida: {v!r}"
            raise ValueError(msg) from exc
        return v

    def changes(self) -> dict[str, Any]:
        """Solo los campos que el cliente envió realmente.

        `exclude_unset` distingue "no lo mandé" de "lo mandé como null", que en
        una actualización parcial son cosas distintas.
        """
        return self.model_dump(exclude_unset=True)


# ── Autenticación ─────────────────────────────────────────────────────────
class LoginRequest(ApiModel):
    """Credenciales de acceso.

    `password` NO lleva longitud mínima de política, a propósito. La política de
    contraseñas se aplica al crearlas y cambiarlas, no al usarlas: en el login,
    una contraseña demasiado corta es simplemente incorrecta.

    Tenerla aquí producía dos defectos reales, ambos medidos:
      • una cuenta cuya contraseña es más corta que la política vigente —porque
        se creó antes, o porque el mínimo de GoTrue es menor— no podía entrar por
        este endpoint aunque sus credenciales son válidas. Devolvía 400
        VALIDATION_ERROR en lugar de autenticar;
      • el 400 revela el mínimo exigido antes de comprobar nada.

    El único límite que queda es el superior, y no es política sino protección:
    evita que se hashee una entrada arbitrariamente grande. La validez la decide
    el proveedor de identidad, y su respuesta es 401 INVALID_CREDENTIALS.
    """

    email: Annotated[str, Field(min_length=5, max_length=320)]
    password: Annotated[str, Field(min_length=1, max_length=200)]


class RefreshRequest(ApiModel):
    refresh_token: Annotated[str, Field(min_length=10)]


class TokenOut(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    expires_at: int