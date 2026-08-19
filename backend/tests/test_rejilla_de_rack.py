"""DE DOS VIGAS A UN HUECO, Y DE UN HUECO A «ESTA VACIO».

── QUE SE PROTEGE AQUI ─────────────────────────────────────────────────────────────

Lo primero, un modo de fallo que no daria ningun error y arruinaria un inventario: con el
dron PARADO no hay paralaje, todas las regiones dan flujo bajo, y un rack lleno saldria
entero como huecos vacios. Con toda la confianza y sin una linea en ningun log.

Por eso la primera comprobacion de `clasificar_celda` es el movimiento y no el dato, y por
eso la primera prueba de este archivo es esa.

Lo segundo, que la rejilla no invente huecos. El detector propone a veces dos cajas sobre
la misma viga, y dos largueros a la misma altura encierran una franja de pocos pixeles que
no es un hueco. Contarla añadiria un hueco vacio fantasma por cada viga vista dos veces.

Los umbrales salen de 36 anotaciones reales cruzadas con el flujo de su fotograma. Estan
en la cabecera del modulo que se prueba.
"""

from __future__ import annotations

from olo.domain.perception.rejilla import (
    MOVIMIENTO_MINIMO_PX,
    UMBRAL_FLUJO_VACIO,
    Caja,
    celdas_de_rejilla,
    clasificar_celda,
    slots_de_celda,
)

#  Dos largueros y tres parales: la forma tipica de un tramo con dos huecos.
LARGUEROS = [Caja(0.1, 0.30, 0.9, 0.33), Caja(0.1, 0.70, 0.9, 0.73)]
PARALES = [Caja(0.10, 0.2, 0.13, 0.8), Caja(0.48, 0.2, 0.51, 0.8), Caja(0.86, 0.2, 0.89, 0.8)]

#  Los valores MEDIDOS: la mediana de los vacios y la de los llenos.
FLUJO_VACIO = 0.268
FLUJO_LLENO = 1.007
MOVIMIENTO_NORMAL = 4.8


def test_el_dron_parado_no_decide_nada():
    """El modo de fallo que este modulo existe para impedir. Ver la cabecera.

    Sin movimiento el flujo de TODO es bajo, asi que la regla «bajo = vacio» convertiria un
    rack lleno en un rack vacio. Y la confianza tiene que ser cero: un `sin_decidir` con
    confianza alta se colaria igual en cualquier recuento.
    """
    v = clasificar_celda(
        Caja(0.5, 0.3, 0.9, 0.7),
        flujo_relativo=0.05,
        movimiento_del_fotograma=0.1,
        pallets=[],
    )
    assert v.estado == "sin_decidir"
    assert v.confianza == 0.0
    assert "no se mueve" in v.motivo or "apenas se mueve" in v.motivo


def test_el_movimiento_se_comprueba_antes_que_el_flujo():
    """Y el orden importa: con el dron parado, un flujo bajisimo NO es un vacio.

    Si alguien reordena las comprobaciones, esta prueba es lo unico que lo para — y el
    sintoma sin ella seria un almacen que se declara vacio cuando el dron se detiene—.
    """
    quieto = clasificar_celda(
        Caja(0.5, 0.3, 0.9, 0.7),
        flujo_relativo=0.1,
        movimiento_del_fotograma=MOVIMIENTO_MINIMO_PX / 2,
        pallets=[],
    )
    moviendose = clasificar_celda(
        Caja(0.5, 0.3, 0.9, 0.7),
        flujo_relativo=0.1,
        movimiento_del_fotograma=MOVIMIENTO_NORMAL,
        pallets=[],
    )
    assert quieto.estado == "sin_decidir"
    assert moviendose.estado == "vacio"


def test_el_caso_real_del_fotograma_2085():
    """Izquierda con pallet, derecha vacia. Los dos valores salen de la misma imagen."""
    celdas = celdas_de_rejilla(LARGUEROS, PARALES)
    assert len(celdas) == 2
    izquierda, derecha = celdas

    pallet = Caja(0.18, 0.34, 0.47, 0.82)
    v_izq = clasificar_celda(
        izquierda,
        flujo_relativo=FLUJO_LLENO,
        movimiento_del_fotograma=MOVIMIENTO_NORMAL,
        pallets=[pallet],
    )
    v_der = clasificar_celda(
        derecha,
        flujo_relativo=FLUJO_VACIO,
        movimiento_del_fotograma=MOVIMIENTO_NORMAL,
        pallets=[pallet],
    )
    assert v_izq.estado == "lleno"
    assert v_der.estado == "vacio"


def test_un_pallet_detectado_manda_sobre_el_flujo():
    """Si el detector vio carga ahi, esta llena. No hay nada que deducir, y deducir lo
    contrario sobre una deteccion real seria contradecir el dato con una inferencia."""
    celda = Caja(0.5, 0.3, 0.9, 0.7)
    v = clasificar_celda(
        celda,
        #  Un flujo que POR SI SOLO diria «vacio».
        flujo_relativo=0.2,
        movimiento_del_fotograma=MOVIMIENTO_NORMAL,
        pallets=[Caja(0.55, 0.35, 0.85, 0.65)],
    )
    assert v.estado == "lleno"
    assert v.confianza == 1.0


def test_un_pallet_que_solo_roza_la_celda_no_la_llena():
    """Un pallet que sobresale y pisa el borde del hueco de al lado no lo ocupa. Sin este
    umbral, una tarima ancha marcaria como llenos los dos huecos vecinos."""
    celda = Caja(0.5, 0.3, 0.9, 0.7)
    #  Un pallet en la celda de al lado que solo entra un poco.
    v = clasificar_celda(
        celda,
        flujo_relativo=FLUJO_VACIO,
        movimiento_del_fotograma=MOVIMIENTO_NORMAL,
        pallets=[Caja(0.20, 0.35, 0.53, 0.65)],
    )
    assert v.estado == "vacio"


def test_la_confianza_baja_cuando_el_caso_esta_al_borde():
    """Lo que casi empata no se puede afirmar con la misma fuerza que lo que separa con
    holgura, porque quien revise decide por ese numero a que mirar primero."""
    holgado = clasificar_celda(
        Caja(0.5, 0.3, 0.9, 0.7),
        flujo_relativo=0.2,
        movimiento_del_fotograma=MOVIMIENTO_NORMAL,
        pallets=[],
    )
    justo = clasificar_celda(
        Caja(0.5, 0.3, 0.9, 0.7),
        flujo_relativo=UMBRAL_FLUJO_VACIO - 0.01,
        movimiento_del_fotograma=MOVIMIENTO_NORMAL,
        pallets=[],
    )
    assert holgado.confianza > justo.confianza
    assert justo.confianza < 0.6


def test_la_rejilla_no_inventa_huecos_con_vigas_repetidas():
    """El detector propone a veces dos cajas sobre la misma viga. Dos largueros a la misma
    altura encierran una franja de pocos pixeles donde no cabe nada, y contarla añadiria un
    hueco vacio fantasma por cada viga vista dos veces."""
    repetidos = [*LARGUEROS, Caja(0.1, 0.305, 0.9, 0.335)]
    assert len(celdas_de_rejilla(repetidos, PARALES)) == len(
        celdas_de_rejilla(LARGUEROS, PARALES)
    )


def test_sin_dos_vigas_de_cada_no_hay_rejilla():
    """Y devuelve vacio, que es «no lo se», no «no hay huecos». Con un solo larguero no hay
    nivel que cerrar por arriba y por abajo."""
    assert celdas_de_rejilla(LARGUEROS[:1], PARALES) == []
    assert celdas_de_rejilla(LARGUEROS, PARALES[:1]) == []
    assert celdas_de_rejilla([], []) == []


def test_la_celda_sale_del_centro_de_las_vigas():
    """Una viga tiene grosor. Tomando bordes, la celda se queda corta o larga segun de que
    lado se mire, y el pallet que esta dentro aparece medio fuera."""
    celdas = celdas_de_rejilla(LARGUEROS, PARALES)
    #  Centros: y = 0,315 y 0,715; x = 0,115, 0,495 y 0,875.
    assert abs(celdas[0].y1 - 0.315) < 1e-6
    assert abs(celdas[0].y2 - 0.715) < 1e-6
    assert abs(celdas[0].x1 - 0.115) < 1e-6


def test_el_solape_se_mide_contra_el_pallet_y_no_contra_la_union():
    """Un pallet pequeño DENTRO de una celda grande esta dentro. Midiendo contra la union
    daria un valor bajo y contestaria que no, dejando por vacio un hueco ocupado."""
    celda = Caja(0.0, 0.0, 1.0, 1.0)
    pequenyo = Caja(0.4, 0.4, 0.5, 0.5)
    assert celda.solape(pequenyo) == 1.0


# ═══════════════════════════════════════════════════════════════════════════════════════
# LAS POSICIONES DENTRO DE UN HUECO
#
# El error que costo una vuelta entera, y que solo aparecio al probar con datos de verdad:
# un hueco de rack selectivo NO tiene ningun poste entre sus dos posiciones. Los parales
# delimitan la UBICACION y las dos tarimas se reparten ese espacio sin nada estructural
# entre ellas.
#
# Medido sobre el fotograma 2400: parales en 0,159 y 0,821 —casi todo el ancho— con un hueco
# vacio en 0,313 y un pallet en 0,639 DENTRO de la misma celda. Sin dividir, el pallet la
# marcaba llena y el hueco vacio desaparecia: se dedujeron 0 de 3.
# ═══════════════════════════════════════════════════════════════════════════════════════


def test_una_celda_se_divide_en_sus_posiciones():
    celda = Caja(0.159, 0.2, 0.821, 0.97)
    izq, der = slots_de_celda(celda, 2)
    assert abs(izq.x1 - 0.159) < 1e-9
    assert abs(izq.x2 - der.x1) < 1e-9
    assert abs(der.x2 - 0.821) < 1e-9
    #  El alto no se toca: las posiciones se reparten a lo ANCHO.
    assert izq.y1 == der.y1 == celda.y1
    assert izq.y2 == der.y2 == celda.y2


def test_el_caso_del_fotograma_2400_que_fallaba():
    """La regresion concreta. Con los numeros reales: el pallet de la derecha ya no puede
    marcar como llena la posicion de la izquierda, que es la que esta vacia."""
    celda = Caja(0.159, 0.206, 0.821, 0.967)
    pallet = Caja(0.639 - 0.305 / 2, 0.696 - 0.574 / 2, 0.639 + 0.305 / 2, 0.696 + 0.574 / 2)
    izq, der = slots_de_celda(celda)

    v_izq = clasificar_celda(
        izq, flujo_relativo=0.25, movimiento_del_fotograma=4.8, pallets=[pallet]
    )
    v_der = clasificar_celda(
        der, flujo_relativo=1.0, movimiento_del_fotograma=4.8, pallets=[pallet]
    )
    assert v_izq.estado == "vacio"
    assert v_der.estado == "lleno"

    #  Y sin dividir, el fallo original: una sola celda que el pallet marca llena.
    entera = clasificar_celda(
        celda, flujo_relativo=0.25, movimiento_del_fotograma=4.8, pallets=[pallet]
    )
    assert entera.estado == "lleno"


def test_pedir_una_sola_posicion_devuelve_la_celda_entera():
    #  Hay racks de una tarima por hueco. No se parte nada.
    celda = Caja(0.1, 0.2, 0.9, 0.8)
    assert slots_de_celda(celda, 1) == [celda]
    assert slots_de_celda(celda, 0) == [celda]
