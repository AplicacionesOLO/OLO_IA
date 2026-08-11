"""El puente de detecciones a lecturas: formas de código y agrupamiento en escenas.

── POR QUE ESTO NECESITA PRUEBAS Y NO SOLO REVISION ────────────────────────────────

Porque los dos fallos que tenía producían datos que PARECÍAN buenos:

  · el ruido del OCR —`1 1 W`, `2 2 7`, `5`— entraba como código de hueco LEÍDO. Medido
    sobre un recorrido real: 40 de 80 lecturas afirmaban haber leído un hueco inexistente,
    y `v_reconciliation` las clasificaba con toda seriedad.
  · el agrupamiento por salto de tiempo encadenaba TODO en una escena: a 10 fotogramas por
    segundo los saltos son de 100 ms, siempre bajo el umbral, así que 124 detecciones
    produjeron 2 lecturas. Un recorrido entero atribuido a un hueco.

Ninguno de los dos se ve mirando la pantalla: sale un número, y el número está mal.
"""

from __future__ import annotations

from olo.domain.perception.lectura import (
    VENTANA_ESCENA_MS,
    convertir,
    es_codigo_de_pallet,
    es_codigo_de_ubicacion,
)

CLASE_UBI = "qr_ubicacion"
CLASE_PAL = "qr_pallet"
CLASE_BULTO = "pallet"
CLASE_VACIO = "hueco_vacio"


def det(clase: str, ms: int, texto: str | None = None, conf: float = 0.8, fotograma: int = 0):
    return {
        "class_name": clase,
        "frame_ms": ms,
        "frame_number": fotograma or ms // 100,
        "confidence": conf,
        "text_value": texto,
        "bbox_x": 0.1,
        "bbox_y": 0.1,
        "bbox_width": 0.2,
        "bbox_height": 0.2,
        "observed_at": "2026-08-11T10:00:00Z",
    }


# ── Las formas ─────────────────────────────────────────────────────────────
def test_una_ubicacion_completa_se_reconoce():
    assert es_codigo_de_ubicacion("RCL47-C018-N01-2")


def test_el_cuerpo_solo_no_es_una_ubicacion():
    """`RCL51-C020` es una altura y en el WMS el nivel lo elige el operador."""
    assert not es_codigo_de_ubicacion("RCL51-C020")


def test_el_ruido_del_ocr_no_es_ningun_codigo():
    """Los tres salieron de un recorrido real y los tres entraban como código leído."""
    for basura in ("1 1 W", "2 2 7", "5", "5,5 EX 1 COS 5"):
        assert not es_codigo_de_ubicacion(basura)
        assert not es_codigo_de_pallet(basura)


def test_los_codigos_de_pallet_de_este_almacen():
    for bueno in ("22O0010471953", "22C0005993390", "22A0001234567"):
        assert es_codigo_de_pallet(bueno)


def test_una_ubicacion_nunca_es_un_codigo_de_pallet():
    """El caso medido: una anotación marcada `qr_pallet` era una etiqueta de hueco."""
    assert not es_codigo_de_pallet("RCL47-C018-N01-2")


def test_el_patron_de_pallet_es_configurable():
    """Otra empresa, otra serie. Con el patrón por omisión, `AB-123` no pasa; con el suyo sí
    — salvo el guion, que sigue delatando una ubicación."""
    assert not es_codigo_de_pallet("PAL0099887")
    assert es_codigo_de_pallet("PAL0099887", patron=r"^PAL[0-9]{7}$")


def test_un_patron_roto_no_tumba_la_lectura():
    """Una expresión mal escrita en la configuración cae al patrón de omisión en vez de
    reventar la reconciliación entera."""
    assert es_codigo_de_pallet("22O0010471953", patron="(sin cerrar")


# ── Las escenas ────────────────────────────────────────────────────────────
def test_la_cadena_completa_da_una_lectura_identificada():
    """Ubicación, luego pallet, luego su QR: el caso que da valor al módulo.

    Las tres en fotogramas DISTINTOS a propósito: con la cámara barriendo, así llegan.
    """
    r = convertir([
        det(CLASE_UBI, 0, "RCL47-C018-N01-2"),
        det(CLASE_BULTO, 300),
        det(CLASE_PAL, 600, "22O0010471953"),
    ])
    assert len(r.lecturas) == 1
    lec = r.lecturas[0]
    assert lec.location_qr == "read"
    assert lec.location_code_observed == "RCL47-C018-N01-2"
    assert lec.content == "pallet"
    assert lec.pallet_qr == "read"
    assert lec.pallet_code_observed == "22O0010471953"


def test_dos_ubicaciones_distintas_son_dos_escenas():
    """El corte lo marca el código, que es el ancla del recorrido."""
    r = convertir([
        det(CLASE_UBI, 0, "RCL47-C018-N01-2"),
        det(CLASE_BULTO, 200),
        det(CLASE_UBI, 400, "RCL47-C019-N01-2"),
        det(CLASE_BULTO, 600),
    ])
    assert len(r.lecturas) == 2
    assert [x.location_code_observed for x in r.lecturas] == [
        "RCL47-C018-N01-2",
        "RCL47-C019-N01-2",
    ]


def test_detecciones_seguidas_no_se_encadenan_sin_fin():
    """El fallo medido: a 10 fps los saltos son de 100 ms y TODO caía en una escena.

    Veinte segundos de detecciones cada 100 ms tienen que dar varias escenas, no una.
    """
    seguidas = [det(CLASE_BULTO, ms) for ms in range(0, 20_000, 100)]
    r = convertir(seguidas)
    assert len(r.lecturas) >= 20_000 // VENTANA_ESCENA_MS


def test_el_hueco_vacio_no_es_lo_mismo_que_no_haber_visto():
    """La distinción que pidió el almacén, y la que más valor tiene.

    `empty` se puede contrastar con el WMS; `unknown` no dice nada del almacén, solo de la
    grabación. Meterlos en el mismo cubo convertiría un no-dato en un dato.
    """
    vacio = convertir([det(CLASE_UBI, 0, "RCL47-C018-N01-2"), det(CLASE_VACIO, 100)])
    assert vacio.lecturas[0].content == "empty"
    assert vacio.lecturas[0].pallet_qr == "absent"

    sin_ver = convertir([det(CLASE_UBI, 0, "RCL47-C018-N01-2")])
    assert sin_ver.lecturas[0].content == "unknown"
    assert sin_ver.lecturas[0].pallet_qr == "not_attempted"


def test_pallet_sin_identidad_no_inventa_una():
    """Hay bulto y su etiqueta no se leyó: `object_no_qr`, no `pallet`."""
    r = convertir([det(CLASE_UBI, 0, "RCL47-C018-N01-2"), det(CLASE_BULTO, 100)])
    assert r.lecturas[0].content == "object_no_qr"
    assert r.lecturas[0].pallet_code_observed is None


def test_el_ruido_no_se_guarda_como_codigo_y_se_cuenta():
    """Un texto sin forma de código deja la etiqueta como ILEGIBLE, no como leída."""
    r = convertir([det(CLASE_UBI, 0, "1 1 W"), det(CLASE_BULTO, 100)])
    lec = r.lecturas[0]
    assert lec.location_qr == "unreadable"
    assert lec.location_code_observed is None
    assert r.textos_descartados >= 1


def test_una_ubicacion_leida_en_una_caja_de_pallet_sigue_ubicando():
    """El modelo confunde la clase; la forma del código no.

    Se midió: una etiqueta de hueco anotada como `qr_pallet`. Tirar esa lectura sería
    perder una atribución buena por un error de clase.
    """
    r = convertir([det(CLASE_PAL, 0, "RCL47-C018-N01-2"), det(CLASE_BULTO, 100)])
    assert r.lecturas[0].location_code_observed == "RCL47-C018-N01-2"
    assert r.lecturas[0].location_qr == "read"
    assert r.lecturas[0].pallet_code_observed is None
