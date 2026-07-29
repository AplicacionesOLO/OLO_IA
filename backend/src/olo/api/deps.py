"""Dependencias de FastAPI: autenticación, contexto y sesión.

Implementa la secuencia obligatoria del canal B, en este orden exacto:

  1. extraer el Bearer
  2. verificar firma, expiración y audiencia contra el JWKS
  3. extraer sub / tenant_id / tenant_wide_access
  4. ABRIR TRANSACCIÓN y fijar los cinco GUCs
  5. verificar membresía activa
  6. validar X-Warehouse-Id, si viene
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from olo.core.config import Settings
from olo.core.context import TenantContext
from olo.core.errors import UnauthenticatedError, WarehouseNotAccessibleError
from olo.db.session import tenant_session
from olo.security.authorization import (
    can_access_warehouse,
    require_active_membership,
)
from olo.security.authorization import require_platform_owner as _require_platform_owner
from olo.security.jwt import decode_token, extract_identity

# auto_error=False: el 401 lo emitimos nosotros con el envoltorio de error
# unificado, en lugar del cuerpo por defecto de FastAPI.
_bearer = HTTPBearer(auto_error=False)


def get_app_settings(request: Request) -> Settings:
    """Ajustes de la aplicación en curso, no del entorno.

    Se leen de `app.state`, donde los dejó `create_app`. Llamar a
    `get_settings()` aquí ignoraría los ajustes con los que se construyó la
    aplicación —y en los tests reventaría al no haber variables de entorno—.
    """
    settings: Settings = request.app.state.settings
    return settings


async def get_claims(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> dict[str, object]:
    if credentials is None or not credentials.credentials:
        raise UnauthenticatedError
    return decode_token(credentials.credentials, settings)


async def get_access_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> str:
    """El JWT en crudo, para reenviarlo a Supabase Storage.

    Sin `service_role`, la autorizacion de Storage la imponen las politicas RLS de
    `storage.objects`, que necesitan la identidad del llamante.
    """
    if credentials is None or not credentials.credentials:
        raise UnauthenticatedError
    return credentials.credentials


async def get_tenant_context(
    claims: Annotated[dict[str, object], Depends(get_claims)],
    x_warehouse_id: Annotated[str | None, Header(alias="X-Warehouse-Id")] = None,
) -> TenantContext:
    """Construye el contexto SOLO a partir de claims verificados.

    El `tenant_id` nunca proviene del cliente. Si llegara en el cuerpo, en la
    query o en una cabecera, se ignora: aquí solo se lee del token.
    """
    auth_user_id, tenant_id, wide = extract_identity(claims)  # type: ignore[arg-type]

    warehouse_id: UUID | None = None
    if x_warehouse_id:
        try:
            warehouse_id = UUID(x_warehouse_id)
        except ValueError as exc:
            raise WarehouseNotAccessibleError("X-Warehouse-Id is not a valid UUID") from exc

    return TenantContext(
        auth_user_id=auth_user_id,
        tenant_id=tenant_id,
        tenant_wide_access=wide,
        warehouse_id=warehouse_id,
    )


async def get_session(
    ctx: Annotated[TenantContext, Depends(get_tenant_context)],
) -> AsyncIterator[AsyncSession]:
    """Sesión con contexto aplicado, membresía verificada y almacén validado.

    Es el único punto por el que un endpoint obtiene acceso a la base.
    """
    async with tenant_session(ctx) as session:
        await require_active_membership(session)

        if ctx.warehouse_id is not None and not await can_access_warehouse(
            session, ctx.warehouse_id
        ):
            raise WarehouseNotAccessibleError(warehouse_id=str(ctx.warehouse_id))

        yield session


# ── Alias para las firmas de los endpoints ────────────────────────────────
CurrentContext = Annotated[TenantContext, Depends(get_tenant_context)]
Db = Annotated[AsyncSession, Depends(get_session)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]
AccessToken = Annotated[str, Depends(get_access_token)]


def require(permission: str) -> Depends:  # type: ignore[valid-type]
    """Dependencia declarativa de permiso.

    Uso:  @router.post("/x", dependencies=[require("inventory:write")])

    Deja el permiso exigido en la firma del endpoint, así que un endpoint sin
    permiso declarado se detecta leyendo el router, no auditando el cuerpo.
    """

    async def _check(
        session: Db,
        ctx: CurrentContext,
    ) -> None:
        from olo.security.authorization import require_permission

        await require_permission(session, ctx, permission)

    return Depends(_check)


async def require_platform_owner_dep(session: Db) -> None:
    """Puerta del módulo de plataforma. 403 `NOT_PLATFORM_OWNER` si no lo es.

    Uso:  @router.get("/x", dependencies=[PlatformOwnerRequired])

    Va SIEMPRE antes que cualquier `require(...)` de permiso. Es la segunda capa
    que cierra la escalada de privilegios; la primera está en el motor, donde el
    trigger de `core.role_permissions` impide que un permiso de plataforma entre
    en un rol de tenant.

    No comprueba ningún claim: resuelve contra la base, así que revocar el
    privilegio surte efecto en la petición siguiente sin refrescar el token.
    """
    await _require_platform_owner(session)


PlatformOwnerRequired = Depends(require_platform_owner_dep)
