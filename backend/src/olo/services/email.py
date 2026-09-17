"""Envío de correo de avisos (0104). Ver la nota de `config.py`: NO es el SMTP de
Supabase Auth, es el que faltaba para que el backend avise de sus propios eventos.

`smtplib` de la librería estándar y no un paquete async: es una sola llamada por
aviso, no un servidor que reciba tráfico, así que el coste de un hilo bloqueante
ocasional es menor que arrastrar una dependencia nueva para esto.
"""

from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage
from typing import TYPE_CHECKING

from olo.core.logging import get_logger
from olo.services.email_templates import render as render_html

if TYPE_CHECKING:
    from olo.core.config import Settings

_log = get_logger(__name__)


class EmailNoConfiguradoError(Exception):
    """Faltan las variables SMTP_*. No es un fallo del envío: es que no hay canal."""


class EmailService:
    def __init__(self, settings: Settings) -> None:
        self._cfg = settings

    @property
    def disponible(self) -> bool:
        return bool(self._cfg.smtp_host and self._cfg.smtp_user and self._cfg.smtp_pass)

    async def enviar(
        self,
        *,
        destinatario: str,
        asunto: str,
        cuerpo: str,
        kind: str | None = None,
        link: str | None = None,
    ) -> None:
        """Manda el correo de un aviso. Bloqueante de verdad: corre en un hilo
        aparte para no congelar el bucle de eventos mientras dura la conexión SMTP.

        Va en dos partes -- texto plano (`cuerpo` tal cual, sin cambios) y una
        alternativa HTML que viste ESE MISMO texto con una insignia de
        color y un botón según `kind`. `kind`/`link` son opcionales a propósito:
        quien mande un correo que no es un aviso de los que ya existen (por
        ejemplo, una prueba manual) sigue recibiendo algo presentable, con la
        insignia genérica "AVISO".

        No lanza si falla: lo hace el llamador, que decide si un correo perdido
        debe tirar la operación que lo originó o solo quedar en el log. Un aviso
        que no se pudo mandar por correo NO debe impedir que el aviso in-app exista.
        """
        if not self.disponible:
            raise EmailNoConfiguradoError(
                "Faltan SMTP_HOST/SMTP_USER/SMTP_PASS: el correo de avisos no está configurado."
            )
        await asyncio.to_thread(self._enviar_sync, destinatario, asunto, cuerpo, kind, link)

    def _enviar_sync(
        self,
        destinatario: str,
        asunto: str,
        cuerpo: str,
        kind: str | None,
        link: str | None,
    ) -> None:
        assert self._cfg.smtp_host and self._cfg.smtp_user and self._cfg.smtp_pass

        mensaje = EmailMessage()
        mensaje["Subject"] = asunto
        mensaje["From"] = f"{self._cfg.smtp_sender_name} <{self._cfg.smtp_user}>"
        mensaje["To"] = destinatario
        # El texto plano va PRIMERO y es el cuerpo "real" del mensaje -- lo que ve
        # un cliente que no entiende HTML, y lo que gana cualquier filtro de correo
        # que compare las dos partes. `add_alternative` lo deja como aparte MENOS
        # preferida, que es justo la convención de `multipart/alternative`.
        mensaje.set_content(cuerpo)
        mensaje.add_alternative(
            render_html(
                kind=kind or "",
                title=asunto,
                body=cuerpo,
                link_path=link,
                frontend_base_url=self._cfg.frontend_base_url,
            ),
            subtype="html",
        )

        with smtplib.SMTP(
            self._cfg.smtp_host, self._cfg.smtp_port, timeout=self._cfg.smtp_timeout_s
        ) as smtp:
            smtp.starttls()
            smtp.login(self._cfg.smtp_user, self._cfg.smtp_pass.get_secret_value())
            smtp.send_message(mensaje)
