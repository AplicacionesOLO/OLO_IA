"""Autorización: membresía activa, permisos y scope de almacén.

Principio que rige el módulo: **los permisos se resuelven contra la base de
datos en cada petición, nunca desde el JWT.** Es lo que hace que revocar un
permiso surta efecto de inmediato en lugar de esperar hasta una hora al refresh
del token (`RF-RBAC-007`).

Todas las consultas se apoyan en las funciones de contexto que la sesión ya
tiene fijadas —`core.current_tenant_id()`, `core.current_auth_id()`— en lugar de
recibir el tenant como parámetro. Así es imposible consultar con un tenant
distinto del que tiene la sesión.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

from olo.core.errors import ForbiddenError, NoActiveMembershipError, NotPlatformOwnerError
from olo.core.logging import get_logger

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

_log = get_logger(__name__)

_HAS_MEMBERSHIP = text(
    """
    SELECT core.has_active_membership() AS ok
    """
)

# Permisos efectivos: unión de los permisos de todos los roles asignados al
# usuario en el tenant actual, incluidos los heredados por `parent_role_id`.
#
# El scope se filtra dentro: un rol con scope de almacén solo cuenta si la
# petición se refiere a ese almacén (o si no se refiere a ninguno, para
# operaciones de lectura general).
#
# ── POR QUÉ LA CTE YA NO ESTÁ AQUÍ ───────────────────────────────────────────
# Vive en `core.tiene_permiso()` (migración 0080). Hizo falta en SQL porque
# `core.alta_usuario_invitado()` es SECURITY DEFINER —no pasa por RLS— y tiene que
# comprobar `users:invite` por su cuenta. Dejar una copia aquí y otra allí daría dos
# verdades sobre qué puede hacer cada usuario, y el síntoma sería el peor posible: la
# interfaz ofrece algo que después recibe 403.
#
# Es el mismo criterio que ya se seguía con `core.can_access_warehouse()` y
# `core.is_platform_owner()`: cuando el motor y el backend tienen que coincidir, la
# definición es una y está en el motor.
#
# Verificado antes de cambiarlo: para los dos usuarios reales, la función devuelve
# exactamente el mismo conjunto que devolvía esta CTE (42 y 24 permisos).
_HAS_PERMISSION = text(
    "SELECT core.tiene_permiso(:permission, CAST(:warehouse_id AS uuid)) AS ok"
)

# La LISTA de permisos, en vez del EXISTS de uno concreto. Sin filtro por almacén:
# quien pregunta esto quiere saber qué puede hacer en general, y acotarlo a un almacén
# es lo que hace `has_permission`.
#
# Sigue siendo una CTE aquí y no `core.tiene_permiso()`: la función responde por UN
# permiso, así que la lista costaría 61 evaluaciones de la CTE recursiva en lugar de
# una. Lo que NO puede pasar es que las dos discrepen — la CTE es idéntica a la de
# `core.tiene_permiso` salvo el filtro de almacén, y quien toque una tiene que tocar
# la otra. Si vuelve a hacer falta cambiarla, lo correcto es una
# `core.permisos_efectivos()` en el motor y borrar esta.
#
# El riesgo está acotado por para qué se usa: elegir qué herramientas ofrecerle a
# OLOBOT. La autoridad es `require_permission`, que va por la función.
_EFFECTIVE_PERMISSIONS = text(
    """
    WITH RECURSIVE assigned AS (
        SELECT ra.role_id
        FROM core.role_assignments ra
        JOIN core.users u ON u.id = ra.user_id
        WHERE ra.tenant_id = core.current_tenant_id()
          AND u.auth_id    = core.current_auth_id()
    ),
    role_tree AS (
        SELECT a.role_id AS id FROM assigned a
        UNION
        SELECT r.parent_role_id
        FROM core.roles r
        JOIN role_tree rt ON rt.id = r.id
        WHERE r.parent_role_id IS NOT NULL
    )
    SELECT DISTINCT rp.permission_code
    FROM core.role_permissions rp
    JOIN role_tree rt ON rt.id = rp.role_id
    """
)

# Se usa la función del motor, no una consulta propia: así el backend y RLS
# resuelven el scope exactamente igual y no pueden divergir.
_CAN_ACCESS_WAREHOUSE = text("SELECT core.can_access_warehouse(CAST(:warehouse_id AS uuid)) AS ok")

_TENANT_ACTIVE = text(
    """
    SELECT status IN ('trial', 'active') AS ok
    FROM core.tenants
    WHERE id = core.current_tenant_id()
    """
)

# Las TRES comprobaciones previas del permiso, en UNA sentencia.
#
# Antes eran tres `await session.execute()` seguidos. Con la base en otra región
# —260 ms de ida y vuelta medidos contra el pooler de AWS— eran 780 ms de red por
# petición, en TODOS los endpoints. Medido: una peticion a
# /v1/spatial/warehouses enviaba 7 sentencias, 1.820 ms de latencia sobre
# 2.806 ms de reloj de pared.
#
# Se conservan las tres respuestas por separado —no se colapsan en un booleano—
# porque cada una produce un error distinto y el cliente necesita distinguirlos:
# «tenant suspendido» no es «te falta un permiso».
#
# `LEFT JOIN` con una fila artificial, no `CROSS JOIN`: si el tenant no existiera
# —contexto sin fijar, o tenant borrado— un `CROSS JOIN` no devolvería fila y el
# código leería «no hay respuesta» en lugar de «el tenant no está operativo».
_PERMISSION_PRECHECKS = text(
    """
    SELECT
        COALESCE(t.status IN ('trial', 'active'), false) AS tenant_activo,
        core.has_active_membership()                     AS membresia,
        (SELECT p.scope FROM core.permissions p
          WHERE p.code = :permission)                    AS alcance
      FROM (SELECT 1) AS uno
      LEFT JOIN core.tenants t ON t.id = core.current_tenant_id()
    """
)


# Privilegio de plataforma. Se resuelve con la MISMA función que usan las
# políticas RLS del schema `platform`, para que el backend y el motor no puedan
# divergir — el mismo criterio que con `core.can_access_warehouse()`.
_IS_PLATFORM_OWNER = text("SELECT core.is_platform_owner() AS ok")

# Permisos que se conceden por ser Platform Owner. Se leen del catálogo en lugar
# de estar en una lista aquí: si una migración añade una familia nueva, aparece
# sin tocar el backend, y no puede haber dos verdades sobre qué existe.
_PLATFORM_PERMISSIONS = text(
    """
    SELECT code
    FROM core.permissions
    WHERE scope = 'platform'
    ORDER BY code
    """
)


async def has_active_membership(session: AsyncSession) -> bool:
    row = (await session.execute(_HAS_MEMBERSHIP)).first()
    return bool(row and row[0])


async def is_platform_owner(session: AsyncSession) -> bool:
    """¿Es Platform Owner? Se consulta la base, NUNCA el JWT.

    Es el privilegio más potente del sistema. Si viajara como claim, revocarlo
    tardaría hasta una hora en surtir efecto — la vida del token. Por eso se
    resuelve en cada petición, igual que los permisos (`RF-RBAC-007`).

    El coste es una lectura por PK sobre una tabla de decenas de filas, con
    índice parcial sobre los activos.
    """
    row = (await session.execute(_IS_PLATFORM_OWNER)).first()
    return bool(row and row[0])


async def require_platform_owner(session: AsyncSession) -> None:
    """Puerta de todo el módulo de plataforma.

    Se comprueba ANTES que cualquier permiso. Es la segunda de las dos capas que
    cierran la escalada de privilegios: la primera está en el motor —el trigger
    de `core.role_permissions` impide que un permiso de plataforma entre en un rol
    de tenant— y esta impide que un endpoint mal escrito autorice por permiso a
    quien no es owner.
    """
    if not await is_platform_owner(session):
        raise NotPlatformOwnerError


async def platform_permission_codes(session: AsyncSession) -> list[str]:
    """Los permisos que otorga ser Platform Owner, leídos del catálogo."""
    rows = (await session.execute(_PLATFORM_PERMISSIONS)).scalars().all()
    return list(rows)


async def effective_permission_codes(session: AsyncSession) -> frozenset[str]:
    """TODOS los permisos efectivos del usuario actual, en una sola ida y vuelta.

    ── POR QUÉ EN BLOQUE Y NO LLAMANDO A `has_permission` N VECES ──────────

    Lo pide OLOBOT: para decidir qué herramientas ofrecerle al modelo hay que saber
    qué permisos tiene el usuario, y son ocho permisos distintos. Con 260 ms medidos
    de latencia al pooler, ocho comprobaciones son dos segundos añadidos a CADA
    pregunta que se le haga al bot.

    Resuelve lo mismo que `core.tiene_permiso()` —incluida la herencia por
    `parent_role_id`—, pero con una CTE propia que devuelve la lista de una vez en
    lugar de preguntar 61 veces por la función. Si las dos divergieran, el catálogo de
    herramientas diría una cosa y `require_permission` otra: el modelo ofrecería algo
    que luego recibe 403, que es exactamente lo que el filtro pretende evitar.

    NO sustituye a `require_permission`. Esto informa una decisión de interfaz; la
    autoridad sigue estando en la comprobación de cada escritura.
    """
    codigos = set((await session.execute(_EFFECTIVE_PERMISSIONS)).scalars().all())
    # Los de alcance `platform` no los concede ningún rol —el trigger de 0022 lo
    # impide—, así que la CTE de roles no los ve nunca. Sin esta unión, el propio
    # owner de la plataforma se quedaría sin las herramientas que sí puede usar.
    if await is_platform_owner(session):
        codigos.update(await platform_permission_codes(session))
    return frozenset(codigos)


async def require_active_membership(session: AsyncSession) -> None:
    if not await has_active_membership(session):
        raise NoActiveMembershipError


async def can_access_warehouse(session: AsyncSession, warehouse_id: UUID) -> bool:
    """Valida `X-Warehouse-Id` contra los almacenes accesibles.

    Se valida aunque RLS ya lo cubra: sin esta comprobación el usuario recibiría
    una lista vacía inexplicable en lugar de un 403 claro. Es entrada del
    cliente y se trata como tal.
    """
    resultado = await session.execute(_CAN_ACCESS_WAREHOUSE, {"warehouse_id": str(warehouse_id)})
    row = resultado.first()
    ok = bool(row and row[0])
    if not ok:
        _log.warning("almacen no accesible", extra={"warehouse_id": str(warehouse_id)})
    return ok


async def has_permission(
    session: AsyncSession, permission: str, *, warehouse_id: UUID | None = None
) -> bool:
    row = (
        await session.execute(
            _HAS_PERMISSION,
            {
                "permission": permission,
                "warehouse_id": str(warehouse_id) if warehouse_id else None,
            },
        )
    ).first()
    return bool(row and row[0])


# `_PERMISSION_SCOPE` se fusiono en `_PERMISSION_PRECHECKS`: era la tercera de
# tres idas y vueltas seguidas que ahora son una.


async def require_permission(
    session: AsyncSession, ctx: TenantContext, permission: str
) -> None:
    """Exige un permiso `module:action` en el contexto actual.

    Orden de comprobación, del filtro más barato y general al más específico:
      1. ¿el tenant está operativo?  → un tenant suspendido no autoriza nada
      2. ¿hay membresía activa?
      3. ¿de qué ALCANCE es el permiso? De ahí depende quién lo concede:
           · `platform` → lo confiere `platform.owners`, NUNCA un rol. El trigger
             de la migración 0022 impide mapearlo a un rol de tenant, así que
             resolverlo por roles daría 403 al propio owner.
           · `tenant`   → lo concede un rol asignado, con scope que cubra la petición.
    """
    # Las tres en una sola ida y vuelta. El ORDEN de comprobación se mantiene
    # exactamente igual: se resuelven juntas, se evalúan en secuencia.
    fila = (
        await session.execute(_PERMISSION_PRECHECKS, {"permission": permission})
    ).first()

    if fila is None or not fila.tenant_activo:
        raise ForbiddenError("El tenant no está operativo")

    if not fila.membresia:
        raise NoActiveMembershipError

    alcance = fila.alcance

    if alcance == "platform":
        # La puerta de este bloque es ser Platform Owner. El permiso existe para que
        # el vocabulario de la interfaz sea real y para poder repartir capacidades
        # entre varios owners más adelante, sin rehacer los endpoints.
        if not await is_platform_owner(session):
            raise NotPlatformOwnerError
        return

    if not await has_permission(session, permission, warehouse_id=ctx.warehouse_id):
        _log.info(
            "permiso denegado",
            extra={"permission": permission, "tenant_id": str(ctx.tenant_id)},
        )
        raise ForbiddenError(
            f"Falta el permiso {permission}", required_permission=permission
        )
