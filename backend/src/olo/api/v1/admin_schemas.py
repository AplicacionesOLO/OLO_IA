"""Contratos de la configuración del sistema.

Archivo aparte de `schemas.py` y de `ai_schemas.py` por el mismo motivo que aquel: un
cambio en la matriz de permisos y uno en un almacén no deben competir por el mismo
archivo.

Casi todo es de SOLO LECTURA. La única escritura es `PermissionToggleIn`, que es una
casilla de la matriz.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field

from olo.api.v1.schemas import ApiModel

#: `platform` no se puede asignar a un rol de tenant. Lo impone el trigger
#: `trg_role_permissions_scope_guard`, y la interfaz lo usa para saber qué casilla
#: puede ofrecer.
PermissionScope = Literal["platform", "tenant"]


class CountryOut(ApiModel):
    """Catálogo global. No pertenece a ningún tenant."""

    id: UUID
    iso_code: str
    iso_code_3: str | None
    numeric_code: str | None
    name_en: str
    name_es: str
    phone_code: str | None
    default_currency_code: str | None


class TenantCountryOut(ApiModel):
    """Presencia del operador en un país, con sus valores por omisión."""

    id: UUID
    country_id: UUID
    iso_code: str
    name_es: str
    status: str
    default_currency_code: str | None
    default_timezone: str | None


class CompanyOut(ApiModel):
    """Entidad legal del OPERADOR en un país.

    NO es un cliente. `core.warehouses.company_id` apunta aquí: un almacén pertenece a
    una entidad legal. Los dueños de la mercadería son `ClientOut`.
    """

    id: UUID
    name: str
    legal_name: str | None
    tax_id: str | None
    status: str
    country_name: str | None
    country_code: str | None
    warehouse_count: int
    client_count: int


class ClientOut(ApiModel):
    """Dueño de la mercadería almacenada (3PL): EPA, Cofersa.

    `spatial.*` NO tiene ninguna referencia a esto, y es deliberado: el catálogo
    espacial describe el edificio, que es del operador. La propiedad viaja con el
    pallet y la resuelve el WMS.
    """

    id: UUID
    code: str
    name: str
    legal_name: str | None
    tax_id: str | None
    status: str
    company_name: str


class WarehouseAdminOut(ApiModel):
    """Almacén con el recuento REAL de su catálogo espacial.

    `location_count` y `node_count` salen de `spatial.*`, no de columnas. Es lo que
    distingue un almacén operativo de una fila que solo existe: en este entorno hay 24
    residuos de pruebas de integración con cero ubicaciones.
    """

    id: UUID
    code: str
    name: str
    status: str
    company_name: str | None
    location_count: int
    node_count: int


class UserAdminOut(ApiModel):
    """Usuario con su membresía, sus roles y su privilegio de plataforma.

    `is_platform_owner` se resuelve contra `platform.owners` en cada lectura y **no
    viaja en el JWT**: revocarlo surte efecto en la petición siguiente sin refrescar
    el token. Se muestra porque es lo que explica por qué alguien ve el módulo de IA.
    """

    id: UUID
    email: str
    first_name: str | None
    last_name: str | None
    status: str
    is_platform_owner: bool
    warehouse_access_count: int
    role_names: list[str]
    membership_status: str | None


class RoleOut(ApiModel):
    """Rol con su padre resuelto y su recuento de permisos.

    `is_system` no bloquea la edición en el motor, pero cambiar los permisos de un rol
    de sistema altera el comportamiento del producto para todos los usuarios que lo
    tengan. La interfaz lo advierte.

    `parent_role_id` construye la jerarquía. `prevent_role_cycle()` impide los ciclos.
    """

    id: UUID
    name: str
    description: str | None
    is_system: bool
    #: `true` = rol global (`tenant_id IS NULL`), compartido por TODOS los tenants.
    #: Sus permisos son de solo lectura: la politica `rp_isolation` exige
    #: `tenant_id = current_tenant_id()` para escribir. La interfaz lo usa para no
    #: ofrecer casillas que van a fallar.
    is_global: bool
    parent_role_id: UUID | None
    parent_name: str | None
    permission_count: int


class PermissionOut(ApiModel):
    """Un permiso del catálogo del producto.

    `module` es lo que agrupa la matriz en carpetas. `scope` es lo que decide si una
    casilla existe: con `platform`, ninguna casilla de un rol de tenant es marcable.
    """

    code: str
    module: str
    action: str
    description: str
    is_privileged: bool
    scope: PermissionScope


class RolePermissionOut(ApiModel):
    """Una casilla marcada. La matriz se arma en el cliente con estos pares."""

    role_id: UUID
    permission_code: str


class AdminOverviewOut(ApiModel):
    """Los nueve bloques. Ver `api/v1/admin.py` para por qué van juntos."""

    countries: list[CountryOut]
    tenant_countries: list[TenantCountryOut]
    companies: list[CompanyOut]
    clients: list[ClientOut]
    warehouses: list[WarehouseAdminOut]
    users: list[UserAdminOut]
    roles: list[RoleOut]
    permissions: list[PermissionOut]
    role_permissions: list[RolePermissionOut]


class PermissionToggleIn(ApiModel):
    """Una casilla.

    `granted` y no dos endpoints porque la interfaz tiene un `checkbox`. Partirlo en
    POST y DELETE obligaría al cliente a elegir el verbo según el estado que acaba de
    leer, con la carrera correspondiente si otra persona lo cambió entre medias.
    """

    granted: bool


class AuditStampOut(ApiModel):
    """Marca de auditoría. Reservado para el detalle de cada entidad."""

    created_at: datetime
    updated_at: datetime | None


# ══════════════════════════════════════════════════════════════════════════════
# ESCRITURAS
#
# Ninguna acepta `tenant_id`: lo pone el servidor con `core.current_tenant_id()`, que
# es la misma funcion que evalua RLS. Aceptarlo del cliente permitiria intentar
# escribir en otro tenant — la politica lo rechazaria, pero el endpoint no debe
# ofrecer el gesto.
#
# Y ninguna acepta `version` ni `deleted_at`: el repositorio los filtra con una lista
# blanca de columnas.
# ══════════════════════════════════════════════════════════════════════════════


class CountryOpenIn(ApiModel):
    """Abre un pais para el operador.

    No crea el pais: `public.countries` es un catalogo global de 37 filas. Esto crea la
    PRESENCIA del operador en el, que es lo que permite tener entidades legales alli.

    `default_locale` sigue el patron del CHECK `chk_tc_locale`: `es`, `es-CR`, `en-US`.
    """

    country_id: UUID
    default_currency_code: Annotated[str, Field(min_length=3, max_length=3)]
    default_locale: Annotated[str, Field(pattern=r"^[a-z]{2}(-[A-Z]{2})?$")] = "es-CR"
    default_timezone: Annotated[str, Field(min_length=3, max_length=64)] = "America/Costa_Rica"


class CompanyCreateIn(ApiModel):
    """Entidad legal del operador. Necesita un pais ya ABIERTO."""

    tenant_country_id: UUID
    name: Annotated[str, Field(min_length=2, max_length=160)]
    legal_name: Annotated[str, Field(max_length=200)] | None = None
    tax_id: Annotated[str, Field(max_length=40)] | None = None


class CompanyUpdateIn(ApiModel):
    name: Annotated[str, Field(min_length=2, max_length=160)] | None = None
    legal_name: Annotated[str, Field(max_length=200)] | None = None
    tax_id: Annotated[str, Field(max_length=40)] | None = None
    status: Literal["active", "inactive"] | None = None

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


class ClientCreateIn(ApiModel):
    """Dueno de la mercaderia. Cuelga de la entidad legal que le presta servicio.

    `code` sigue el CHECK `chk_client_code`: mayusculas, digitos, guion y guion bajo.
    Se usa en informes y etiquetas, asi que no admite espacios.
    """

    company_id: UUID
    code: Annotated[str, Field(min_length=1, max_length=20, pattern=r"^[A-Z0-9][A-Z0-9_-]*$")]
    name: Annotated[str, Field(min_length=2, max_length=160)]
    legal_name: Annotated[str, Field(max_length=200)] | None = None
    tax_id: Annotated[str, Field(max_length=40)] | None = None
    notes: str | None = None


class ClientUpdateIn(ApiModel):
    code: (
        Annotated[str, Field(min_length=1, max_length=20, pattern=r"^[A-Z0-9][A-Z0-9_-]*$")]
        | None
    ) = None
    name: Annotated[str, Field(min_length=2, max_length=160)] | None = None
    legal_name: Annotated[str, Field(max_length=200)] | None = None
    tax_id: Annotated[str, Field(max_length=40)] | None = None
    status: Literal["active", "inactive", "suspended"] | None = None
    notes: str | None = None

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


class RoleCreateIn(ApiModel):
    """Rol PROPIO del tenant. Es lo que desbloquea la matriz de permisos.

    Los 5 roles del sistema son globales y de solo lectura; para tener permisos
    distintos hay que crear uno propio.

    `name` sigue el CHECK `chk_roles_name`: minusculas, digitos y guion bajo,
    empezando por letra. `jefe_de_turno`, no `Jefe De Turno`.

    `is_system` NO se acepta: el CHECK `chk_roles_system` exige
    `is_system = (tenant_id IS NULL)`, y el tenant nunca es NULL aqui.
    """

    name: Annotated[str, Field(min_length=2, max_length=60, pattern=r"^[a-z][a-z0-9_]*$")]
    description: Annotated[str, Field(max_length=400)] | None = None
    #: Hereda de otro rol, incluidos los del sistema. `prevent_role_cycle` impide ciclos.
    parent_role_id: UUID | None = None


class RoleUpdateIn(ApiModel):
    name: (
        Annotated[str, Field(min_length=2, max_length=60, pattern=r"^[a-z][a-z0-9_]*$")] | None
    ) = None
    description: Annotated[str, Field(max_length=400)] | None = None
    parent_role_id: UUID | None = None

    def changes(self) -> dict[str, Any]:
        return self.model_dump(exclude_unset=True)


class RoleAssignmentIn(ApiModel):
    """Asigna o quita un rol a un usuario, con alcance global en el tenant.

    El alcance por company o por almacen existe en `core.role_assignments` y NO se
    expone: ofrecerlo sin interfaz para elegir el alcance produciria asignaciones a
    ciegas.
    """

    assigned: bool


class WarehouseAccessIn(ApiModel):
    """Concede o revoca acceso a un almacen.

    Es lo que decide que ve el usuario en TODO el producto: `spatial.locations` filtra
    por `core.accessible_warehouse_ids()`, asi que revocar vacia el explorador para esa
    persona en la peticion siguiente.
    """

    granted: bool


class CreatedOut(ApiModel):
    """Respuesta de creacion. Solo el id: el cliente recarga `overview`."""

    id: UUID


# ── Lo que faltaba del CRUD ────────────────────────────────────────────────
#
# Tres entidades tenían alta pero no baja o edición. El patrón es el mismo que ya usan
# `CompanyUpdateIn` y `ClientUpdateIn`: campos opcionales y un `changes()` que solo
# devuelve los que llegaron, para que un PATCH con un campo no borre los demás.


class TenantCountryUpdateIn(ApiModel):
    """Editar la PRESENCIA del operador en un país, no el país.

    `public.countries` es un catálogo global y compartido: su nombre, su prefijo
    telefónico y su moneda no son de ningún operador. Lo que se edita aquí son los
    valores por omisión con los que ESTE operador trabaja allí.
    """

    status: Literal["active", "inactive"] | None = None
    default_timezone: Annotated[str, Field(min_length=3, max_length=64)] | None = None
    default_currency_code: Annotated[str, Field(min_length=3, max_length=3)] | None = None

    def changes(self) -> dict[str, object]:
        return {k: v for k, v in self.model_dump().items() if v is not None}


class UserUpdateIn(ApiModel):
    """Editar el perfil y el estado de un usuario que YA existe.

    No lleva `email` a propósito. El correo es la llave con la que `core.users` se ata a
    la identidad de Supabase Auth: cambiarlo aquí dejaría a la persona con un correo en
    el producto y otro en el inicio de sesión, sin ningún error que lo avisara. Cambiar
    de correo es un asunto de la identidad, no del perfil.

    Tampoco lleva `is_platform_owner`: esa condición vive en `platform.owners` y se
    concede por su propio endpoint. Un booleano aquí sugeriría que se cambia editando
    una ficha.
    """

    first_name: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    last_name: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    locale: Annotated[str, Field(min_length=2, max_length=10)] | None = None
    timezone: Annotated[str, Field(min_length=3, max_length=64)] | None = None
    status: Literal["active", "suspended"] | None = None

    def changes(self) -> dict[str, object]:
        return {k: v for k, v in self.model_dump().items() if v is not None}
