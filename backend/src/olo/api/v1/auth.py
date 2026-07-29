"""Endpoints de identidad: login, refresh, logout y perfil.

El backend no implementa autenticación, la delega en Supabase Auth. Pero es el
único punto por el que pasa, para que la auditoría de accesos no quede ciega y
los errores tengan el mismo formato que el resto de la API.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, status

from olo.api.deps import CurrentContext, Db, get_app_settings
from olo.api.v1.schemas import (
    Envelope,
    LoginRequest,
    MeOut,
    RefreshRequest,
    RoleAssignmentOut,
    TenantOut,
    TokenOut,
)
from olo.core.config import Settings
from olo.core.errors import NoActiveMembershipError
from olo.core.logging import get_logger
from olo.repositories import identity
from olo.security import authorization
from olo.security.supabase_auth import SupabaseAuthClient

router = APIRouter(prefix="/auth", tags=["auth"])
_log = get_logger(__name__)

SettingsDep = Annotated[Settings, Depends(get_app_settings)]


@router.post(
    "/login",
    response_model=Envelope[TokenOut],
    status_code=status.HTTP_200_OK,
    summary="Iniciar sesión con email y contraseña",
)
async def login(payload: LoginRequest, settings: SettingsDep) -> Envelope[TokenOut]:
    """Autentica contra Supabase Auth y devuelve el par de tokens.

    Al emitir el token, GoTrue invoca el Custom Access Token Hook, que añade
    `app_metadata.tenant_id` y `app_metadata.tenant_wide_access`.

    Caso que el frontend debe manejar: si el usuario **no tiene membresía
    activa**, el login devuelve 200 con tokens válidos, pero el token sale sin
    `tenant_id` y cualquier llamada posterior responderá
    403 `NO_ACTIVE_MEMBERSHIP`. Es el comportamiento fail-secure del Hook: la
    identidad es correcta, lo que falta es la pertenencia.
    """
    tokens = await SupabaseAuthClient(settings).sign_in(payload.email, payload.password)
    _log.info("login correcto", extra={"email_domain": payload.email.rpartition("@")[2]})
    return Envelope[TokenOut](data=TokenOut.model_validate(tokens))


@router.post(
    "/refresh",
    response_model=Envelope[TokenOut],
    summary="Renovar el access token",
)
async def refresh(payload: RefreshRequest, settings: SettingsDep) -> Envelope[TokenOut]:
    """Rota el refresh token y **recalcula los claims**.

    Es el momento en que se reevalúan `tenant_id` y `tenant_wide_access`, así que
    revocar una membresía surte efecto como máximo en una hora. Los permisos, en
    cambio, son inmediatos: se resuelven contra la base en cada petición y no
    viajan en el token.
    """
    tokens = await SupabaseAuthClient(settings).refresh(payload.refresh_token)
    return Envelope[TokenOut](data=TokenOut.model_validate(tokens))


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cerrar sesión",
)
async def logout(
    settings: SettingsDep,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> None:
    """Invalida el refresh token en Supabase Auth.

    El access token sigue siendo válido hasta que expire —es la naturaleza de un
    JWT sin lista de revocación—, así que **el cliente debe descartarlo**. Para
    revocación inmediata existe la vía administrativa de revocar sesiones.

    Devuelve 204 incluso si el token ya no vale: cerrar una sesión que ya está
    cerrada es un no-op legítimo, y devolver error obligaría al frontend a
    tratar un caso que no le aporta nada.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None

    token = authorization.split(" ", 1)[1].strip()
    try:
        await SupabaseAuthClient(settings).sign_out(token)
    except Exception as exc:  # noqa: BLE001 - el logout nunca debe fallar al cliente
        _log.info("logout con token ya invalido", extra={"exc_type": type(exc).__name__})
    return None


@router.get("/me", response_model=Envelope[MeOut], summary="Perfil del usuario actual")
async def me(db: Db, ctx: CurrentContext) -> Envelope[MeOut]:
    """Perfil, tenant, roles, permisos efectivos y almacenes accesibles.

    No recibe ningún identificador: el usuario se resuelve con
    `core.current_user_id()`, que va por `auth_id` desde el contexto de sesión.
    Así es imposible pedir el perfil de otra persona.

    Sin permiso declarado a propósito: cualquier usuario autenticado con
    membresía activa puede consultar su propio perfil. La dependencia `Db` ya
    exige la membresía.
    """
    user = await identity.fetch_me(db)
    if user is None:
        raise NoActiveMembershipError("No hay perfil de usuario para esta identidad")

    tenant = await identity.fetch_current_tenant(db)
    if tenant is None:
        raise NoActiveMembershipError("El tenant del token no es accesible")

    roles = await identity.fetch_roles(db)
    permissions = await identity.fetch_effective_permissions(db)
    warehouse_ids = await identity.fetch_accessible_warehouse_ids(db)

    # Privilegio de plataforma: se consulta la base, no el token. Los permisos de
    # plataforma se añaden a la misma lista para que el cliente siga ocultando por
    # permiso sin ninguna lógica especial.
    owner = await authorization.is_platform_owner(db)
    if owner:
        permissions = sorted(
            set(permissions) | set(await authorization.platform_permission_codes(db))
        )

    return Envelope[MeOut](
        data=MeOut(
            id=user["id"],
            email=user["email"],
            first_name=user["first_name"],
            last_name=user["last_name"],
            locale=user["locale"],
            timezone=user["timezone"],
            status=user["status"],
            tenant=TenantOut.model_validate(tenant),
            roles=[RoleAssignmentOut.model_validate(r) for r in roles],
            permissions=permissions,
            accessible_warehouse_ids=warehouse_ids,  # type: ignore[arg-type]
            tenant_wide_access=ctx.tenant_wide_access,
            is_platform_owner=owner,
        )
    )
