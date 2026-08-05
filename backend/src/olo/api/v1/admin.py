"""Configuración del sistema: países, entidades legales, clientes, almacenes,
usuarios, roles y la matriz de permisos.

─────────────────────────────────────────────────────────────────────────────
UNA LECTURA, MUCHAS ESCRITURAS

`GET /admin/overview` devuelve los nueve bloques de una vez. La alternativa —un
endpoint de lectura por entidad— haría nueve peticiones para pintar una pantalla, y
contra el pooler (~260 ms por viaje) eso es peor que una respuesta de 40 KB.

Las escrituras SÍ van por recurso, porque cada una exige el permiso de su módulo:
quien administra clientes no tiene por qué poder reescribir la matriz de permisos.

Los ALMACENES no están aquí: `api/v1/warehouses.py` ya tiene su CRUD completo desde
antes. Duplicarlo daría dos caminos para la misma escritura y dos sitios donde
corregir un fallo.

Y NO hay endpoint para crear USUARIOS: uno nuevo necesita identidad en Supabase Auth
además de la fila en `core.users`, y eso es un flujo de invitación con correo, no un
POST. Aquí se administran los que ya existen: sus roles y su acceso a almacenes.

─────────────────────────────────────────────────────────────────────────────
LOS PERMISOS QUE EXIGE

Cada escritura exige el permiso de SU módulo, con los códigos que existen de verdad en
`core.permissions` — no inventados:

    settings:read     leer toda la configuración
    settings:update   abrir un país para el operador
    companies:create  ·  companies:update
    clients:create    ·  clients:update  ·  clients:delete
    roles:write       crear, editar y borrar roles, Y la matriz de permisos
    roles:assign      decidir qué rol tiene un usuario
    users:update      acceso a almacenes

`roles:assign` va aparte de `users:update` porque el catálogo distingue «editar los
datos de un usuario» de «decidir qué puede hacer», que es la operación sensible.

NO exige `PlatformOwnerRequired`: es configuración del TENANT. Un administrador de
tenant tiene que poder gestionar sus roles sin ser owner de la plataforma. Lo que no
puede es asignarse permisos de plataforma — y eso lo impide el motor.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, status

from olo.api.deps import Db, require
from olo.api.v1.admin_schemas import (
    AdminOverviewOut,
    ClientCreateIn,
    ClientUpdateIn,
    CompanyCreateIn,
    CompanyUpdateIn,
    CountryOpenIn,
    CreatedOut,
    PermissionToggleIn,
    RoleAssignmentIn,
    RoleCreateIn,
    RoleUpdateIn,
    TenantCountryUpdateIn,
    UserUpdateIn,
    WarehouseAccessIn,
)
from olo.api.v1.schemas import Envelope
from olo.repositories import identity
from olo.services.admin import AdminService

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/overview",
    response_model=Envelope[AdminOverviewOut],
    dependencies=[require("settings:read")],
    summary="Toda la configuración del sistema en una respuesta",
)
async def overview(db: Db) -> Envelope[AdminOverviewOut]:
    """Nueve bloques: países, países del tenant, entidades legales, clientes,
    almacenes, usuarios, roles, permisos y las asignaciones.

    Sin paginar. Son 37 países, 1 entidad legal, 2 clientes, 3 almacenes reales, 2
    usuarios, 5 roles, 61 permisos y 72 asignaciones — y la matriz no se puede pintar
    a trozos.

    Todo pasa por RLS: los bloques de tenant se filtran por
    `tenant_id = core.current_tenant_id()` en el motor, no aquí.
    """
    datos = await AdminService(db).overview()
    return Envelope[AdminOverviewOut](data=AdminOverviewOut.model_validate(datos))


@router.put(
    "/roles/{role_id}/permissions/{permission_code}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("roles:write")],
    summary="Marcar o desmarcar una casilla de la matriz",
)
async def set_permission(
    db: Db, role_id: UUID, permission_code: str, payload: PermissionToggleIn
) -> None:
    """Idempotente en los dos sentidos.

    Marcar lo ya marcado o desmarcar lo ya desmarcado devuelve 204 sin hacer nada: con
    dos pestañas abiertas eso ocurre, y no es un error del operador.

    ⚠ Responde **422** al intentar conceder un permiso de alcance `platform`. No es un
      fallo de validación del valor —el permiso existe y el rol existe— sino una regla
      de negocio: seria una escalada de privilegios. El trigger
      `trg_role_permissions_scope_guard` lo aborta igualmente; el servicio lo detecta
      antes solo para explicar la alternativa (registrar al usuario en
      `platform.owners`).

    No lleva `If-Match`: la matriz no es un recurso versionado, es un conjunto de
    pares. Dos personas marcando casillas DISTINTAS no se pisan, y marcando la misma
    llegan al mismo estado. Exigir un ETag global de la matriz haría que cualquier
    cambio invalidara el de todos los demás.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).set_permission(
        role_id, permission_code, granted=payload.granted, actor=actor
    )


# ══════════════════════════════════════════════════════════════════════════════
# ESCRITURAS
#
# Cada recurso exige el permiso de SU modulo, no un `admin:write` global: quien
# administra clientes no tiene por que poder reescribir la matriz de permisos.
#
# Ninguna acepta `tenant_id`. Lo pone el servidor con `core.current_tenant_id()`.
# ══════════════════════════════════════════════════════════════════════════════


# ── Paises ────────────────────────────────────────────────────────────────────
@router.post(
    "/countries",
    response_model=Envelope[CreatedOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("settings:update")],
    summary="Abrir un pais para el operador",
)
async def open_country(db: Db, payload: CountryOpenIn) -> Envelope[CreatedOut]:
    """No crea un pais: `public.countries` es un catalogo global de 37 filas.

    Crea la PRESENCIA del operador en ese pais —con su moneda, locale y zona horaria—,
    que es el requisito para poder tener entidades legales alli.
    """
    actor = await identity.fetch_current_user_id(db)
    nuevo = await AdminService(db).open_country(payload.model_dump(), actor=actor)
    return Envelope[CreatedOut](data=CreatedOut(id=nuevo))


@router.patch(
    "/countries/{tenant_country_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("settings:update")],
    summary="Editar los valores por omision del operador en un pais",
)
async def update_tenant_country(
    db: Db, tenant_country_id: UUID, payload: TenantCountryUpdateIn
) -> None:
    """Edita la PRESENCIA, no el pais.

    `public.countries` es un catalogo global: su nombre y su moneda no son de ningun
    operador. Aqui se cambian la zona horaria y la moneda con las que este opera alli.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).update_tenant_country(
        tenant_country_id, payload.changes(), actor=actor
    )


@router.delete(
    "/countries/{tenant_country_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("settings:update")],
    summary="Cerrar la operacion en un pais",
)
async def close_country(db: Db, tenant_country_id: UUID) -> None:
    """Responde **409** si quedan entidades legales en ese pais, con el numero.

    Cerrarlo con empresas dentro las dejaria colgando de una presencia que ya no
    existe: no fallaria nada y el operador lo descubriria semanas despues.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).close_country(tenant_country_id, actor=actor)


# ── Entidades legales ─────────────────────────────────────────────────────────
@router.post(
    "/companies",
    response_model=Envelope[CreatedOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("companies:create")],
    summary="Crear una entidad legal del operador",
)
async def create_company(db: Db, payload: CompanyCreateIn) -> Envelope[CreatedOut]:
    actor = await identity.fetch_current_user_id(db)
    nuevo = await AdminService(db).create_company(payload.model_dump(), actor=actor)
    return Envelope[CreatedOut](data=CreatedOut(id=nuevo))


@router.patch(
    "/companies/{company_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("companies:update")],
    summary="Editar una entidad legal",
)
async def update_company(db: Db, company_id: UUID, payload: CompanyUpdateIn) -> None:
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).update_company(company_id, payload.changes(), actor=actor)


@router.delete(
    "/companies/{company_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("companies:delete")],
    summary="Dar de baja una entidad legal",
)
async def delete_company(db: Db, company_id: UUID) -> None:
    """Responde **409** con las cifras si tiene almacenes o clientes.

    «Tiene 2 almacenes y 3 clientes» dice que hacer; un error de restriccion no dice
    nada, y una baja silenciosa deja almacenes perteneciendo a una empresa que ya no
    opera.

    Baja LOGICA: `deleted_at` y `status = inactive`. El `tax_id` no se libera, y es
    correcto: una entidad legal dada de baja sigue existiendo en el registro mercantil,
    y reutilizar su identificacion fiscal seria el error.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).delete_company(company_id, actor=actor)


# ── Clientes ──────────────────────────────────────────────────────────────────
@router.post(
    "/clients",
    response_model=Envelope[CreatedOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("clients:create")],
    summary="Crear un cliente (dueno de mercaderia)",
)
async def create_client(db: Db, payload: ClientCreateIn) -> Envelope[CreatedOut]:
    """El cliente cuelga de la entidad legal que le presta el servicio.

    El mismo cliente en dos paises son dos filas: son dos contratos distintos.
    """
    actor = await identity.fetch_current_user_id(db)
    nuevo = await AdminService(db).create_client(payload.model_dump(), actor=actor)
    return Envelope[CreatedOut](data=CreatedOut(id=nuevo))


@router.patch(
    "/clients/{client_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("clients:update")],
    summary="Editar un cliente",
)
async def update_client(db: Db, client_id: UUID, payload: ClientUpdateIn) -> None:
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).update_client(client_id, payload.changes(), actor=actor)


@router.delete(
    "/clients/{client_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("clients:delete")],
    summary="Dar de baja un cliente",
)
async def delete_client(db: Db, client_id: UUID) -> None:
    """Baja LOGICA: el codigo se libera pero la fila se conserva.

    Cuando exista el inventario, aqui ira la guarda: un cliente con mercaderia en el
    almacen no se puede dar de baja sin decidir que pasa con ella.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).delete_client(client_id, actor=actor)


# ── Roles ─────────────────────────────────────────────────────────────────────
@router.post(
    "/roles",
    response_model=Envelope[CreatedOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("roles:write")],
    summary="Crear un rol propio del tenant",
)
async def create_role(db: Db, payload: RoleCreateIn) -> Envelope[CreatedOut]:
    """Esto es lo que desbloquea la matriz.

    Los 5 roles del sistema son GLOBALES —`tenant_id IS NULL`— y de solo lectura: los
    comparten todos los tenants. Para tener permisos distintos hay que crear un rol
    propio, opcionalmente heredando de uno del sistema con `parent_role_id`.

    `is_system` no se acepta: el CHECK `chk_roles_system` exige
    `is_system = (tenant_id IS NULL)`, y aqui el tenant nunca es NULL.
    """
    actor = await identity.fetch_current_user_id(db)
    nuevo = await AdminService(db).create_role(payload.model_dump(), actor=actor)
    return Envelope[CreatedOut](data=CreatedOut(id=nuevo))


@router.patch(
    "/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("roles:write")],
    summary="Editar un rol del tenant",
)
async def update_role(db: Db, role_id: UUID, payload: RoleUpdateIn) -> None:
    """Responde 422 si el rol es global: no se edita desde un tenant."""
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).update_role(role_id, payload.changes(), actor=actor)


@router.delete(
    "/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("roles:write")],
    summary="Dar de baja un rol del tenant",
)
async def delete_role(db: Db, role_id: UUID) -> None:
    """Responde **409** si algun usuario lo tiene asignado.

    Borrar un rol en uso dejaria a esos usuarios sin los permisos que tenian, en
    silencio y sin forma de saber que perdieron.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).delete_role(role_id, actor=actor)


# ── Usuarios ──────────────────────────────────────────────────────────────
@router.patch(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("users:update")],
    summary="Editar el perfil y el estado de un usuario",
)
async def update_user(db: Db, user_id: UUID, payload: UserUpdateIn) -> None:
    """Perfil y estado. NO el correo, y no es un olvido.

    El correo es la llave con la que `core.users` se ata a la identidad de Supabase Auth
    por `auth_id`. Cambiarlo aqui dejaria a la persona con un correo en el producto y
    otro en el inicio de sesion, sin ningun error que lo avisara.

    Dos guardas al suspender, las dos con su 409:

    · nadie se suspende a si mismo. Un administrador que se desactiva pierde el acceso a
      esta misma pantalla, y reactivarse pasa por la base de datos.
    · un owner de plataforma no se suspende desde aqui. Su condicion vive en
      `platform.owners`, asi que desactivar la fila de usuario lo dejaria siendo owner y
      sin poder entrar: un estado que ninguna pantalla explica.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).update_user(user_id, payload.changes(), actor=actor)

@router.put(
    "/users/{user_id}/roles/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # `roles:assign` y no `users:update`: el catalogo distingue «editar un usuario» de
    # «decidir que rol tiene», que es la operacion sensible.
    dependencies=[require("roles:assign")],
    summary="Asignar o quitar un rol a un usuario",
)
async def set_role_assignment(
    db: Db, user_id: UUID, role_id: UUID, payload: RoleAssignmentIn
) -> None:
    """Alcance global dentro del tenant. Idempotente en los dos sentidos.

    ⚠ NO existe endpoint para CREAR usuarios, y no es un olvido: un usuario nuevo
      necesita una identidad en Supabase Auth ademas de la fila en `core.users`. Eso es
      un flujo de invitacion con correo y verificacion, no un POST. Aqui se administran
      los usuarios que ya existen.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).set_role_assignment(
        user_id, role_id, assigned=payload.assigned, actor=actor
    )


@router.put(
    "/users/{user_id}/warehouses/{warehouse_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("users:update")],
    summary="Conceder o revocar acceso a un almacen",
)
async def set_warehouse_access(
    db: Db, user_id: UUID, warehouse_id: UUID, payload: WarehouseAccessIn
) -> None:
    """Decide que ve el usuario en TODO el producto.

    `spatial.locations` filtra por `core.accessible_warehouse_ids()`, asi que revocar
    aqui vacia el explorador de ubicaciones para esa persona en la peticion siguiente.

    Revocar marca `revoked_at` en lugar de borrar: la concesion es historia.
    """
    actor = await identity.fetch_current_user_id(db)
    await AdminService(db).set_warehouse_access(
        user_id, warehouse_id, granted=payload.granted, actor=actor
    )
