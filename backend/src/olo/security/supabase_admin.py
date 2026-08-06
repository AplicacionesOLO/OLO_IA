"""LA ADMIN API DE AUTH, y el único sitio donde vive la clave de servicio.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ ESTE ARCHIVO NO SABE HABLAR CON LA BASE DE DATOS

`service_role` tiene **BYPASSRLS**. Una sola consulta hecha con esa clave anularía el
aislamiento multi-tenant de todo el sistema: las 40 políticas de RLS que separan a un
operador de otro dejarían de aplicarse, y no habría ningún error que lo delatara —los
datos simplemente aparecerían—.

Así que este módulo **no importa SQLAlchemy, no recibe una sesión y no tiene forma de
consultar nada**. Hace exactamente una cosa: hablar con `/auth/v1/` por HTTP. La
imposibilidad es estructural, no una convención que alguien deba recordar.

Las filas que la invitación crea —`core.users`, `core.tenant_memberships`— las escribe el
repositorio con la conexión normal de `olo_app`, que no tiene BYPASSRLS y por tanto pasa
por las mismas políticas que todo lo demás.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ INVITAR Y NO CREAR CON CONTRASEÑA

`POST /auth/v1/invite` manda un correo con un enlace de un solo uso y la persona elige su
propia clave. La alternativa —crear el usuario con una contraseña que el administrador
inventa— tiene tres problemas y ninguno es teórico:

  · la contraseña viaja por donde el administrador la mande: WhatsApp, un papel, un correo
  · queda sabida por dos personas, así que «quién hizo esto» deja de tener una respuesta
  · casi nadie la cambia después

El precio es que hace falta SMTP configurado en Supabase. Sin él, Supabase acepta la
llamada y el correo no sale: la invitación queda creada y la persona nunca la recibe. Por
eso `invitar()` devuelve si el correo se envió, y el servicio lo dice en la respuesta.

═══════════════════════════════════════════════════════════════════════════════
LO QUE NO HACE

No borra usuarios de Auth. Dar de baja a alguien en OLO_IA es suspenderlo —el campo
`status`—, no borrar su identidad: si se borrara, todo lo que firmó quedaría apuntando a
un usuario que no existe.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx

from olo.core.logging import get_logger

if TYPE_CHECKING:
    from olo.core.config import Settings

_log = get_logger(__name__)

_TIMEOUT = httpx.Timeout(20.0, connect=5.0)


class AdminAuthError(RuntimeError):
    """Fallo al hablar con la Admin API de Auth."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class AdminAuthNoConfiguradoError(AdminAuthError):
    """No hay clave de servicio. Es configuración ausente, no un fallo del usuario."""


class SupabaseAdmin:
    def __init__(self, settings: Settings) -> None:
        clave = settings.supabase_service_role_key
        if clave is None:
            raise AdminAuthNoConfiguradoError(
                "Falta SUPABASE_SERVICE_ROLE_KEY: sin ella no se puede invitar a nadie. "
                "El resto del sistema funciona igual."
            )
        self._base = f"{settings.supabase_url}/auth/v1"
        # Auth exige `apikey` ADEMÁS del Bearer, incluso siendo la misma clave. Sin ella
        # responde 401 y el mensaje no menciona la cabecera que falta.
        self._headers = {
            "Authorization": f"Bearer {clave.get_secret_value()}",
            "apikey": clave.get_secret_value(),
            "Content-Type": "application/json",
        }

    async def invitar(
        self, email: str, *, redirect_to: str | None = None, datos: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Invita por correo y devuelve la identidad creada en Auth.

        Devuelve `{"auth_id": ..., "email": ..., "ya_existia": bool}`.

        `ya_existia` importa: si la persona ya tiene identidad en Auth —porque pertenece a
        otro operador, o porque se le invitó antes— no hay nada que crear ni ningún correo
        que mandar. El usuario existe; lo que falta es su membresía en ESTE operador, y eso
        lo resuelve el servicio. En ese caso **no se llama a `/invite` en absoluto**: ver
        el comentario de abajo.
        """
        limpio = email.strip().lower()

        # ── Se busca ANTES de invitar, y no es una optimización ────────────────
        #
        # Auth aplica su límite de envío de correos **antes** de comprobar si la persona
        # ya existe. Medido: con la cuota agotada, invitar a alguien que YA tiene
        # identidad devuelve `over_email_send_rate_limit` en lugar de `email_exists`.
        #
        # Consecuencia si se invitara primero: añadir a un operador que ya existe —el
        # caso que NO necesita ningún correo— quedaría bloqueado por un límite de correo.
        # Buscando primero, ese caso no gasta cuota y funciona siempre.
        existente = await self.buscar_por_email(limpio)
        if existente is not None:
            return {**existente, "ya_existia": True}

        cuerpo: dict[str, Any] = {"email": limpio}
        if redirect_to:
            cuerpo["redirect_to"] = redirect_to
        if datos:
            # `data` acaba en `raw_user_meta_data`. Va el nombre para que el correo de
            # invitación pueda saludar, y nada más: los datos del usuario viven en
            # `core.users`, y duplicarlos aquí daría dos verdades que se separan.
            cuerpo["data"] = datos

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
                r = await c.post(f"{self._base}/invite", headers=self._headers, json=cuerpo)
        except httpx.HTTPError as exc:
            raise AdminAuthError(f"No se pudo contactar con Auth: {exc}") from exc

        if r.status_code < 300:
            datos_r = r.json()
            return {
                "auth_id": str(datos_r.get("id") or ""),
                "email": str(datos_r.get("email") or email),
                "ya_existia": False,
            }

        detalle = r.text[:400]

        # GoTrue manda un `error_code` estable. Se usa ESE y no una búsqueda de palabras
        # en el texto: «email» aparece en casi todos los mensajes de este endpoint, así
        # que buscarla convertía cualquier fallo en «revisa el SMTP» —diagnóstico falso
        # medido: un dominio no entregable se reportaba como SMTP mal configurado—.
        try:
            cuerpo = r.json()
            codigo = str(cuerpo.get("error_code") or cuerpo.get("code") or "")
            mensaje = str(cuerpo.get("msg") or cuerpo.get("message") or "")
        except ValueError:
            codigo, mensaje = "", ""

        # Ya tiene identidad. Se busca su `auth_id` y se sigue: la invitación no era el
        # objetivo, tener a la persona en este operador sí.
        if codigo in {"email_exists", "user_already_exists"} or (
            "already been registered" in detalle or "already exists" in detalle
        ):
            existente = await self.buscar_por_email(email)
            if existente is not None:
                return {**existente, "ya_existia": True}

        # El cuerpo del error NO se propaga al usuario tal cual: puede traer detalles del
        # proyecto. Al log sí, que es donde se diagnostica.
        _log.error("Auth admin devolvio %s: %s", r.status_code, detalle)

        if r.status_code in (401, 403):
            raise AdminAuthError(
                "La clave de servicio no es válida o no tiene permiso para invitar.",
                status=r.status_code,
            )

        if codigo == "email_address_invalid":
            # Supabase valida que el dominio sea ENTREGABLE, no solo que la dirección
            # tenga forma de correo. Rechaza los dominios reservados —`.test`,
            # `.invalid`, `.local`— y los que no tienen MX. Es una comprobación suya, no
            # nuestra: el CHECK de `core.users` acepta esas direcciones.
            raise AdminAuthError(
                f"Supabase Auth no acepta la dirección «{email}»: exige un dominio de "
                "correo real y entregable. Los dominios de prueba (.test, .local, "
                ".invalid) y los que no tienen registro MX se rechazan aquí.",
                status=r.status_code,
            )

        if codigo in {"over_email_send_rate_limit", "over_request_rate_limit"}:
            # El SMTP integrado de Supabase permite muy pocos correos por hora. Es el
            # motivo más probable de que la segunda o tercera invitación falle mientras
            # la primera funcionó.
            #
            # Solo puede pasar con personas NUEVAS: a quien ya tiene identidad se le
            # encuentra antes de llegar aquí y no se gasta cuota.
            raise AdminAuthError(
                "Supabase está limitando el envío de correos: es el límite del SMTP "
                "integrado, unos pocos por hora. Configurando un SMTP propio en "
                "Authentication → Emails desaparece. Las personas que YA tienen cuenta "
                "se pueden añadir igualmente: no gastan envío.",
                status=r.status_code,
            )

        if "smtp" in mensaje.lower() or "sending" in mensaje.lower():
            raise AdminAuthError(
                "Auth no pudo enviar el correo. Comprueba el SMTP en Supabase "
                "(Authentication → Emails): sin él la invitación no llega a su "
                "destinatario.",
                status=r.status_code,
            )

        raise AdminAuthError(
            f"Auth no pudo crear la invitación (HTTP {r.status_code})"
            + (f": {mensaje}" if mensaje else "."),
            status=r.status_code,
        )

    async def buscar_por_email(self, email: str) -> dict[str, Any] | None:
        """La identidad de Auth de ese correo, o `None`.

        Se pide con `filter`, que GoTrue soporta en las versiones recientes. Si esa
        versión lo ignora, la respuesta trae la primera página completa y el filtrado por
        correo exacto se hace aquí de todos modos: **nunca se devuelve una identidad que
        no coincida exactamente**, porque `filter` hace coincidencia parcial y confundir a
        dos personas aquí significaría dar de alta a la equivocada.

        `per_page` alto por la misma razón: si la versión ignora `filter`, hay que abarcar
        cuantos más usuarios mejor en una sola página. Con el volumen de un operador
        logístico —decenas de personas— sobra, y cuando no sobre el síntoma será visible
        (no encuentra a alguien que sí existe) en lugar de silencioso.
        """
        buscado = email.strip().lower()
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
                r = await c.get(
                    f"{self._base}/admin/users",
                    headers=self._headers,
                    params={"page": 1, "per_page": 200, "filter": buscado},
                )
        except httpx.HTTPError:
            return None
        if r.status_code >= 400:
            return None

        for u in r.json().get("users", []):
            if str(u.get("email", "")).lower() == buscado:
                return {"auth_id": str(u.get("id")), "email": buscado}
        return None
