"""Cuando la camara ve DOS huecos a la vez.

── POR QUE ESTE CASO EXISTE Y NO ES RARO ───────────────────────────────────────────

En el almacen las etiquetas de los dos slots van una encima de otra en el mismo montante
—`…-N01-1` arriba, `…-N01-2` abajo—, asi que la camara las lee A LA VEZ con mucha
facilidad. Medido en un recorrido real: las dos se decodificaron en los mismos fotogramas.

Cuando eso pasa hay tres respuestas posibles y solo una es honesta:

  · elegir la que se leyo primero → es azar, y produce un inventario que afirma en que hueco
    esta un pallet cuando podia ser el de al lado.
  · atribuir por geometria → correcto cuando los bultos se distinguen.
  · no atribuir y decirlo → lo unico defendible cuando el bulto abarca las dos etiquetas,
    que es exactamente lo que pasa al grabar demasiado cerca.
"""

from __future__ import annotations

from olo.domain.perception.lectura import convertir

UBI = "qr_ubicacion"
PAL = "pallet"
VACIO = "hueco_vacio"


def det(clase, ms, texto=None, x=0.1, y=0.1, w=0.2, h=0.2, conf=0.8):
    return {
        "class_name": clase,
        "frame_ms": ms,
        "frame_number": ms // 100,
        "confidence": conf,
        "text_value": texto,
        "bbox_x": x,
        "bbox_y": y,
        "bbox_width": w,
        "bbox_height": h,
        "observed_at": "2026-08-11T10:00:00Z",
    }


def test_un_bulto_que_abarca_las_dos_etiquetas_no_se_atribuye():
    """El caso medido en `Video10`: la caja del pallet ocupaba el fotograma entero.

    0,71 de ancho por 1,00 de alto, con las dos etiquetas dentro. Decir que el pallet es del
    slot 1 o del 2 seria elegir al azar.
    """
    r = convertir([
        det(UBI, 0, "RCL47-C018-N01-1", x=0.32, y=0.20, w=0.37, h=0.15),
        det(UBI, 100, "RCL47-C018-N01-2", x=0.32, y=0.58, w=0.37, h=0.15),
        det(PAL, 200, x=0.18, y=0.0, w=0.71, h=1.0),
    ])
    assert r.escenas_ambiguas == 1
    lec = r.lecturas[0]
    #  Se conserva que SE VIO una etiqueta —eso es cierto— pero no se afirma contenido.
    assert lec.content == "unknown"
    assert lec.pallet_code_observed is None


def test_dos_bultos_separados_se_atribuyen_a_su_etiqueta():
    """Con campo suficiente, cada bulto esta claramente al lado de una etiqueta."""
    r = convertir([
        det(UBI, 0, "RCL47-C018-N01-1", x=0.05, y=0.20, w=0.10, h=0.08),
        det(UBI, 100, "RCL47-C018-N01-2", x=0.05, y=0.70, w=0.10, h=0.08),
        det(PAL, 200, x=0.30, y=0.62, w=0.30, h=0.25),
    ])
    assert r.escenas_ambiguas == 0
    lec = r.lecturas[0]
    #  El bulto esta a la altura de la etiqueta de abajo, asi que es del slot 2.
    assert lec.location_code_observed == "RCL47-C018-N01-2"
    assert lec.content == "object_no_qr"


def test_una_sola_etiqueta_no_activa_la_desambiguacion():
    """El camino de siempre tiene que seguir igual: sin dos huecos no hay nada que decidir."""
    r = convertir([
        det(UBI, 0, "RCL47-C018-N01-2", x=0.3, y=0.5, w=0.2, h=0.1),
        det(PAL, 100, x=0.1, y=0.0, w=0.8, h=1.0),
    ])
    assert r.escenas_ambiguas == 0
    assert r.lecturas[0].location_code_observed == "RCL47-C018-N01-2"
    assert r.lecturas[0].content == "object_no_qr"


def test_un_hueco_vacio_tambien_se_desambigua():
    """Vale para el contenido, sea un bulto o la ausencia de uno."""
    r = convertir([
        det(UBI, 0, "RCL47-C018-N01-1", x=0.05, y=0.20, w=0.10, h=0.08),
        det(UBI, 100, "RCL47-C018-N01-2", x=0.05, y=0.70, w=0.10, h=0.08),
        det(VACIO, 200, x=0.30, y=0.18, w=0.30, h=0.20),
    ])
    assert r.escenas_ambiguas == 0
    assert r.lecturas[0].location_code_observed == "RCL47-C018-N01-1"
    assert r.lecturas[0].content == "empty"


def test_el_contenido_es_del_hueco_leido_ANTES_no_del_siguiente():
    """El caso que el almacén confirmó, y que el sistema había fallado.

    Cronograma real de `Video10`, con la verdad de campo verificada por quien estaba allí:
    el pallet `22O0010471953` está en `RCL47-C018-N01-2`.

        0,0 a 0,9 s    etiqueta RCL47-C018-N01-2   ← el hueco de verdad
        7,7 a 9,9 s    pallet 22O0010471953
       11,6 a 11,8 s   etiqueta RCL47-C019-N01-2   ← el hueco SIGUIENTE

    La última detección del pallet y la etiqueta de C019 están a 1,7 s: dentro de la ventana
    de escena. El sistema atribuía el pallet a C019 —la etiqueta que vino DESPUÉS— y decía
    con toda seguridad que un pallet estaba en el hueco de al lado.

    El orden del recorrido es el que manda: se encuadra la etiqueta, luego se baja al
    contenido. La ubicación se arrastra hacia DELANTE, nunca hacia atrás.
    """
    detecciones = []
    for ms in range(0, 900, 100):
        detecciones.append(det(UBI, ms, "RCL47-C018-N01-2", x=0.32, y=0.58, w=0.37, h=0.15))
    for ms in range(7700, 9900, 200):
        detecciones.append(det(PAL, ms, x=0.18, y=0.0, w=0.6, h=0.9))
    detecciones.append(det("qr_pallet", 8603, "22O0010471953", x=0.4, y=0.3, w=0.1, h=0.1))
    for ms in (11600, 11700, 11800):
        detecciones.append(det(UBI, ms, "RCL47-C019-N01-2", x=0.46, y=0.47, w=0.2, h=0.1))

    r = convertir(detecciones)
    completas = [
        x for x in r.lecturas if x.location_qr == "read" and x.pallet_qr == "read"
    ]
    assert completas, "la cadena tiene que cerrarse con estos datos"
    assert completas[0].location_code_observed == "RCL47-C018-N01-2"
    assert completas[0].pallet_code_observed == "22O0010471953"
    #  Y NO al hueco siguiente, que es el error que se corrigió.
    assert all(x.location_code_observed != "RCL47-C019-N01-2" for x in completas)


def test_una_ubicacion_caducada_no_se_arrastra():
    """Sin tope, un pallet filmado un minuto después heredaría un hueco que no le toca."""
    r = convertir([
        det(UBI, 0, "RCL47-C018-N01-2"),
        det(PAL, 60_000),
    ])
    lejano = [x for x in r.lecturas if x.content == "object_no_qr"]
    assert lejano, "el bulto tiene que producir su lectura"
    assert lejano[0].location_code_observed is None
    assert lejano[0].location_qr == "not_attempted"
