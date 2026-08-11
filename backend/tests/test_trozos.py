"""La rejilla de trozos y la fusión de repetidas.

── POR QUE ESTO TIENE PRUEBA Y EL RESTO DEL WORKER NO ──────────────────────────────

Porque un fallo de coordenadas aquí NO se nota. El análisis termina, el recuento cuadra, la
pantalla dibuja cajas — solo que en el sitio equivocado. Ya pasó dos veces con la capa de
detecciones del reproductor: primero emparejando por número de fotograma en vez de por
tiempo, y luego normalizando contra el contenedor en vez de contra el fotograma. Las dos
veces «funcionaba» y las dos veces mentía.

Las funciones son puras a propósito: cortar y fusionar no necesitan ni modelo ni vídeo, así
que se pueden comprobar con aritmética.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from inferir import SOLAPE_TROZOS, _fusionar, _iou, _rejilla  # noqa: E402


def _caja(x: float, y: float, w: float, h: float, clase: str = "qr_pallet", conf: float = 0.9):
    return {
        "class_name": clase,
        "confidence": conf,
        "bbox_x": x,
        "bbox_y": y,
        "bbox_width": w,
        "bbox_height": h,
    }


# ── La rejilla ─────────────────────────────────────────────────────────────
def test_la_rejilla_cubre_el_fotograma_entero():
    """Ni un píxel fuera de algún trozo: lo que no se analiza no se detecta."""
    ancho, alto, lado = 2160, 3840, 736
    trozos = _rejilla(ancho, alto, lado, SOLAPE_TROZOS)

    # Se recorre en pasos gruesos —comprobar 8 millones de píxeles no añade nada— pero
    # incluyendo los bordes, que es justo donde el redondeo del paso deja huecos.
    for x in [0, 1, ancho // 3, ancho // 2, ancho - 2, ancho - 1]:
        for y in [0, 1, alto // 3, alto // 2, alto - 2, alto - 1]:
            assert any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in trozos), (
                f"el punto ({x}, {y}) no cae en ningún trozo"
            )


def test_los_trozos_no_se_salen_del_fotograma():
    """Un trozo que sobresale daría franjas negras que el modelo interpreta como imagen."""
    ancho, alto = 1080, 1920
    for x0, y0, x1, y1 in _rejilla(ancho, alto, 736, SOLAPE_TROZOS):
        assert 0 <= x0 < x1 <= ancho
        assert 0 <= y0 < y1 <= alto


def test_los_trozos_se_solapan_lo_declarado():
    """Sin solape real, un objeto sobre una junta queda partido y no se parece a nada."""
    trozos = _rejilla(2160, 3840, 736, SOLAPE_TROZOS)
    # Dos trozos contiguos en horizontal: el segundo empieza antes de que acabe el primero.
    fila = sorted({(x0, x1) for x0, _, x1, _ in trozos})
    assert len(fila) >= 2, "con 2160 px de ancho y trozos de 736 tiene que haber varias columnas"
    (a0, a1), (b0, _) = fila[0], fila[1]
    assert b0 < a1, "los trozos contiguos no se solapan"
    assert a1 - b0 >= 736 * SOLAPE_TROZOS * 0.9


def test_un_fotograma_mas_pequeno_que_el_trozo_da_un_solo_trozo():
    """Y del tamaño del fotograma, no del trozo: recortar más allá del borde no existe."""
    trozos = _rejilla(400, 300, 736, SOLAPE_TROZOS)
    assert trozos == [(0, 0, 400, 300)]


def test_un_lado_no_positivo_se_rechaza():
    with pytest.raises(ValueError, match="positivo"):
        _rejilla(100, 100, 0, SOLAPE_TROZOS)


# ── La fusión ──────────────────────────────────────────────────────────────
def test_dos_cajas_iguales_se_quedan_en_una():
    """Es el caso que produce el solape: el mismo objeto visto por dos trozos."""
    fusionadas = _fusionar([_caja(0.1, 0.1, 0.2, 0.2, conf=0.7), _caja(0.1, 0.1, 0.2, 0.2, conf=0.9)])
    assert len(fusionadas) == 1
    #  Se conserva la de MÁS confianza: es la del trozo donde el objeto estaba mejor
    #  centrado, no la del que solo pilló un borde.
    assert fusionadas[0]["confidence"] == 0.9


def test_dos_objetos_distintos_sobreviven_los_dos():
    lejos = [_caja(0.05, 0.05, 0.1, 0.1), _caja(0.7, 0.8, 0.1, 0.1)]
    assert len(_fusionar(lejos)) == 2


def test_clases_distintas_no_se_fusionan_aunque_se_solapen():
    """Un pallet y el código pegado a él se solapan casi del todo y son dos cosas."""
    juntas = [
        _caja(0.1, 0.1, 0.5, 0.5, clase="pallet"),
        _caja(0.1, 0.1, 0.5, 0.5, clase="qr_pallet"),
    ]
    assert len(_fusionar(juntas)) == 2


def test_el_iou_de_cajas_disjuntas_es_cero():
    assert _iou(_caja(0, 0, 0.1, 0.1), _caja(0.5, 0.5, 0.1, 0.1)) == 0.0


def test_el_iou_de_la_misma_caja_es_uno():
    a = _caja(0.2, 0.3, 0.4, 0.1)
    assert _iou(a, a) == pytest.approx(1.0)


def test_un_solape_parcial_por_debajo_del_umbral_no_fusiona():
    """Dos pallets contiguos en una estantería se tocan y NO son el mismo pallet."""
    # Solapan una cuarta parte: IoU = 0.25/1.75 ≈ 0.14, por debajo de 0.5.
    a = _caja(0.0, 0.0, 1.0, 0.5, clase="pallet")
    b = _caja(0.0, 0.25, 1.0, 0.5, clase="pallet")
    assert _iou(a, b) < 0.5
    assert len(_fusionar([a, b])) == 2
