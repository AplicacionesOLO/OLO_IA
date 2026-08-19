"""DE DOS VIGAS A UN HUECO, Y DE UN HUECO A «ESTA VACIO».

═══════════════════════════════════════════════════════════════════════════════════════
POR QUE NO SE DETECTA UN HUECO VACIO, SE DEDUCE

Un detector de objetos propone cajas alrededor de COSAS. Un hueco vacio no es una cosa:
es una ausencia, y su aspecto cambia por completo segun lo que se vea detras — el rack de
enfrente lleno, el rack de enfrente vacio, el pasillo, una pared—. Entrenar eso pide miles
de ejemplos de cada variante, y esta medido: con 15 anotaciones el modelo encontro CERO.

Lo que si tiene pixeles claros es la estructura. Un `larguero` es una viga horizontal y un
`paral` un poste vertical: estan o no estan, y dos personas los encuadran igual. Con ellos
la rejilla del rack se deduce por interseccion, y entonces la pregunta deja de ser «¿donde
hay un hueco vacio?» —dificil— y pasa a ser «¿que hay dentro de esta celda?» —medible—.

═══════════════════════════════════════════════════════════════════════════════════════
Y LA RESPUESTA LA DA EL MOVIMIENTO, NO EL ASPECTO

Los racks estan pegados de espaldas. Por un hueco vacio se ve el rack de detras, varios
metros mas lejos, y como el dron avanza lo lejano se desplaza MENOS entre dos fotogramas.

Medido sobre 36 anotaciones de `DJI_0005_H264_4K.mp4`, con el flujo de cada region
dividido por el del fotograma completo:

        hueco vacio    n=15    0,192 … 0,475    mediana 0,268
        con pallet     n=21    0,808 … 1,102    mediana 1,007

Separacion completa, sin un solo solapamiento. Y en los 11 fotogramas donde habia un hueco
vacio Y un pallet a la vez, el vacio se movio menos en 11 de 11 — misma imagen, misma
velocidad, misma luz—.

La lectura fisica es limpia: el pallet se mueve como la escena; el fondo de un hueco vacio
se mueve al 27 %, o sea que esta unas 3,7 veces mas lejos.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

#: Por debajo de esto, lo que hay dentro de la celda esta LEJOS: se ve el fondo.
#:
#: 0,64 y no 0,808 —que es el corte que mas acierta en la muestra— porque 0,808 es el
#: minimo de los llenos y esta pegado al borde de los datos: cualquier caso algo mas lento
#: caeria del lado equivocado. 0,64 es el punto medio del margen entre 0,475 y 0,808, que
#: es un hueco del 70 %.
UMBRAL_FLUJO_VACIO = 0.64

#: Si el fotograma entero se mueve menos que esto —en pixeles, a la escala a la que se mide
#: el flujo— el dron esta parado o casi, y ENTONCES NO SE PUEDE DECIDIR NADA.
#:
#: Sin esta comprobacion el metodo se rompe hacia el lado peor: sin movimiento todas las
#: regiones dan flujo bajo, o sea que un rack lleno grabado desde un dron detenido saldria
#: entero como huecos vacios. Y no daria ningun error.
MOVIMIENTO_MINIMO_PX = 0.8

#: Cuanto tiene que solaparse un pallet con la celda para considerarlo dentro. Un pallet que
#: sobresale y pisa la celda de al lado no la llena.
SOLAPE_MINIMO_PALLET = 0.35


@dataclass(frozen=True)
class Caja:
    """Un rectangulo normalizado, `0..1` sobre el fotograma."""

    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def ancho(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def alto(self) -> float:
        return max(0.0, self.y2 - self.y1)

    @property
    def area(self) -> float:
        return self.ancho * self.alto

    def solape(self, otra: Caja) -> float:
        """Cuanto de `otra` cae dentro de esta, de 0 a 1.

        Se divide por el area de `otra` y no por la union: la pregunta es «¿esta este
        pallet en esta celda?», y un pallet pequeño dentro de una celda grande daria una
        union baja y respondria que no.
        """
        ix = max(0.0, min(self.x2, otra.x2) - max(self.x1, otra.x1))
        iy = max(0.0, min(self.y2, otra.y2) - max(self.y1, otra.y1))
        return (ix * iy) / otra.area if otra.area > 0 else 0.0


def celdas_de_rejilla(
    largueros: list[Caja], parales: list[Caja], *, lado_minimo: float = 0.04
) -> list[Caja]:
    """Las celdas que forman los largueros y los parales al cruzarse.

    ── COMO SE CRUZAN ────────────────────────────────────────────────────────────

    Cada larguero da una linea horizontal —su centro— y cada paral una vertical. Dos
    horizontales consecutivas y dos verticales consecutivas encierran una celda, que es un
    hueco de estanteria.

    Se usa el CENTRO de cada viga y no su borde porque una viga tiene grosor: tomando
    bordes, la celda se quedaria corta o larga segun de que lado se mire, y el pallet que
    esta dentro apareceria medio fuera.

    ── QUE SE DESCARTA, Y POR QUE ────────────────────────────────────────────────

    Las celdas demasiado estrechas o bajas. Dos largueros detectados casi a la misma altura
    son casi siempre la misma viga vista dos veces —el detector propone dos cajas
    solapadas— y su «celda» es una franja de unos pocos pixeles donde no cabe nada.
    Contarla como hueco vacio añadiria un hueco inventado por cada viga detectada dos veces.

    Devuelve la lista vacia si no hay al menos dos de cada: con un larguero no hay nivel
    que cerrar, y con un paral no hay columna. Es un «no lo se», no un cero.
    """
    if len(largueros) < 2 or len(parales) < 2:
        return []

    ys = sorted((c.y1 + c.y2) / 2 for c in largueros)
    xs = sorted((c.x1 + c.x2) / 2 for c in parales)

    celdas: list[Caja] = []
    for y1, y2 in pairwise(ys):
        if y2 - y1 < lado_minimo:
            continue
        for x1, x2 in pairwise(xs):
            #  Lo mismo por el otro lado: dos parales pegados son el mismo poste.
            if x2 - x1 < lado_minimo:
                continue
            celdas.append(Caja(x1, y1, x2, y2))
    return celdas


#: En cuantas posiciones se divide un hueco. Dos es lo normal en este almacen: el catalogo
#: numera `logical_position` 1 y 2 dentro de la misma ubicacion.
SLOTS_POR_HUECO = 2


def slots_de_celda(celda: Caja, cuantos: int = SLOTS_POR_HUECO) -> list[Caja]:
    """Las posiciones dentro de un hueco.

    ── POR QUE ESTO HACE FALTA, Y ES EL ERROR QUE COSTO UNA VUELTA ────────────────

    Porque un hueco de rack selectivo NO tiene ningun poste entre sus dos posiciones. Los
    parales delimitan la UBICACION —el tramo entero— y las dos tarimas que caben dentro se
    reparten ese espacio sin nada estructural que las separe.

    Medido sobre el fotograma 2400 de `DJI_0005_H264_4K.mp4`: los dos parales estan en 0,159
    y 0,821 —casi todo el ancho— y dentro hay un hueco vacio en 0,313 y un pallet en 0,639.
    Sin dividir, la celda contiene los dos, el pallet la marca llena y el hueco vacio
    desaparece. La primera version hacia exactamente eso: dedujo 0 de 3.

    La division es geometrica y por partes iguales. No pretende ser exacta —una tarima mal
    colocada no se ajusta a la mitad— y no necesita serlo: lo que decide despues es el
    solape con lo detectado y el movimiento de cada mitad, y los dos toleran que el corte
    caiga unos centimetros a un lado.
    """
    if cuantos < 1:
        return [celda]
    if cuantos == 1:
        return [celda]
    paso = celda.ancho / cuantos
    return [
        Caja(celda.x1 + i * paso, celda.y1, celda.x1 + (i + 1) * paso, celda.y2)
        for i in range(cuantos)
    ]


@dataclass(frozen=True)
class Veredicto:
    """Que hay en una celda, y por que se dice."""

    celda: Caja
    estado: str
    """`vacio`, `lleno` o `sin_decidir`. Vocabulario cerrado."""
    flujo_relativo: float | None
    confianza: float
    motivo: str


def clasificar_celda(
    celda: Caja,
    *,
    flujo_relativo: float | None,
    movimiento_del_fotograma: float,
    pallets: list[Caja],
) -> Veredicto:
    """Si esta celda esta vacia, llena, o no se puede decir.

    ── EL ORDEN DE LAS COMPROBACIONES ES LA PARTE IMPORTANTE ─────────────────────

    Primero se descarta lo que invalida la medida —el dron parado— y solo despues se mira
    el dato. Al reves, un rack lleno grabado desde un dron detenido saldria entero como
    huecos vacios, con toda la confianza y sin un solo error.

    Un pallet dentro manda sobre el flujo: si el detector encontro carga en esa celda, esta
    llena y no hay nada que deducir. El flujo solo contesta cuando NO hay pallet, que es
    justo el caso ambiguo — puede estar vacia, o puede tener algo que el detector no vio—.
    """
    if movimiento_del_fotograma < MOVIMIENTO_MINIMO_PX:
        return Veredicto(
            celda,
            "sin_decidir",
            flujo_relativo,
            0.0,
            f"el fotograma apenas se mueve ({movimiento_del_fotograma:.2f} px): sin "
            f"movimiento no hay profundidad que medir",
        )

    dentro = [p for p in pallets if celda.solape(p) >= SOLAPE_MINIMO_PALLET]
    if dentro:
        return Veredicto(
            celda, "lleno", flujo_relativo, 1.0, f"hay {len(dentro)} pallet(s) dentro"
        )

    if flujo_relativo is None:
        return Veredicto(
            celda, "sin_decidir", None, 0.0, "no se pudo medir el flujo de esta celda"
        )

    if flujo_relativo < UMBRAL_FLUJO_VACIO:
        #  La confianza sale de lo LEJOS que esta del umbral, acotada. Un 0,27 —la mediana
        #  medida— da 0,79; un 0,63, apenas 0,51. Lo que casi empata no se afirma con la
        #  misma fuerza que lo que separa con holgura.
        margen = (UMBRAL_FLUJO_VACIO - flujo_relativo) / UMBRAL_FLUJO_VACIO
        return Veredicto(
            celda,
            "vacio",
            flujo_relativo,
            min(0.95, 0.5 + margen * 0.55),
            f"lo que hay dentro se mueve al {flujo_relativo * 100:.0f} % de la escena: "
            f"esta lejos, se ve el fondo",
        )

    return Veredicto(
        celda,
        "lleno",
        flujo_relativo,
        0.6,
        f"lo que hay dentro se mueve al {flujo_relativo * 100:.0f} % de la escena: esta "
        f"cerca, aunque el detector no reconociera la carga",
    )
