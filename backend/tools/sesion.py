"""La sesión con la API para los guiones de máquina, y cómo renovarla.

Vive aquí y no dentro de `inferir.py` porque los dos guiones largos la necesitan y por el
mismo motivo. Los tokens de Supabase Auth duran UNA HORA:

· el worker de inferencia en `--bucle` se moría a los sesenta minutos. Queda medido en su
  log: arrancó a las 16:34 y a las 17:34:21 respondió
  `HTTP 401 · Token is invalid or expired`. Nadie lo notaba hasta que alguien encolaba un
  trabajo y se quedaba esperando a una máquina que ya no estaba.
· el entrenador es peor, porque falla al FINAL. Una ejecución de 20 épocas con 70 cajas
  tardó 31 minutos; con 117 se va a los 50, y los pesos se suben cuando termina — así que
  un 401 tira a la basura una hora de máquina justo al guardar el resultado.

`urllib` y no `httpx`, como en el resto de estos guiones: tienen que poder correr en una
máquina que solo tenga Python, sin las dependencias del backend.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from typing import Any

#: Cuánto antes de que caduque se pide uno nuevo. Un minuto no basta: entre que se
#: comprueba y se manda la petición puede haber una subida de varios megas, y el reloj de
#: esta máquina no tiene por qué coincidir con el del servidor.
MARGEN_RENOVACION_S = 120


def login(base: str, email: str, password: str) -> dict[str, Any]:
    """Entra con contraseña. Devuelve el juego ENTERO de tokens.

    No solo el de acceso: sin el de refresco no hay forma de renovar sin volver a pedir la
    contraseña, y sin `expires_at` no se sabe cuándo hacerlo.
    """
    if not base.startswith(("http://", "https://")):
        msg = f"la url de la API tiene que ser http o https, no {base.split(':', 1)[0]!r}"
        raise ValueError(msg)
    req = urllib.request.Request(
        f"{base.rstrip('/')}/v1/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return dict(json.load(r)["data"])


def refrescar(base: str, refresh_token: str) -> dict[str, Any]:
    """Rota la sesión. Devuelve el juego entero, porque el de refresco TAMBIÉN cambia.

    Guardarse el viejo dejaría al guion sin poder renovar la siguiente vez: el mismo fallo
    de siempre, una hora más tarde.
    """
    req = urllib.request.Request(
        f"{base.rstrip('/')}/v1/auth/refresh",
        data=json.dumps({"refresh_token": refresh_token}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return dict(json.load(r)["data"])


class Sesion:
    """El token de la API y cómo conseguir otro cuando caduque.

    ── SE RENUEVA ANTES, Y ADEMÁS SE REINTENTA ───────────────────────────────────

    Lo normal es renovar por adelantado mirando `expires_at`. El reintento ante un 401 es
    la red de seguridad para lo que el reloj no cubre: desfase entre máquinas, o una sesión
    invalidada desde el otro lado.

    ── Y HAY DOS CAMINOS, PORQUE EL REFRESCO ROTA ────────────────────────────────

    `/auth/refresh` rota el token: el viejo deja de valer en cuanto se usa. Si un refresco
    se queda a medias —proceso muerto, red cortada— el guardado ya no sirve y refrescar
    otra vez falla para siempre. Por eso existe el respaldo: volver a entrar con la
    contraseña, que no depende de ningún estado anterior.
    """

    def __init__(self, base: str, email: str, password: str) -> None:
        self._base = base.rstrip("/")
        self._email = email
        self._password = password
        self._lock = threading.Lock()
        self._token = ""
        self._refresh = ""
        self._caduca = 0.0
        #: Cambia con cada token nuevo. Es lo que permite que dos hilos que fallan a la vez
        #: no pidan dos renovaciones: el segundo ve que el token ya cambió y reintenta con
        #: el nuevo en vez de rotar otra vez —y rotar dos veces invalida al primero—.
        self.generacion = 0
        self._entrar()

    @property
    def token(self) -> str:
        return self._token

    def _guardar(self, datos: dict[str, Any]) -> None:
        self._token = str(datos["access_token"])
        self._refresh = str(datos.get("refresh_token") or "")
        # `expires_at` es absoluto y en segundos; si no viniera, sale de `expires_in`.
        caduca = datos.get("expires_at")
        self._caduca = (
            float(caduca) if caduca else time.time() + float(datos.get("expires_in") or 3600)
        )
        self.generacion += 1

    def _entrar(self) -> None:
        self._guardar(login(self._base, self._email, self._password))

    def _refrescar(self) -> None:
        if not self._refresh:
            self._entrar()
            return
        try:
            self._guardar(refrescar(self._base, self._refresh))
        except Exception as exc:
            #  Se dice, y se entra por la puerta grande. Callarlo dejaría un proceso que
            #  parece sano y se cae dentro de una hora por la misma razón.
            print(f"  sesion: el refresco fallo ({exc}); entrando de nuevo", flush=True)
            self._entrar()

    def renovar(self, generacion_vista: int) -> str:
        """Un token nuevo. `generacion_vista` es la del que falló.

        Si otro hilo ya renovó mientras este esperaba el cerrojo, no se rota otra vez: se
        devuelve el que hay. Rotar dos veces invalidaría el que el otro hilo acaba de
        recibir, y entonces los dos se quedarían fuera.
        """
        with self._lock:
            if self.generacion == generacion_vista:
                self._refrescar()
            return self._token

    def vigente(self) -> str:
        """El token, renovado por adelantado si le queda poco."""
        with self._lock:
            if time.time() >= self._caduca - MARGEN_RENOVACION_S:
                self._refrescar()
            return self._token
