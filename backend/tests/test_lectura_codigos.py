"""La regla de qué código ubica y qué código no.

── POR QUE ESTO NO PUEDE QUEDAR SIN PRUEBA ─────────────────────────────────────────

Porque un fallo aquí produce datos que PARECEN buenos. `RCL51-C020` es un cuerpo de
estantería —en el WMS el operador elige el nivel a mano— así que tomarlo por una ubicación
no da un error: da un inventario que dice saber en qué hueco está un pallet cuando solo
sabe la columna. Eso no lo detecta nadie mirando la pantalla.

La regla la decidió el almacén, no la visión: solo cuenta el código completo —rack, cuerpo,
nivel y posición— que es el que van a llevar las etiquetas nuevas.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from inferir import (  # noqa: E402
    CLASE_ILEGIBLE,
    CLASES_DE_UBICACION,
    SEGMENTOS_UBICACION,
    es_ubicacion_completa,
)


# ── Lo que SÍ ubica ────────────────────────────────────────────────────────
def test_el_codigo_completo_ubica():
    """Rack, cuerpo, nivel y posición: el de las etiquetas nuevas."""
    assert es_ubicacion_completa("RCL51-C020-N01-2")


def test_da_igual_el_formato_del_rack():
    """Se cuentan segmentos, no se valida cada uno.

    A propósito: el formato del rack cambia entre almacenes, y una expresión regular
    ajustada a `RCL` rechazaría el almacén siguiente. Lo que no cambia es que una ubicación
    completa baja cuatro niveles.
    """
    assert es_ubicacion_completa("A1-B2-C3-D4")
    assert es_ubicacion_completa("PASILLO7-C100-N05-1")


def test_mas_segmentos_de_los_necesarios_sigue_ubicando():
    """Un almacén con un nivel más de jerarquía no deja de ubicar por eso."""
    assert es_ubicacion_completa("SITIO-RCL51-C020-N01-2")


# ── Lo que NO ubica ────────────────────────────────────────────────────────
def test_el_cuerpo_solo_no_ubica():
    """El caso que motivó la regla: `RCL51-C020` es una altura, no un hueco."""
    assert not es_ubicacion_completa("RCL51-C020")


def test_el_rack_solo_no_ubica():
    assert not es_ubicacion_completa("RCL51")


def test_sin_codigo_no_ubica():
    """Nada leído no es lo mismo que algo leído: los dos casos dan `False`, pero por
    razones distintas — y quien llama tiene que poder pasar `None` sin comprobarlo."""
    assert not es_ubicacion_completa(None)
    assert not es_ubicacion_completa("")
    assert not es_ubicacion_completa("   ")


def test_los_guiones_sueltos_no_cuentan_como_segmentos():
    """`RCL51--C020` tiene tres trozos al partir y solo dos con contenido.

    Sin filtrar los vacíos, un guion doble —o uno final— colaría un código incompleto como
    si tuviera los cuatro niveles.
    """
    assert not es_ubicacion_completa("RCL51--C020")
    assert not es_ubicacion_completa("RCL51-C020-")
    assert not es_ubicacion_completa("-RCL51-C020-")


def test_un_codigo_de_pallet_no_es_una_ubicacion():
    """El código de un pallet no lleva guiones: no puede confundirse con un hueco."""
    assert not es_ubicacion_completa("22C0005993390")


# ── Las constantes de la regla ─────────────────────────────────────────────
def test_solo_qr_ubicacion_nombra_una_ubicacion():
    """Si esto cambiara sin querer, el texto de un pallet acabaría promovido como hueco."""
    assert CLASES_DE_UBICACION == frozenset({"qr_ubicacion"})


def test_la_clase_de_descarte_es_una_del_vocabulario():
    """`etiqueta_ilegible` existe en el modelo. Reclasificar a una clase inventada haría
    que el backend rechazara el lote entero por vocabulario desconocido."""
    assert CLASE_ILEGIBLE == "etiqueta_ilegible"


def test_una_ubicacion_completa_son_cuatro_niveles():
    assert SEGMENTOS_UBICACION == 4
