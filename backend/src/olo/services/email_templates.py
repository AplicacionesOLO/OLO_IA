"""Plantilla HTML de los correos de aviso (0104).

Un layout COMPARTIDO, no una plantilla por tipo de aviso: `NotificationService.
avisar()` ya decidió, a propósito, que `title`/`body` son el mismo texto para la
campana in-app y para el correo (ver la cabecera de `notifications.py` — dos
textos por canal se separarían en cuanto alguien editara solo uno). Esta
plantilla no inventa contenido nuevo: viste ESE MISMO texto con una insignia de
color y un botón, según `kind` — es presentación, no una segunda fuente de
verdad sobre qué pasó.

CSS en línea, tablas para el botón, sin fuentes externas ni imágenes: es lo que
de verdad se renderiza igual en Gmail, Outlook de escritorio y un cliente de
móvil, que son los tres que importan aquí. Un `<style>` en el `<head>` se
ignora en Outlook de escritorio y en Gmail cuando reenvía, así que cada
propiedad va repetida como atributo `style` en el elemento, por repetitivo que
parezca.
"""

from __future__ import annotations

from html import escape

# (insignia, color de fondo, color de texto, etiqueta del boton)
_KIND_INFO: dict[str, tuple[str, str, str, str]] = {
    "perception_job.succeeded": ("COMPLETADO", "#E6F4EA", "#2F8F52", "Ver el trabajo"),
    "perception_job.failed": ("FALLÓ", "#FBEAE9", "#C14A42", "Ver el trabajo"),
    "training_run.succeeded": ("COMPLETADO", "#E6F4EA", "#2F8F52", "Ver el modelo"),
    "training_run.failed": ("FALLÓ", "#FBEAE9", "#C14A42", "Ver el modelo"),
    "incident.assigned": ("ASIGNADA", "#E5F4F6", "#0B7285", "Ver la incidencia"),
    "incident.overdue": ("VENCIDA", "#FBF2E3", "#B06A1E", "Ver la incidencia"),
}
_KIND_DEFAULT = ("AVISO", "#EEF0F3", "#4B5563", "Ver en OLO_IA")

# La franja de 4px arriba de la tarjeta usa el mismo color de texto de la
# insignia -- es lo unico que distingue un correo de otro a simple vista antes
# de leer una palabra, como el borde de color de una carta certificada.
_FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)


def render(*, kind: str, title: str, body: str, link_path: str | None, frontend_base_url: str) -> str:
    """El HTML completo de un correo de aviso. `title`/`body` se escapan: son
    texto que arma un servicio a partir de nombres reales (una incidencia, un
    almacén) y un correo no es sitio para confiar en que no traigan `<`/`&`.
    """
    insignia, fondo_insignia, color, etiqueta_boton = _KIND_INFO.get(kind, _KIND_DEFAULT)
    titulo_html = escape(title)
    cuerpo_html = escape(body)

    boton_html = ""
    if link_path:
        url = f"{frontend_base_url.rstrip('/')}{link_path}"
        boton_html = f"""
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
          <tr>
            <td bgcolor="{color}" style="border-radius:6px;">
              <a href="{escape(url, quote=True)}" target="_blank"
                 style="display:inline-block;padding:12px 22px;font-family:{_FONT};
                        font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;
                        border-radius:6px;">
                {escape(etiqueta_boton)}
              </a>
            </td>
          </tr>
        </table>"""

    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{titulo_html}</title>
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#F3F4F6;padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;width:100%;background-color:#FFFFFF;border:1px solid #E5E7EB;
                    border-radius:10px;overflow:hidden;">
        <tr>
          <td height="4" bgcolor="{color}" style="line-height:4px;font-size:4px;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:28px 36px 0 36px;">
            <span style="font-family:{_FONT};font-size:13px;font-weight:700;letter-spacing:0.04em;
                         color:#111827;">OLO_IA</span>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px 0 36px;">
            <span style="display:inline-block;font-family:{_FONT};font-size:11px;font-weight:700;
                         letter-spacing:0.06em;color:{color};background-color:{fondo_insignia};
                         padding:4px 10px;border-radius:20px;">{insignia}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 36px 0 36px;">
            <h1 style="margin:0;font-family:{_FONT};font-size:19px;line-height:1.4;
                       font-weight:700;color:#111827;">{titulo_html}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 36px 0 36px;">
            <p style="margin:0;font-family:{_FONT};font-size:14.5px;line-height:1.6;
                      color:#4B5563;">{cuerpo_html}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px 36px;">{boton_html}</td>
        </tr>
        <tr>
          <td style="padding:18px 36px;background-color:#FAFAFA;border-top:1px solid #E5E7EB;">
            <p style="margin:0;font-family:{_FONT};font-size:11.5px;line-height:1.5;color:#9CA3AF;">
              Aviso automático de OLO_IA. Administra qué te avisa por correo desde
              tu perfil en la aplicación.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""
