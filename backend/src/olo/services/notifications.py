"""Servicio de avisos (0104): que algo termine no dependa de volver a mirar.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ `avisar()` NUNCA LANZA POR UN FALLO DE CORREO

El aviso in-app y el correo son DOS canales, y el segundo es un lujo sobre el
primero: si SMTP está caído, lo que no puede pasar es que un entrenamiento que
terminó bien se reporte como si hubiera fallado el CIERRE. `avisar()` crea la fila
—eso sí puede fallar de verdad, y entonces sí propaga— y el correo se intenta
DESPUÉS, en su propio try/except que solo deja un log.

Quien llama a `avisar()` es siempre el desenlace de otra cosa (un entrenamiento que
se cerró, un trabajo que terminó): ese desenlace ya ocurrió, y un aviso que no se
pudo mandar no debe deshacerlo.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from olo.core.errors import NotFoundError
from olo.core.logging import get_logger
from olo.repositories.notifications import NotificationRepository
from olo.services.email import EmailNoConfiguradoError, EmailService

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings
    from olo.core.context import TenantContext

_log = get_logger(__name__)


class NotificationService:
    def __init__(self, session: AsyncSession, ctx: TenantContext, settings: Settings) -> None:
        self._repo = NotificationRepository(session)
        self._ctx = ctx
        self._email = EmailService(settings)

    async def avisar(
        self,
        *,
        user_id: UUID,
        kind: str,
        title: str,
        body: str,
        link: str | None = None,
    ) -> dict[str, Any]:
        """Intenta el correo y LUEGO crea el aviso in-app, con el resultado incluido.

        `title`/`body` sirven para LOS DOS canales: el mismo texto que se ve en la
        campana es el asunto y el cuerpo del correo. Dos textos distintos —uno para
        cada canal— se separarían en cuanto alguien editara solo uno.

        El orden —correo primero, fila después— no es arbitrario: `email_de()` es
        una lectura sobre `core.users` y no depende de que el aviso ya exista, así
        que puede intentarse antes. Intentarlo después exigiría un `UPDATE` sobre
        una fila que casi nunca es la propia (ver la cabecera del repositorio), y
        RLS lo rechazaría. Metiendo el resultado en el propio INSERT, que ya es
        operador-amplio, no hace falta abrir ningún permiso nuevo.
        """
        enviado_en: datetime | None = None
        try:
            correo = await self._repo.email_de(user_id)
            if correo:
                await self._email.enviar(
                    destinatario=correo, asunto=title, cuerpo=body, kind=kind, link=link
                )
                enviado_en = datetime.now(UTC)
        except EmailNoConfiguradoError:
            pass  # el canal in-app sigue existiendo; sin SMTP configurado no hay más que hacer
        except Exception:
            # Un SMTP caído no debe impedir el aviso in-app ni el evento que lo
            # origina. Ver la nota de cabecera.
            _log.exception("no se pudo mandar el correo del aviso para %s", user_id)

        return await self._repo.crear(
            tenant_id=self._ctx.tenant_id,
            user_id=user_id,
            kind=kind,
            title=title,
            body=body,
            link=link,
            email_sent_at=enviado_en,
        )

    async def avisar_admins(
        self, *, kind: str, title: str, body: str, link: str | None = None
    ) -> list[UUID]:
        """Como `avisar()`, pero a TODOS los `tenant_admin` del tenant de la
        sesion -- para eventos sin un dueño humano especifico (una cuota que
        se acerca, un dispositivo que se cayo), a diferencia de entrenamiento
        o incidencias, donde siempre hay alguien concreto a quien avisar.
        Devuelve los ids avisados, para que quien llama sepa si de verdad
        avisó a alguien.
        """
        admins = await self._repo.admins_del_tenant()
        for admin_id in admins:
            await self.avisar(user_id=admin_id, kind=kind, title=title, body=body, link=link)
        return admins

    async def listar(self, *, user_id: UUID, solo_no_leidas: bool, limit: int) -> dict[str, Any]:
        avisos = await self._repo.listar(
            user_id=user_id, solo_no_leidas=solo_no_leidas, limit=limit
        )
        no_leidas = await self._repo.contar_no_leidas(user_id)
        return {"notifications": avisos, "unread_count": no_leidas}

    async def marcar_leida(self, *, notif_id: UUID, user_id: UUID) -> None:
        if await self._repo.marcar_leida(notif_id=notif_id, user_id=user_id) == 0:
            # RLS ya impide ver la de otro, asi que «no existe» y «no es tuya» son
            # la misma respuesta observable — mismo razonamiento que OLOBOT.
            raise NotFoundError("Aviso no encontrado", resource_id=str(notif_id))

    async def marcar_todas_leidas(self, user_id: UUID) -> int:
        return await self._repo.marcar_todas_leidas(user_id)

    async def eliminar(self, *, notif_id: UUID, user_id: UUID) -> None:
        if await self._repo.eliminar(notif_id=notif_id, user_id=user_id) == 0:
            raise NotFoundError("Aviso no encontrado", resource_id=str(notif_id))
