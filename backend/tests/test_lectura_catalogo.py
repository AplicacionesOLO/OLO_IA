"""Una etiqueta que el catálogo no tiene no puede robarle la escena a una que sí.

── DE DÓNDE SALE ESTE ARCHIVO ──────────────────────────────────────────────────────

De un recorrido real, `dataset7`, y de la verdad de campo que dio el almacén: el pallet
`22O0010471953` está en `RCL47-C018-N01-2`. El sistema lo colgaba de `RACK26-C036-N01-1`,
una etiqueta que se lee perfectamente y que NO existe ni en las 29.310 ubicaciones del
catálogo ni en las 41.055 filas del corte del WMS.

Y no era un fallo de lectura: `RACK26` se leyó bien, tres veces, en dos momentos distintos
del mismo vídeo. Era la regla de arrastre haciendo su trabajo con un dato envenenado —la
etiqueta salió 0,4 s antes que el pallet, así que se quedó con él—.

El resultado en pantalla era «nada que comparar»: el pallet desaparecía de la comparación
con el WMS, que es exactamente para lo que sirve el producto.
"""

from __future__ import annotations

from olo.domain.perception.lectura import convertir

UBI = "qr_ubicacion"
PAL = "pallet"
QRPAL = "qr_pallet"

#: Lo que el catálogo de este almacén conoce. `RACK26-C036-N01-1` NO está, y ese es el caso.
CATALOGO = frozenset({
    "RCL47-C018-N01-1",
    "RCL47-C018-N01-2",
    "RCL47-C019-N01-1",
    "RCL47-C019-N01-2",
})


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
        "observed_at": "2026-08-12T10:00:00Z",
    }


def cronologia_dataset7() -> list[dict]:
    """La cronología medida, con los tiempos reales del vídeo."""
    d = []
    #  0,0 a 0,4 s · las dos etiquetas del hueco bueno
    for ms in (0, 200, 400):
        d.append(det(UBI, ms, "RCL47-C018-N01-2", y=0.57, h=0.14, conf=0.59))
        d.append(det(UBI, ms, "RCL47-C018-N01-1", y=0.29, h=0.17, conf=0.40))
    #  10,0 s · la etiqueta que el catálogo no conoce
    d.append(det(UBI, 10005, "RACK26-C036-N01-1", y=0.30, h=0.10, conf=0.49))
    d.append(det(UBI, 10205, "RACK26-C036-N01-1", y=0.30, h=0.10, conf=0.43))
    #  10,4 a 11,8 s · el pallet, con su QR leído
    for ms in (10405, 10605, 11206, 11406, 11606, 11806):
        d.append(det(PAL, ms, x=0.15, y=0.15, w=0.6, h=0.7, conf=0.96))
        d.append(det(QRPAL, ms, "22O0010471953", x=0.4, y=0.20, w=0.1, h=0.07, conf=0.7))
    #  13,2 s en adelante · el hueco siguiente, y RACK26 otra vez al lado
    for ms in (13207, 13807, 14407):
        d.append(det(UBI, ms, "RCL47-C019-N01-2", y=0.35, h=0.05, conf=0.55))
        d.append(det(UBI, ms, "RCL47-C019-N01-1", y=0.28, h=0.05, conf=0.45))
    for ms in (13807, 14407):
        d.append(det(UBI, ms, "RACK26-C036-N01-1", y=0.40, h=0.05, conf=0.45))
    return d


def test_el_pallet_va_al_hueco_del_catalogo_y_no_a_la_etiqueta_desconocida():
    """El caso completo, con la verdad de campo que confirmó el almacén."""
    r = convertir(cronologia_dataset7(), ubicaciones_conocidas=CATALOGO)

    conpallet = [x for x in r.lecturas if x.pallet_code_observed == "22O0010471953"]
    assert conpallet, "el pallet tiene que producir su lectura"
    assert conpallet[0].location_code_observed == "RCL47-C018-N01-2"
    #  Y sobre todo: NO al hueco inexistente, que es lo que se veía en pantalla.
    assert all(x.location_code_observed != "RACK26-C036-N01-1" for x in conpallet)


def test_la_etiqueta_desconocida_no_se_tira_se_denuncia():
    """Perder el hallazgo sería cambiar un error por otro.

    Una etiqueta física que ningún sistema del almacén conoce es justo la clase de cosa que
    este producto existe para encontrar. Se saca por separado para que la pantalla la pueda
    decir sin que contamine ninguna atribución.
    """
    r = convertir(cronologia_dataset7(), ubicaciones_conocidas=CATALOGO)
    assert r.ubicaciones_desconocidas == {"RACK26-C036-N01-1"}


def test_sin_catalogo_el_comportamiento_es_el_de_antes():
    """No se inventa que un código sea falso por no poder comprobarlo.

    `ubicaciones_conocidas` a `None` —quien llame sin catálogo a mano, y los cientos de
    pruebas que ya existen— tiene que seguir viendo exactamente lo de siempre.
    """
    r = convertir(cronologia_dataset7())
    assert r.ubicaciones_desconocidas == set()
    conpallet = [x for x in r.lecturas if x.pallet_code_observed == "22O0010471953"]
    assert conpallet[0].location_code_observed == "RACK26-C036-N01-1"


def test_sin_nada_mejor_la_desconocida_sigue_siendo_lo_observado():
    """Si no hay una ubicación real que la tape, el código leído se conserva.

    Es lo que la vista clasifica `location_unknown` desde 0090: «se leyó y el catálogo no lo
    tiene». Convertirlo en «no se pudo leer» sería mandar a repetir una grabación que salió
    perfecta.
    """
    r = convertir(
        [
            det(UBI, 0, "RACK26-C036-N01-1", conf=0.6),
            det(PAL, 200, x=0.2, y=0.1, w=0.5, h=0.6),
        ],
        ubicaciones_conocidas=CATALOGO,
    )
    assert r.lecturas[0].location_code_observed == "RACK26-C036-N01-1"
    assert r.lecturas[0].location_qr == "read"
    assert r.ubicaciones_desconocidas == {"RACK26-C036-N01-1"}


def test_entre_dos_leidas_en_la_misma_escena_gana_la_del_catalogo():
    """Y no la que el modelo puntuó más alto: eso sería jugárselo a la confianza.

    Pasa de verdad —a los 13,8 s las dos se leen en el mismo fotograma— y ahí `RACK26` tenía
    menos confianza. Que saliera bien era suerte, no regla.
    """
    r = convertir(
        [
            det(UBI, 0, "RCL47-C019-N01-2", y=0.35, h=0.05, conf=0.30),
            det(UBI, 0, "RACK26-C036-N01-1", y=0.40, h=0.05, conf=0.90),
        ],
        ubicaciones_conocidas=CATALOGO,
    )
    assert len(r.lecturas) == 1, "las dos etiquetas del mismo fotograma son una escena"
    assert r.lecturas[0].location_code_observed == "RCL47-C019-N01-2"


def test_una_desconocida_no_corta_la_escena_del_hueco_bueno():
    """Si cortara, el contenido filmado después quedaría huérfano de su etiqueta.

    Es el mismo motivo por el que no ancla: dejarla cortar mueve el problema en vez de
    quitarlo.
    """
    r = convertir(
        [
            det(UBI, 0, "RCL47-C018-N01-2", conf=0.6),
            det(UBI, 300, "RACK26-C036-N01-1", conf=0.9),
            det(PAL, 600, x=0.2, y=0.1, w=0.5, h=0.6),
        ],
        ubicaciones_conocidas=CATALOGO,
    )
    assert len(r.lecturas) == 1
    assert r.lecturas[0].location_code_observed == "RCL47-C018-N01-2"
    assert r.lecturas[0].content == "object_no_qr"
