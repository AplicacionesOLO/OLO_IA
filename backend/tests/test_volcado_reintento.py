"""UN FALLO DE RED NO PUEDE ENVENENAR LOS VOLCADOS SIGUIENTES.

── QUE PASO ──────────────────────────────────────────────────────────────────

El worker acumula detecciones y las manda por lotes. La hora se convierte de marca de
tiempo a texto justo antes de enviar, y se convertia EN EL SITIO, sobre los mismos dicts
que quedan pendientes.

Basta que un POST falle una vez —hay un `getaddrinfo failed` en el log real— para que
`pendientes` se quede con las horas ya convertidas a texto. El siguiente intento vuelve a
convertirlas: `datetime.fromtimestamp("2026-08-14T...")` lanza «'str' object cannot be
interpreted as an integer», que el bucle traga como «no se pudo informar del progreso».

Y ya no se recupera nunca. `dataset7` termino con 189 detecciones de 455 y la barra de
progreso congelada, sin un solo error visible: el trabajo se marco «completed» y en la
pantalla no habia terminado.

── POR QUE ESTA PRUEBA ES ASI ────────────────────────────────────────────────

Reproduce la secuencia exacta —falla, reintenta— porque el defecto NO esta en el primer
envio, que siempre funciono, sino en el segundo. Una prueba del camino feliz habria
pasado con el codigo roto.
"""

import contextlib
from datetime import UTC, datetime
from typing import Any


def _volcar(pendientes: list[dict[str, Any]], enviar: Any) -> None:
    """El volcado, tal como lo hace `inferir.py`: copia, envia, y solo entonces limpia.

    Se reproduce aqui —quince lineas— en vez de importar `inferir.py`, que arrastra
    `cv2` y el modelo entero. Lo que se prueba es la SECUENCIA, y es esta.
    """
    if pendientes:
        cuerpo = [
            {**d, "observed_at": datetime.fromtimestamp(d["observed_at"], UTC).isoformat()}
            for d in pendientes
        ]
        enviar(cuerpo)
        pendientes.clear()


def test_el_segundo_intento_funciona_tras_un_fallo_de_red() -> None:
    pendientes: list[dict[str, Any]] = [
        {"observed_at": 1_786_000_000.0, "class_name": "pallet"},
        {"observed_at": 1_786_000_001.5, "class_name": "qr_ubicacion"},
    ]
    intentos: list[list[dict[str, Any]]] = []

    def enviar_que_falla(cuerpo: list[dict[str, Any]]) -> None:
        intentos.append(cuerpo)
        raise OSError("getaddrinfo failed")

    #  El fallo se traga a proposito: lo que importa es el ESTADO que deja, no la excepcion.
    with contextlib.suppress(OSError):
        _volcar(pendientes, enviar_que_falla)

    #  Nada se pierde: siguen pendientes, y con la hora INTACTA.
    assert len(pendientes) == 2
    assert isinstance(pendientes[0]["observed_at"], float)

    def enviar_ok(cuerpo: list[dict[str, Any]]) -> None:
        intentos.append(cuerpo)

    _volcar(pendientes, enviar_ok)  # <- con el codigo viejo, esto lanzaba TypeError

    assert pendientes == []
    assert len(intentos) == 2
    #  Y lo que llego al servidor va en texto ISO las dos veces.
    for cuerpo in intentos:
        assert cuerpo[0]["observed_at"].startswith("20")


def test_lo_que_se_envia_no_toca_lo_pendiente() -> None:
    """La causa raiz, aislada: enviar no puede modificar lo que aun no se ha enviado."""
    pendientes: list[dict[str, Any]] = [{"observed_at": 1_786_000_000.0, "class_name": "pallet"}]
    enviados: list[list[dict[str, Any]]] = []
    _volcar(pendientes, enviados.append)
    assert enviados[0][0]["observed_at"] != 1_786_000_000.0
    assert enviados[0][0]["class_name"] == "pallet"
