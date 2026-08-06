"""Alta de usuarios por invitación.

═══════════════════════════════════════════════════════════════════════════════
LOS TRES PASOS, Y POR QUÉ NO PUEDEN SER UNO

    1. Supabase Auth crea la identidad y manda el correo   ← HTTP, fuera de la base
    2. `core.alta_usuario_invitado()` crea usuario y membresía  ← una sentencia
    3. rol y almacenes                                     ← escrituras normales

El paso 1 no puede estar dentro de la transacción del 2: es una llamada HTTP a otro
servicio. Eso deja una ventana real —identidad creada, filas no— y hay que decidir qué
pasa si el 2 falla.

La decisión es: **primero Auth, después la base**. Si el 2 falla, queda una identidad
en Auth sin filas en el producto, y eso es recuperable —reinvitar a esa persona la
encuentra por `auth_id` y crea lo que falta—. Al revés no lo sería: filas en el producto
apuntando a un `auth_id` que no existe darían un usuario que aparece en la pantalla de
Configuración y no puede entrar nunca, sin nada que lo explique.

El paso 3 sí va en la misma transacción que el 2.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ EL ROL Y LOS ALMACENES ESTÁN AQUÍ Y NO EN UN SEGUNDO PASO

Porque sin ellos la persona entra a una aplicación vacía. `core.accessible_warehouse_ids()`
sale de `core.user_warehouse_access`: sin ninguna fila, el explorador espacial, las
inspecciones y el inventario se ven en blanco, sin ningún mensaje que diga por qué. Y
sin rol no tiene ni un permiso, así que cada botón responde 403.

Invitar sin eso es entregar una cuenta que no sirve, y obliga a quien administra a
recordar dos pasos más que ninguna pantalla le pide.

⚠ Cada extra exige SU permiso, comprobado en el endpoint: `roles:assign` para el rol y
  `users:update` para los almacenes. Sin eso, quien solo tuviera `users:invite` podría
  crear un usuario y darle el rol de administrador — una escalada por la puerta de
  atrás.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.exc import DBAPIError

from olo.core.errors import (
    BusinessRuleError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from olo.core.logging import get_logger
from olo.db.pg_errors import extract_pg_error
from olo.repositories.admin import AdminRepository
from olo.security.supabase_admin import (
    AdminAuthError,
    AdminAuthNoConfiguradoError,
    SupabaseAdmin,
)
from olo.services.ai.errors import translate_pg_error

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings

_log = get_logger(__name__)

#: Los SQLSTATE que `core.alta_usuario_invitado()` levanta a propósito, y el error de
#: dominio de cada uno.
#:
#: Hace falta porque `translate_pg_error` despacha sobre el `DETAIL` —los códigos
#: `AI_*` que emiten los triggers— y esta función no usa DETAIL: usa `USING ERRCODE`,
#: que es lo natural para «falta un permiso» o «el dato no vale». Sin esta traducción,
#: la segunda capa de defensa de la función salía como **500**, que es peor que no
#: tenerla: parece un fallo del sistema en lugar de una regla.
_SQLSTATE_ALTA: dict[str, type[BusinessRuleError] | type[ForbiddenError]] = {
    "42501": ForbiddenError,  # insufficient_privilege: sin users:invite, sin membresía
    "22023": BusinessRuleError,  # invalid_parameter_value: correo o nombre no válidos
    "22004": BusinessRuleError,  # null_value_not_allowed: falta el auth_id
}


class ServicioNoConfiguradoError(BusinessRuleError):
    """Falta la clave de servicio. Es configuración ausente, no un error de quien pide."""


def _traducir_alta(exc: DBAPIError) -> Exception:
    """El error de `alta_usuario_invitado` como error de dominio.

    Primero se intenta `translate_pg_error`, que cubre los CHECK y las FK con código
    interno. Si no lo reconoce, se mira el SQLSTATE: los mensajes de esta función ya
    están escritos para leerse, así que se propagan tal cual.
    """
    conocido = translate_pg_error(exc)
    if conocido is not None:
        return conocido

    pg = extract_pg_error(exc)
    clase = _SQLSTATE_ALTA.get(pg.sqlstate or "") if pg else None
    if clase is None:
        return exc
    # `message` de PostgreSQL, no el repr de SQLAlchemy: el segundo arrastra la
    # sentencia y los parámetros a la respuesta HTTP.
    return clase(pg.message if pg and pg.message else "No se pudo dar de alta al usuario")


class InvitacionService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self._session = session
        self._repo = AdminRepository(session)
        self._settings = settings

    async def invitar(
        self,
        datos: dict[str, Any],
        *,
        actor: UUID,
        redirect_to: str | None = None,
    ) -> dict[str, Any]:
        """Invita a una persona al operador actual.

        Devuelve qué ocurrió de verdad, campo por campo, en vez de un simple «ok»:

            user_id            la fila de `core.users`
            usuario_creado     false si esa persona ya existía
            membresia_creada   false si ya pertenecía a este operador
            correo_enviado     false si Auth ya tenía su identidad (ver abajo)
            rol_asignado       el rol, si se pidió uno
            almacenes          cuántos almacenes se le concedieron

        ── `correo_enviado = false` ES EL CASO QUE HAY QUE CONTAR ───────────────

        `POST /auth/v1/invite` responde 422 si el correo ya tiene identidad —porque se
        le invitó antes, o porque pertenece a otro operador— y en ese caso **no manda
        ningún correo**. La invitación no falla: se le añade a este operador y podrá
        entrar con la contraseña que ya tenía.

        Pero si no la recuerda, reinvitarla no le va a llegar nada. La salida es
        recuperar contraseña, y eso solo se puede decir si la respuesta distingue los
        dos casos. Un «invitación enviada» plano dejaría a esa persona esperando un
        correo que nunca sale.
        """
        email = str(datos["email"]).strip().lower()

        # ── 1 · Auth ──────────────────────────────────────────────────────────
        try:
            admin = SupabaseAdmin(self._settings)
        except AdminAuthNoConfiguradoError as exc:
            raise ServicioNoConfiguradoError(str(exc)) from exc

        nombre = str(datos["first_name"]).strip()
        apellido = str(datos["last_name"]).strip()

        try:
            identidad = await admin.invitar(
                email,
                redirect_to=redirect_to,
                # Solo el nombre, para que el correo pueda saludar. El resto de los
                # datos vive en `core.users`: duplicarlos aquí daría dos verdades que
                # se separan en cuanto alguien edite su perfil.
                datos={"full_name": f"{nombre} {apellido}".strip()},
            )
        except AdminAuthError as exc:
            raise BusinessRuleError(str(exc)) from exc

        auth_id_txt = identidad.get("auth_id") or ""
        if not auth_id_txt:
            # Auth aceptó pero no devolvió identidad, o ya existía y no se pudo
            # localizar. Sin `auth_id` no se puede crear la fila: `core.users.auth_id`
            # es NOT NULL y es la llave que ata a la persona con su inicio de sesión.
            raise BusinessRuleError(
                "Supabase Auth no devolvió la identidad del usuario. Si esa persona ya "
                "existe en Auth pero no aparece en la lista de usuarios del proyecto, "
                "revisa el panel de Authentication antes de reintentar."
            )
        auth_id = UUID(auth_id_txt)
        ya_existia = bool(identidad.get("ya_existia"))

        # ── 2 · Las dos filas ─────────────────────────────────────────────────
        try:
            alta = await self._repo.alta_usuario_invitado(
                {
                    "email": email,
                    "first_name": nombre,
                    "last_name": apellido,
                    "locale": datos.get("locale"),
                    "timezone": datos.get("timezone"),
                },
                auth_id=auth_id,
            )
        except DBAPIError as exc:
            # La identidad de Auth ya existe a estas alturas. Se dice, porque el
            # reintento entonces NO manda correo y quien administra tiene que saberlo.
            _log.error(
                "alta_usuario_invitado fallo tras crear la identidad en Auth",
                extra={"email_domain": email.rpartition("@")[2]},
            )
            raise _traducir_alta(exc) from exc

        user_id: UUID = alta["user_id"]

        # ── 3 · Rol y almacenes, en la misma transacción ──────────────────────
        rol_asignado: str | None = None
        role_id = datos.get("role_id")
        if role_id:
            rid = UUID(str(role_id))
            if not await self._repo.role_exists(rid):
                raise NotFoundError("El rol indicado no existe", resource_id=str(rid))
            try:
                await self._repo.assign_role(user_id, rid, actor=actor)
            except DBAPIError as exc:
                raise (translate_pg_error(exc) or exc) from exc
            rol_asignado = str(rid)

        concedidos = 0
        for wid in datos.get("warehouse_ids") or []:
            try:
                await self._repo.grant_warehouse(user_id, UUID(str(wid)), actor=actor)
            except DBAPIError as exc:
                raise (translate_pg_error(exc) or exc) from exc
            concedidos += 1

        _log.info(
            "usuario invitado",
            extra={
                "usuario_creado": alta["usuario_creado"],
                "membresia_creada": alta["membresia_creada"],
                "correo_enviado": not ya_existia,
                "almacenes": concedidos,
            },
        )

        return {
            "user_id": user_id,
            "email": email,
            "usuario_creado": alta["usuario_creado"],
            "membresia_creada": alta["membresia_creada"],
            "correo_enviado": not ya_existia,
            "rol_asignado": rol_asignado,
            "almacenes_concedidos": concedidos,
        }

    async def comprobar_disponible(self, email: str) -> None:
        """Aborta con 409 si esa persona ya pertenece a este operador.

        Se llama ANTES de tocar Auth. No es imprescindible —el alta es idempotente—
        pero convierte «invité a alguien que ya estaba» en un mensaje claro en lugar de
        una invitación que parece nueva y no manda ningún correo.

        Solo mira ESTE operador, que es el único alcance donde la pregunta tiene
        sentido: la consulta pasa por RLS.
        """
        if await self._repo.user_id_por_email(email) is not None:
            raise ConflictError(
                f"«{email}» ya es usuario de este operador. Si necesita otro rol o "
                "acceso a más almacenes, edítalo en la lista de usuarios; si no puede "
                "entrar, usa recuperar contraseña.",
                field="email",
            )
