"""QUÉ CUENTA COMO TRABAJO, Y QUÉ CAMBIÓ DESDE EL RECORRIDO ANTERIOR.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ ESTO ES UN MÓDULO Y NO DOS CONSTANTES SUELTAS

Las dos reglas de abajo nacieron separadas: una en el servicio de percepción —que decide
qué discrepancias abren incidencia— y otra en el de espacial —que decide si algo se
resolvió—. Son la MISMA regla vista desde dos lados, y separadas se rompen así:

    alguien añade `duplicate_pallet` a las que abren incidencia
    la pantalla de cambios no lo conoce
    → la incidencia se abre, y al vuelo siguiente el mapa dice «resuelto»
      de algo que sigue abierto en la bandeja

Nadie ve ese fallo hasta que un operario cierra una incidencia que no estaba resuelta. Con
una sola definición, es imposible.

═══════════════════════════════════════════════════════════════════════════════
LO QUE NO ENTRA, Y ESA ES LA DECISIÓN IMPORTANTE

Solo las discrepancias generan trabajo. Lo que no se pudo VER —etiqueta ilegible, hueco
tapado, sin revisar— NO entra, y no es un olvido: pide volver a grabar, no ir al pasillo.

Mezclarlos llenaría la bandeja de problemas de cámara disfrazados de problemas de
inventario, y a los quince minutos nadie la mira. Una bandeja que nadie mira es peor que
no tener bandeja, porque además da la sensación de que el trabajo está controlado.
"""

from __future__ import annotations

#: Los estados de `inventory.v_reconciliation` que significan «la realidad y el sistema se
#: contradicen». Cada uno con su título y su explicación, que son los que acaban escritos
#: en la incidencia y los que alguien lee con el móvil en el pasillo.
#:
#: `location_unknown` está aquí aunque suene a problema de lectura: el código se leyó
#: perfectamente y el catálogo no lo tiene. Eso es trabajo —dar de alta la ubicación o
#: corregir la etiqueta del montante— y no se arregla grabando otra vez.
ESTADOS_ACCIONABLES: dict[str, tuple[str, str]] = {
    "unexpected_pallet": (
        "Pallet inesperado",
        "Hay un pallet que el WMS no declara en este hueco.",
    ),
    "unexpected_empty": (
        "Vacio inesperado",
        "El WMS declara mercancia en este hueco y esta vacio.",
    ),
    "location_unknown": (
        "Hueco fuera del catalogo",
        "Se leyo el codigo del hueco y no existe en el catalogo del almacen.",
    ),
}

#: Lo mismo, como conjunto, para preguntar «¿esto discrepa?». Se DERIVA en vez de
#: escribirse: dos listas escritas a mano se separan, y esa separación es exactamente el
#: fallo que este módulo existe para impedir.
ESTADOS_QUE_DISCREPAN = frozenset(ESTADOS_ACCIONABLES)

#: Los estados que afirman que el hueco está BIEN. Ojo: no son «los que no discrepan».
#:
#: Esa confusión producía un fallo caro. Comparando dos recorridos, «antes no cuadraba y
#: ahora no discrepa» se daba por RESUELTO — incluido el caso en que el vuelo siguiente
#: simplemente no pudo leer la etiqueta—. O sea: la única señal de que el trabajo sirvió
#: se disparaba con una lectura fallida.
#:
#: Es el mismo principio que la pantalla de reconciliación aplica desde el principio
#: separando «no se pudo ver» de «cuadra»: el silencio no es salud. Aquí faltaba.
ESTADOS_QUE_CUADRAN = frozenset({"verified_match", "verified_empty"})


def clasificar_cambio(
    *,
    estado_antes: str,
    estado_ahora: str,
    pallet_antes: str | None,
    pallet_ahora: str | None,
) -> str | None:
    """Qué pasó en un hueco entre los dos últimos recorridos que lo vieron.

    ── LOS CINCO VEREDICTOS ──────────────────────────────────────────────────────

        resuelto        antes no cuadraba y ahora SÍ CUADRA  → el trabajo sirvió
        persiste        no cuadraba y sigue igual            → nadie lo está arreglando
        nuevo           cuadraba y ahora no                  → pasó algo desde el vuelo anterior
        cambio          el pallet observado es otro          → se movió mercancía
        sin_comprobar   no cuadraba y ahora no se pudo ver   → sigue sin saberse

    `persiste` es el que nadie mide y el que más dice: una discrepancia que aguanta varios
    vuelos no es un hallazgo, es un proceso roto.

    ── POR QUÉ EXISTE `sin_comprobar` ────────────────────────────────────────────

    Porque sin él, «antes no cuadraba y ahora no discrepa» se daba por RESUELTO, y eso
    incluye el caso en que el vuelo siguiente no pudo leer la etiqueta. La única señal de
    que el trabajo sirvió se disparaba con una lectura fallida.

    Es el mismo principio que la reconciliación aplica separando «no se pudo ver» de
    «cuadra»: el silencio no es salud. `resuelto` ahora exige una lectura que AFIRME que el
    hueco está bien, no la simple ausencia de una que diga lo contrario.

    ── DEVUELVE `None` CUANDO NO HAY NADA QUE CONTAR ─────────────────────────────

    Cuadraba y sigue cuadrando con el mismo pallet, o no se pudo ver ni antes ni ahora. Esas
    filas NO salen a la pantalla: una lista de «cambios» donde la mayoría dice «igual que
    antes» deja de leerse, y entonces tampoco se leen las que importan.
    """
    antes_mal = estado_antes in ESTADOS_QUE_DISCREPAN
    ahora_mal = estado_ahora in ESTADOS_QUE_DISCREPAN
    ahora_bien = estado_ahora in ESTADOS_QUE_CUADRAN
    cambio_pallet = pallet_antes != pallet_ahora

    if antes_mal and ahora_bien:
        return "resuelto"
    if antes_mal and not ahora_mal:
        #  Ni discrepa ni afirma que esté bien: no se pudo ver. Decir «resuelto» aquí sería
        #  cerrar trabajo con una lectura fallida.
        return "sin_comprobar"
    if not antes_mal and ahora_mal:
        return "nuevo"
    if antes_mal and ahora_mal:
        #  Sigue mal. Que el pallet sea OTRO merece decirse aparte: no es la misma
        #  discrepancia aguantando, es una nueva encima de la anterior.
        return "cambio" if cambio_pallet else "persiste"
    if cambio_pallet and pallet_antes and pallet_ahora:
        #  Cuadraba y cuadra, pero el pallet es otro: hubo movimiento y el WMS lo siguió.
        #  Es la única forma barata de ver que el almacén se mueve BIEN, y por eso se
        #  cuenta en vez de callarse con el resto de lo que cuadra.
        #
        #  Se exigen los DOS códigos. Con uno solo —antes no se pudo leer y ahora sí— no se
        #  movió nada: mejoró la lectura, y llamar a eso «se movió mercancía» inventaría un
        #  movimiento que nunca ocurrió.
        return "cambio"
    return None
