"""LA ESTACIÓN DEL DIRECTO: lo que la pantalla necesita para guiar un vuelo en vivo.

Responde, en un solo viaje, las preguntas que hasta ahora se contestaban mirando
consolas:

    ¿a qué red WiFi conecto el control?            red_wifi
    ¿qué URL pongo en DJI Fly?                     rtmp_urls
    ¿el servidor de video está encendido?          servidor_activo
    ¿el dron está transmitiendo ahora mismo?       dron_emitiendo
    ¿hay un directo analizándose? ¿cuál?           directo_activo

Solo tiene sentido en la máquina que recibe el video (donde corre MediaMTX, el
servidor RTMP). En otra —p. ej. el despliegue en la nube— el servidor no responde y
la pantalla lo dice: `servidor_activo = False`. No se adivina nada.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import socket
import subprocess
import sys
import urllib.request
from typing import Any

#: API local de MediaMTX (ver `tools/rtmp/directo.yml`). Solo escucha en 127.0.0.1.
MEDIAMTX_API = os.environ.get("OLO_MEDIAMTX_API", "http://127.0.0.1:9997")
#: El "canal" del dron dentro del servidor: rtmp://<ip>:1935/<CANAL>.
CANAL = os.environ.get("OLO_DIRECTO_CANAL", "dron")
PUERTO_RTMP = 1935
#: IP que Windows da a la PC cuando comparte su propia zona WiFi (hotspot).
IP_HOTSPOT_WINDOWS = "192.168.137.1"


def _ips_locales() -> list[str]:
    """IPv4 de esta máquina alcanzables desde la red (sin loopback ni link-local)."""
    ips: set[str] = set()
    with contextlib.suppress(OSError):
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(str(info[4][0]))
    #  La IP de salida real (la de la interfaz con ruta por defecto). UDP no envía nada.
    with contextlib.suppress(OSError), socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
    utiles = [i for i in ips if not i.startswith(("127.", "169.254."))]
    #  Primero la del hotspot propio si existe (si el control está ahí, es la buena),
    #  luego las privadas habituales.
    return sorted(utiles, key=lambda i: (i != IP_HOTSPOT_WINDOWS, i))


def _red_wifi() -> str | None:
    """Nombre de la WiFi a la que está conectada esta PC. Solo Windows.

    `Get-NetConnectionProfile` y no `netsh wlan`: en Windows 11 `netsh wlan` exige el
    permiso de ubicación (o admin) y sin él no devuelve el SSID. El nombre del perfil de
    red coincide con el SSID y no pide nada.
    """
    if sys.platform != "win32":
        return None
    try:
        salida = subprocess.run(  # comando fijo, sin entrada externa
            [  # noqa: S607
                "powershell", "-NoProfile", "-Command",
                "(Get-NetConnectionProfile | Where-Object InterfaceAlias -match 'Wi-?Fi'"
                " | Select-Object -First 1).Name",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return salida.strip() or None


def _estado_servidor() -> dict[str, Any] | None:
    """Lo que dice MediaMTX del canal del dron, o None si no responde."""
    try:
        with urllib.request.urlopen(  # noqa: S310  URL local fija
            f"{MEDIAMTX_API}/v3/paths/get/{CANAL}", timeout=1.5
        ) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        #  404 = el servidor está, pero el canal todavía no existe: nadie emitió aún.
        return {"ready": False} if e.code == 404 else None
    except (OSError, ValueError):
        return None


#: Alto minimo para que las etiquetas QR se lean desde una distancia de vuelo razonable.
#: Medido en el directo del 2026-11-24: a 720p el QR del larguero salia de ~85x45 px y
#: no se decodificaba ninguno.
ALTO_RECOMENDADO = 1080


def _resolucion(servidor: dict[str, Any] | None) -> dict[str, Any]:
    for pista in (servidor or {}).get("tracks2") or []:
        props = pista.get("codecProps") or {}
        if props.get("width") and props.get("height"):
            alto = int(props["height"])
            return {
                "video_ancho": int(props["width"]),
                "video_alto": alto,
                "calidad_baja": alto < ALTO_RECOMENDADO,
            }
    return {"video_ancho": None, "video_alto": None, "calidad_baja": None}


def _leer_maquina() -> dict[str, Any]:
    """Todo lo que se pregunta al sistema operativo y a MediaMTX (bloqueante)."""
    ips = _ips_locales()
    servidor = _estado_servidor()
    return {
        "red_wifi": _red_wifi(),
        "ips": ips,
        "rtmp_urls": [f"rtmp://{ip}:{PUERTO_RTMP}/{CANAL}" for ip in ips],
        "servidor_activo": servidor is not None,
        "dron_emitiendo": bool(servidor.get("ready")) if servidor else None,
        "dron_desde": (servidor or {}).get("readyTime"),
        #  La resolucion con la que LLEGA el video. No se puede fijar desde aqui —la
        #  calidad la elige DJI Fly en el control, que no admite ordenes externas—, pero
        #  si medir y avisar: a 720p las etiquetas QR casi nunca se leen.
        **_resolucion(servidor),
        "ver_video_url": f"http://localhost:8889/{CANAL}",
    }


def _leer_nube() -> dict[str, Any]:
    """El servidor de video EN LA NUBE (AWS): la URL no cambia y sirve desde cualquier red.

    El dron transmite por internet, asi que no hay «misma WiFi» que cuidar: `red_wifi` va
    a None y la pantalla pide solo que el control tenga internet.
    """
    import base64

    from olo.core.config import get_settings

    a = get_settings()
    host, canal = a.media_host, a.media_path
    servidor: dict[str, Any] | None = None
    try:
        peticion = urllib.request.Request(f"https://{host}/api/v3/paths/get/{canal}")
        if a.media_api_user and a.media_api_pass:
            cred = f"{a.media_api_user}:{a.media_api_pass.get_secret_value()}"
            token = base64.b64encode(cred.encode()).decode()
            peticion.add_header("Authorization", f"Basic {token}")
        with urllib.request.urlopen(peticion, timeout=4) as r:  # noqa: S310  URL de config
            servidor = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        servidor = {"ready": False} if e.code == 404 else None
    except (OSError, ValueError):
        servidor = None
    clave = ""
    if a.media_publish_user and a.media_publish_pass:
        clave = f"?user={a.media_publish_user}&pass={a.media_publish_pass.get_secret_value()}"
    return {
        "modo": "nube",
        "red_wifi": None,
        "ips": [a.media_ip or host],
        "rtmp_urls": [f"rtmp://{a.media_ip or host}:1935/{canal}{clave}"],
        "servidor_activo": servidor is not None,
        "dron_emitiendo": bool(servidor.get("ready")) if servidor else None,
        "dron_desde": (servidor or {}).get("readyTime"),
        **_resolucion(servidor),
        "ver_video_url": f"https://{host}/{canal}/",
    }


async def leer_estacion() -> dict[str, Any]:
    """Nube si está configurada (`media_host`); si no, el servidor local de antes."""
    from olo.core.config import get_settings

    if get_settings().media_host:
        return await asyncio.to_thread(_leer_nube)
    return {"modo": "local", **(await asyncio.to_thread(_leer_maquina))}
