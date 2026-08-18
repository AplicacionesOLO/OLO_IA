"""CUANDO TROCEAR, Y CUANDO LA RESPUESTA ES OTRA.

── QUE SE PROTEGE AQUI ─────────────────────────────────────────────────────────────

Dos cosas que cuestan caro y que un cambio bienintencionado rompe sin que salte nada:

  1. Que el 8K SIGA sin trocearse. Ya funciona —lee entre el 66 y el 84 % de las
     etiquetas— y trocearlo son 104 pasadas del modelo por fotograma: un analisis de
     veinte minutos pasaria a un dia entero para devolver lo mismo. El fallo no daria
     ningun error; solo no terminaria nunca.

  2. Que la decision NO se tome mirando la resolucion. Es la regla que parece obvia y
     esta medida como falsa: el 8K vertical se reduce el DOBLE que el 4K —10,4 veces
     contra 5,2— y aun asi lee mejor, porque sus etiquetas miden 615 px y las del 4K
     199. Lo que manda es la distancia de la camara, no el sensor.

Los umbrales salen de cruzar 703 etiquetas reales con si se pudieron decodificar. Estan
en la cabecera del modulo que se prueba.
"""

from __future__ import annotations

from olo.domain.perception.resolucion import (
    MAXIMO_DE_TROZOS,
    cuantos_trozos,
    decidir_trozos,
)

#  Los cuatro videos analizados hasta hoy, con su mediana de etiqueta MEDIDA.
OCHO_K = {"ancho": 4320, "alto": 7680, "ancho_mediano_etiqueta": 615.0}
CUATRO_K = {"ancho": 3840, "alto": 2160, "ancho_mediano_etiqueta": 199.0}
DOS_K = {"ancho": 1920, "alto": 1080, "ancho_mediano_etiqueta": 100.0}


def test_el_8k_que_ya_funciona_no_se_trocea():
    """La regresión que este archivo existe para impedir. Ver la cabecera."""
    d = decidir_trozos(**OCHO_K)
    assert not d.trocea
    assert "56" in d.motivo or "no aportaria" in d.motivo


def test_el_4k_a_distancia_si_se_trocea():
    d = decidir_trozos(**CUATRO_K)
    assert d.trocea
    assert d.lado == 736


def test_el_2k_tambien_y_ademas_sale_barato():
    #  Menos pixeles es menos trozos: ocho pasadas contra las veintiocho del 4K. Trocear
    #  material pequeño es justo donde mas compensa.
    d = decidir_trozos(**DOS_K)
    assert d.trocea
    assert cuantos_trozos(1920, 1080, 736) < cuantos_trozos(3840, 2160, 736)


def test_la_decision_no_la_toma_la_resolucion():
    """El mismo fotograma de 4K, dos materiales distintos, dos decisiones distintas.

    Si algun dia alguien reescribe esto como `if ancho >= 4320: no trocear`, esta prueba
    es lo unico que lo para — y el sintoma sin ella seria un 4K de cerca troceandose sin
    necesidad, o sea veintiocho veces mas lento para nada—.
    """
    lejos = decidir_trozos(ancho=3840, alto=2160, ancho_mediano_etiqueta=199.0)
    cerca = decidir_trozos(ancho=3840, alto=2160, ancho_mediano_etiqueta=600.0)
    assert lejos.trocea
    assert not cerca.trocea


def test_un_material_carisimo_no_se_trocea_aunque_haga_falta():
    """Y lo DICE. Un 8K con etiquetas pequeñas necesitaria trocearse y no compensa: son
    104 pasadas por fotograma. Callarlo dejaria a alguien esperando un resultado que no
    va a mejorar; decirlo señala lo unico que arregla ese material, que es acercarse."""
    d = decidir_trozos(ancho=4320, alto=7680, ancho_mediano_etiqueta=120.0)
    assert not d.trocea
    assert "no compensa" in d.motivo
    assert str(cuantos_trozos(4320, 7680, 736)) in d.motivo


def test_no_ver_etiquetas_no_es_lo_mismo_que_verlas_pequenas():
    """Sin etiquetas se trocea: no detectar nada es EL sintoma que los trozos atacan.

    Tratarlo como «etiquetas de tamaño cero» daria lo mismo por accidente, pero por el
    camino equivocado: la sonda tambien devuelve nada cuando el fotograma esta vacio, y
    entonces trocear no aporta. Son dos ramas distintas a proposito.
    """
    d = decidir_trozos(ancho=3840, alto=2160, ancho_mediano_etiqueta=None)
    assert d.trocea
    assert "no encontro ninguna etiqueta" in d.motivo


def test_sin_saber_cuanto_mide_el_fotograma_no_se_decide_nada():
    #  Inventar una decision sobre medidas desconocidas es como llegamos al «1 de 1».
    assert not decidir_trozos(ancho=0, alto=0, ancho_mediano_etiqueta=199.0).trocea


def test_el_recuento_de_trozos_cuenta_el_solape():
    """`cuantos_trozos` decide si algo «no compensa», asi que si se queda corto se
    aprobarian analisis del triple de coste del que se creia.

    A ojo, 3840 entre 736 son 5 columnas. Con el solape del 20 % el paso es 588, y salen
    7. La cuenta ingenua se equivocaria en un 40 %.
    """
    assert cuantos_trozos(3840, 2160, 736) == 28
    assert cuantos_trozos(4320, 7680, 736) > MAXIMO_DE_TROZOS
    #  Un fotograma mas pequeño que el trozo es UNA pieza, no cero.
    assert cuantos_trozos(500, 400, 736) == 1


# ═══════════════════════════════════════════════════════════════════════════════════════
# EL DIAGNOSTICO
#
# Lo que este bloque protege es que el aviso NO se ablande. La tentacion, cuando alguien
# vea «no hay ajuste de software que lo recupere», va a ser suavizarlo. Y ese mensaje es
# el resultado de bajar un video, medirlo y cruzar 703 etiquetas: suavizarlo devuelve al
# operador a repetir ese trabajo.
# ═══════════════════════════════════════════════════════════════════════════════════════

from olo.domain.perception.resolucion import diagnosticar, diagnosticar_resumen  # noqa: E402


def test_el_caso_real_del_4k_sale_como_ilegible_y_dice_cuanto_falta():
    d = diagnosticar_resumen(etiquetas=162, leidas=7, ancho_mediano=199.0)
    assert d.veredicto == "ilegible"
    assert d.acercarse == 2.0
    #  Los tres numeros que ahorran el trabajo de detective.
    assert "162" in d.mensaje
    assert "199" in d.mensaje
    assert "400" in d.mensaje


def test_el_aviso_manda_acercarse_y_no_subir_la_resolucion():
    """Medido: el mismo vuelo en 8K habria dejado la etiqueta en 224 px de los 400 que
    hacen falta. Si el mensaje dijera «graba en 8K», el operador gastaria un vuelo entero
    y volveria con el mismo resultado."""
    d = diagnosticar_resumen(etiquetas=162, leidas=7, ancho_mediano=199.0)
    assert "acercar" in d.mensaje.lower()
    assert "8k" not in d.mensaje.lower()


def test_el_material_que_funciona_no_recibe_ningun_reproche():
    #  Un aviso sobre material que va bien entrena a ignorar los avisos.
    d = diagnosticar_resumen(etiquetas=429, leidas=304, ancho_mediano=615.0)
    assert d.veredicto == "bien"
    assert d.acercarse is None


def test_el_termino_medio_existe_y_se_dice_para_que_sirve():
    """A 250 px se lee una de cada tres. Llamarlo «ilegible» tiraria un material que sirve
    para ocupacion; llamarlo «bien» haria confiar en un inventario con dos tercios de
    huecos sin identificar."""
    d = diagnosticar_resumen(etiquetas=100, leidas=31, ancho_mediano=250.0)
    assert d.veredicto == "justo"
    assert "localizar" in d.mensaje


def test_sin_ancho_conocido_no_se_inventa_un_veredicto():
    """El ancho del medio puede faltar —un navegador que no decodifica manda ceros— y un
    veredicto sobre una mediana supuesta seria exactamente el tipo de dato inventado que
    produjo el «1 de 1»."""
    d = diagnosticar_resumen(etiquetas=162, leidas=7, ancho_mediano=None)
    assert d.veredicto == "sin_medida"
    assert d.ancho_mediano is None


def test_no_saber_el_tamano_no_es_no_haber_encontrado_nada():
    """La confusion que este endpoint tuvo el primer dia: devolvia «no se detecto ninguna
    etiqueta» sobre un analisis que habia detectado 162, solo porque faltaba el ancho del
    video. Contestaba otra pregunta, y la contestaba mal.

    Las dos ramas tienen que seguir separadas: una dice «no hay nada que leer» y la otra
    «hay algo y no se puede juzgar», y llevan a acciones distintas.
    """
    sin_nada = diagnosticar_resumen(etiquetas=0, leidas=0, ancho_mediano=None)
    sin_medida = diagnosticar_resumen(etiquetas=162, leidas=7, ancho_mediano=None)
    assert sin_nada.veredicto != sin_medida.veredicto
    assert "162" in sin_medida.mensaje
    assert "ninguna etiqueta" not in sin_medida.mensaje


def test_las_dos_puertas_dan_lo_mismo():
    #  El worker pasa la lista, el backend el resumen. Si divergen, la pantalla y el log
    #  dirian cosas distintas del mismo analisis.
    lista = [(199.0, i < 7) for i in range(162)]
    assert diagnosticar(lista).veredicto == (
        diagnosticar_resumen(etiquetas=162, leidas=7, ancho_mediano=199.0).veredicto
    )
    assert diagnosticar([]).veredicto == "sin_etiquetas"
