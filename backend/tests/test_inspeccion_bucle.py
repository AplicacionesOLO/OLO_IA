"""El bucle: qué genera trabajo, y qué dice que el trabajo sirvió.

── QUÉ SE PRUEBA AQUÍ Y POR QUÉ ────────────────────────────────────────────────────

Dos reglas que nacieron separadas —una decide qué discrepancias abren incidencia, la otra
si algo se resolvió— y que son la MISMA vista desde dos lados. Separadas fallan así:

    alguien añade un estado a las que abren incidencia
    el clasificador de cambios no lo conoce
    → la incidencia se abre, y al vuelo siguiente la pantalla dice «resuelto»
      de algo que sigue abierto en la bandeja

Nadie ve ese fallo hasta que un operario cierra una incidencia que no estaba resuelta. Por
eso la primera prueba de este archivo es que las dos listas son literalmente la misma.
"""

from __future__ import annotations

from olo.domain.inspeccion import (
    ESTADOS_ACCIONABLES,
    ESTADOS_QUE_DISCREPAN,
    clasificar_cambio,
)

#: Los estados de «no se pudo ver». Están escritos AQUÍ a mano, y no importados, a
#: propósito: si alguien los mete en los accionables, esta lista sigue diciendo lo que
#: significan y la prueba falla en vez de adaptarse al cambio.
NO_SE_PUDO_VER = (
    "pallet_without_qr",
    "location_qr_unreadable",
    "obstructed",
    "not_scanned",
    "manual_review",
)

CUADRAN = ("verified_match", "verified_empty")


def test_las_dos_reglas_son_la_misma_lista():
    """La regresión que este módulo existe para impedir.

    Si un día `ESTADOS_QUE_DISCREPAN` se escribe a mano en vez de derivarse, esta prueba
    es lo único que separa «funciona» de «el mapa da por resuelto lo que la bandeja tiene
    abierto».
    """
    assert frozenset(ESTADOS_ACCIONABLES) == ESTADOS_QUE_DISCREPAN


def test_lo_que_no_se_pudo_ver_no_genera_trabajo():
    """La decisión de diseño importante, y la más fácil de deshacer sin querer.

    Un QR ilegible o un hueco tapado piden VOLVER A GRABAR, no ir al pasillo. Meterlos en
    la bandeja la llenaría de problemas de cámara disfrazados de problemas de inventario, y
    a los quince minutos nadie la mira — que es peor que no tener bandeja, porque además
    parece que el trabajo está controlado—.
    """
    for estado in NO_SE_PUDO_VER:
        assert estado not in ESTADOS_QUE_DISCREPAN, estado


def test_lo_que_cuadra_tampoco():
    for estado in CUADRAN:
        assert estado not in ESTADOS_QUE_DISCREPAN, estado


def test_cada_estado_accionable_trae_titulo_y_explicacion():
    """Sin ellos la incidencia sería «algo pasa en RCL47-C018-N01-2», que no se puede ni
    comprobar ni discutir tres semanas después."""
    for estado, (titulo, explica) in ESTADOS_ACCIONABLES.items():
        assert titulo.strip(), estado
        assert explica.strip(), estado
        #  La explicación tiene que decir QUÉ pasa, no repetir el nombre del estado.
        assert explica != titulo, estado


# ── Los cuatro veredictos ───────────────────────────────────────────────────────────


def test_resuelto_cuando_deja_de_discrepar():
    """La única prueba barata de que el trabajo sirvió."""
    assert (
        clasificar_cambio(
            estado_antes="unexpected_pallet",
            estado_ahora="verified_match",
            pallet_antes="22O0010471953",
            pallet_ahora="22O0006887184",
        )
        == "resuelto"
    )


def test_persiste_cuando_sigue_igual():
    """El caso medido en `dataset7`: el mismo pallet inesperado en dos recorridos.

    Es el veredicto que nadie mide y el que más dice. Una discrepancia que aguanta varios
    vuelos no es un hallazgo, es un proceso roto.
    """
    assert (
        clasificar_cambio(
            estado_antes="unexpected_pallet",
            estado_ahora="unexpected_pallet",
            pallet_antes="22O0010471953",
            pallet_ahora="22O0010471953",
        )
        == "persiste"
    )


def test_sigue_mal_pero_con_otro_pallet_no_es_persiste():
    """No es la misma discrepancia aguantando: es una nueva encima de la anterior.

    Decir «persiste» borraría que alguien movió mercancía a un hueco que ya estaba mal.
    """
    assert (
        clasificar_cambio(
            estado_antes="unexpected_pallet",
            estado_ahora="unexpected_pallet",
            pallet_antes="22O0010471953",
            pallet_ahora="22A0009999999",
        )
        == "cambio"
    )


def test_nuevo_cuando_antes_cuadraba():
    assert (
        clasificar_cambio(
            estado_antes="verified_match",
            estado_ahora="unexpected_empty",
            pallet_antes="22O0010471953",
            pallet_ahora=None,
        )
        == "nuevo"
    )


def test_cambio_cuando_cuadra_pero_es_otro_pallet():
    """Cuadraba y cuadra, con otro pallet: hubo movimiento y el WMS lo siguió.

    Es la única forma barata de ver que el almacén se mueve BIEN, así que se cuenta en vez
    de callarse con el resto de lo que cuadra.
    """
    assert (
        clasificar_cambio(
            estado_antes="verified_match",
            estado_ahora="verified_match",
            pallet_antes="22O0010471953",
            pallet_ahora="22O0006887184",
        )
        == "cambio"
    )


def test_lo_que_sigue_igual_y_bien_no_sale():
    """`None` y no un veredicto «igual»: la fila NO se pinta.

    Una lista de cambios donde la mayoría dice «igual que antes» deja de leerse, y entonces
    tampoco se leen las tres que importan.
    """
    assert (
        clasificar_cambio(
            estado_antes="verified_match",
            estado_ahora="verified_match",
            pallet_antes="22O0010471953",
            pallet_ahora="22O0010471953",
        )
        is None
    )


def test_dos_lecturas_ilegibles_seguidas_no_son_un_cambio():
    """Ni «persiste» ni «resuelto»: no se pudo ver, y eso no es un veredicto sobre el
    almacén. La respuesta es volver a grabar, y esta pantalla no habla de eso."""
    assert (
        clasificar_cambio(
            estado_antes="pallet_without_qr",
            estado_ahora="pallet_without_qr",
            pallet_antes=None,
            pallet_ahora=None,
        )
        is None
    )


def test_de_ilegible_a_discrepancia_es_nuevo_no_resuelto():
    """El sentido importa. Antes no se pudo ver y ahora se ve que no cuadra: eso es un
    hallazgo nuevo, no algo que se arregló."""
    assert (
        clasificar_cambio(
            estado_antes="location_qr_unreadable",
            estado_ahora="unexpected_pallet",
            pallet_antes=None,
            pallet_ahora="22O0010471953",
        )
        == "nuevo"
    )


def test_de_discrepancia_a_ilegible_no_se_da_por_resuelto():
    """El fallo que estas pruebas destaparon, y que se corrigió.

    Si el vuelo siguiente no pudo leer el hueco, decir «resuelto» sería cerrar trabajo con
    una lectura fallida: la única señal de que algo se arregló se disparaba justo cuando la
    cámara falló. Es el mismo principio que la reconciliación aplica desde el principio
    separando «no se pudo ver» de «cuadra».

    `resuelto` exige ahora una lectura que AFIRME que el hueco está bien, no la simple
    ausencia de una que diga lo contrario.
    """
    assert (
        clasificar_cambio(
            estado_antes="unexpected_pallet",
            estado_ahora="location_qr_unreadable",
            pallet_antes="22O0010471953",
            pallet_ahora=None,
        )
        == "sin_comprobar"
    )


def test_resuelto_exige_una_lectura_que_afirme_que_esta_bien():
    """Los dos estados que sí lo afirman, y solo esos."""
    for bueno in ("verified_match", "verified_empty"):
        assert (
            clasificar_cambio(
                estado_antes="unexpected_empty",
                estado_ahora=bueno,
                pallet_antes=None,
                pallet_ahora="22O0010471953",
            )
            == "resuelto"
        ), bueno


def test_leer_mejor_no_es_mover_mercancia():
    """Antes no se pudo identificar el pallet y ahora sí.

    No se movió nada: mejoró la lectura. Llamar a eso «cambió el pallet» inventaría un
    movimiento que nunca ocurrió, y en un inventario eso es peor que no decir nada.
    """
    assert (
        clasificar_cambio(
            estado_antes="verified_empty",
            estado_ahora="verified_match",
            pallet_antes=None,
            pallet_ahora="22O0010471953",
        )
        is None
    )
