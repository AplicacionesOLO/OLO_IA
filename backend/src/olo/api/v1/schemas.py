"""Esquemas de petición y respuesta.

Solo estructura y validación de forma: las reglas de negocio están en el
dominio y en la base. Estos modelos existen para rechazar entrada malformada
antes de que llegue a la lógica.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


# ── Envoltorios ───────────────────────────────────────────────────────────
class Envelope[T](ApiModel):
    data: T


class PageMeta(ApiModel):
    """Metadatos de página con LAS DOS formas de paginar a la vez.

    `next_cursor` es la correcta para recorrer: su coste no crece con la
    profundidad. `page` / `total` / `total_pages` existen porque una tabla con
    «página 7 de 294» necesita saber cuántas hay, y eso un cursor no lo dice.

    Los tres campos numéricos son OPCIONALES: `total` obliga a un `count`, y en
    una navegación por cursor sobre 29.310 ubicaciones contarlas en cada página
    es trabajo que nadie pidió. El endpoint los rellena solo cuando el cliente
    los pide con `with_total=true`; si no, valen `None` y el cliente sabe que no
    se contó, en lugar de recibir un cero que parecería «no hay nada».
    """

    next_cursor: str | None = None
    page_size: int
    page: int | None = None
    total: int | None = None
    total_pages: int | None = None


class PagedEnvelope[T](ApiModel):
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

# ── Spatial ───────────────────────────────────────────────────────────────
#
# Estos modelos son planos a propósito: el frontend NO debe parsear `full_code`
# para saber el nivel ni la posición, así que cada componente viaja como campo
# propio (ADR-013). Un cliente que tenga que hacer `code.split('-')` es un
# cliente al que le hemos pasado nuestro problema.


class WarehouseSpatialSummaryOut(ApiModel):
    """KPIs de un almacén. Refleja `spatial.warehouse_summary` de 0059.

    No hay `occupied_count`: la ocupación es del inventario, no del estante
    (SPA-11, y R3 del ADR-009). Lo que sí hay es el histograma completo del
    vocabulario del WMS y el número de contradicciones entre sus dos columnas
    de estado, que es el dato que hay que mirar antes de fiarse de cualquiera.
    """

    warehouse_id: UUID
    warehouse_code: str
    warehouse_name: str
    site_count: int
    aisle_count: int
    rack_count: int
    bay_count: int
    location_count: int
    available_count: int
    blocked_count: int
    inferred_count: int
    opaque_count: int
    wms_situation_counts: dict[str, int]
    status_situation_conflicts: int
    capacity_unlimited_count: int
    capacity_unknown_count: int
    with_world_geometry: int
    last_import_at: datetime | None
    total_rows_rejected: int | None


class SpatialNodeOut(ApiModel):
    """Un nodo del árbol. `child_count` evita una petición por nodo solo para
    saber si se puede expandir."""

    node_id: UUID
    parent_node_id: UUID | None
    node_type: str
    node_function: str | None
    function_label: str | None
    node_code: str
    external_code: str | None
    name: str | None
    logical_index: int | None
    site_id: UUID | None
    can_hold_locations: bool
    child_count: int
    location_count: int


class SpatialTreeNodeOut(SpatialNodeOut):
    """Igual que `SpatialNodeOut` más la profundidad, para que el cliente
    dibuje la indentación sin recalcular el camino."""

    depth: int


class FloorPlanCellOut(ApiModel):
    """Una fila por rack: 347 en lugar de 29.310.

    `available_count` + `blocked_count` = `location_count`, siempre. Es una
    partición real y la migración 0059 lo verifica sobre datos reales.
    """

    rack_id: UUID
    rack_code: str
    rack_external_code: str | None
    rack_index: int | None
    rack_node_type: str
    node_function: str | None
    function_label: str | None
    aisle_id: UUID | None
    aisle_code: str | None
    site_id: UUID | None
    bay_count: int
    location_count: int
    available_count: int
    blocked_count: int
    inferred_count: int
    bulk_count: int
    wms_situation_counts: dict[str, int]
    status_situation_conflicts: int
    min_logical_x: int | None
    max_logical_x: int | None
    min_logical_y: int | None
    max_logical_y: int | None
    max_level: int | None


class RackFrontCellOut(ApiModel):
    """Un hueco del alzado: cuerpo x nivel x posición, ya descompuesto."""

    location_id: UUID
    bay_id: UUID
    bay_code: str
    bay_index: int
    level: int | None
    position: int | None
    full_code: str
    external_code: str | None
    location_status: str
    location_situation: str | None
    is_bulk_area: bool
    origin: str
    max_weight_kg: float | None
    max_units: int | None


class RackFrontViewOut(ApiModel):
    """El alzado completo de un rack, con sus dimensiones ya calculadas.

    `bay_count`, `max_level` y `max_position` van en la respuesta para que el
    cliente dimensione la rejilla antes de recorrer las celdas, en lugar de
    tener que hacer un `max()` sobre ellas.
    """

    rack_id: UUID
    rack_code: str
    rack_external_code: str | None
    node_function: str | None
    function_label: str | None
    bay_count: int
    max_level: int | None
    max_position: int | None
    cells: list[RackFrontCellOut]


class LocationOut(ApiModel):
    """Contrato plano de una ubicación. CERO parseo en el cliente.

    `capacity_declared_unlimited` distingue «el WMS dijo ilimitado» (26.244
    ubicaciones del catálogo real) de «el WMS no dijo nada» (727). Antes de la
    migración 0058 ambas eran el mismo `max_weight_kg IS NULL`.
    """

    location_id: UUID
    warehouse_id: UUID
    warehouse_code: str
    site_id: UUID | None
    site_code: str | None
    aisle_id: UUID | None
    aisle_code: str | None
    rack_id: UUID | None
    rack_code: str | None
    rack_external_code: str | None
    rack_index: int | None
    bay_id: UUID | None
    bay_code: str | None
    bay_index: int | None
    level: int | None
    position: int | None
    # `logical_column` es atributo de la UBICACION; `bay_index` es el indice del
    # CUERPO padre. Coinciden en las 29.310 filas importadas porque el importador
    # usa el mismo valor, pero no son el mismo campo: una ubicacion colgada de un
    # rack sin cuerpo tiene columna y no tiene `bay_index`.
    logical_column: int | None
    full_code: str
    external_code: str | None
    external_location_id: str | None
    code_form: str
    location_type: str
    location_status: str
    location_situation: str | None
    is_bulk_area: bool
    origin: str
    max_weight_kg: float | None
    max_units: int | None
    capacity_declared_unlimited: bool
    node_function: str | None
    function_label: str | None
    implies_bulk: bool | None
    logical_x: int | None
    logical_y: int | None
    logical_z: int | None
