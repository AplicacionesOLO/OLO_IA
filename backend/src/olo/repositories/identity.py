"""Lecturas de identidad y autorización para `/v1/auth/me`.

Consultas puntuales, no un repositorio de entidad: `/auth/me` necesita
componer usuario, tenant, membresía, roles, permisos efectivos y almacenes
accesibles en una sola respuesta.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

from olo.core.errors import NoActiveMembershipError

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# El usuario actual se resuelve con core.current_user_id(), que va por auth_id.
# No se pasa ningún identificador desde la aplicación: así es imposible pedir
# el perfil de otra persona.
_ME = text(
    """
    SELECT u.id, u.auth_id, u.email, u.first_name, u.last_name,
           u.locale, u.timezone, u.status, u.avatar_file_id
    FROM core.users u
    WHERE u.id = core.current_user_id()
    """
)

_TENANT = text(
    """
    SELECT t.id, t.name, t.slug, t.status, t.plan
    FROM core.tenants t
    WHERE t.id = core.current_tenant_id()
    """
)

# Permisos efectivos: unión de los permisos de todos los roles asignados,
# incluidos los heredados por `parent_role_id`.
#
# Se resuelven CONTRA LA BASE en cada petición, no desde el JWT. Es lo que hace
# que revocar un permiso surta efecto de inmediato en lugar de esperar hasta una
# hora al refresh del token.
_PERMISSIONS = text(
    """
    WITH RECURSIVE assigned AS (
        SELECT ra.role_id, ra.scope_type, ra.scope_company_id, ra.scope_warehouse_id
        FROM core.role_assignments ra
        WHERE ra.tenant_id = core.current_tenant_id()
          AND ra.user_id   = core.current_user_id()
    ),
    -- La recursión sube por la cadena de herencia. El límite de profundidad 16
    -- lo impone el trigger prevent_role_cycle al escribir, así que aquí no
    -- puede haber ciclos.
    role_tree AS (
        SELECT a.role_id AS id FROM assigned a
        UNION
        SELECT r.parent_role_id
        FROM core.roles r
        JOIN role_tree rt ON rt.id = r.id
        WHERE r.parent_role_id IS NOT NULL
    )
    SELECT DISTINCT rp.permission_code AS code
    FROM core.role_permissions rp
    JOIN role_tree rt ON rt.id = rp.role_id
    ORDER BY code
    """
)

_ROLES = text(
    """
    SELECT r.name, ra.scope_type,
           ra.scope_company_id, ra.scope_warehouse_id
    FROM core.role_assignments ra
    JOIN core.roles r ON r.id = ra.role_id
    WHERE ra.tenant_id = core.current_tenant_id()
      AND ra.user_id   = core.current_user_id()
    ORDER BY r.name
    """
)

# Se usa la función, no una consulta propia: así el backend y RLS resuelven el
# scope exactamente igual y no pueden divergir.
_WAREHOUSES = text("SELECT unnest(core.accessible_warehouse_ids()) AS id")


async def fetch_me(session: AsyncSession) -> dict[str, Any] | None:
    row = (await session.execute(_ME)).mappings().first()
    return dict(row) if row else None


async def fetch_current_tenant(session: AsyncSession) -> dict[str, Any] | None:
    row = (await session.execute(_TENANT)).mappings().first()
    return dict(row) if row else None


async def fetch_effective_permissions(session: AsyncSession) -> list[str]:
    rows = (await session.execute(_PERMISSIONS)).scalars().all()
    return list(rows)


async def fetch_roles(session: AsyncSession) -> list[dict[str, Any]]:
    rows = (await session.execute(_ROLES)).mappings().all()
    return [dict(r) for r in rows]


async def fetch_accessible_warehouse_ids(session: AsyncSession) -> list[str]:
    rows = (await session.execute(_WAREHOUSES)).scalars().all()
    return [str(r) for r in rows if r is not None]


async def fetch_current_user_id(session: AsyncSession) -> UUID:
    """El `core.users.id` del usuario de la sesión.

    Se usa para rellenar `created_by` y `updated_by`. Va por la función del motor y
    no por una consulta propia para que no pueda divergir de lo que RLS considera la
    identidad actual.

    Lanza si es NULL: llegar aquí sin identidad significa que la dependencia de
    sesión no verificó la membresía, y seguir escribiría filas con autor
    desconocido.
    """
    valor = (await session.execute(text("SELECT core.current_user_id() AS id"))).scalar_one()
    if valor is None:
        raise NoActiveMembershipError("No hay identidad resoluble en la sesión")
    return UUID(str(valor))
