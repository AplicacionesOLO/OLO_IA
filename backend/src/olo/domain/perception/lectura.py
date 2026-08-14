"""DE DETECCIONES A LECTURAS: el puente que responde «el drone vio 3, el WMS dice 5».

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ ESTO ES LO QUE DA VALOR AL MÓDULO

Percepción producía detecciones —cajas con una clase y a veces un texto— y ahí se
quedaba. `promote_to_observations` las llevaba a `spatial.rack_observations`, que
responde «¿este código existe como rack?», y nada más.

La pregunta que un operador de almacén hace de verdad es otra: **¿lo que hay en el
hueco es lo que el WMS dice que hay?** La respuesta vive en
`inventory.v_reconciliation` (0064), que compara `inventory.readings` contra el corte
del WMS. Y `inventory.readings` no tenía ni una fila ni un escritor.

Este módulo es ese escritor.

═══════════════════════════════════════════════════════════════════════════════
LOS TRES EJES DE 0064, Y CÓMO SALEN DE LAS DETECCIONES

0064 no guarda «hay un pallet»: guarda tres respuestas independientes, porque las tres
fallan por separado y confundirlas hace la incidencia indefendible.

    ATRIBUCIÓN  ¿de qué hueco es esta lectura?     location_qr
    CONTENIDO   ¿hay algo, y qué clase de algo?    content
    IDENTIDAD   ¿qué pallet concreto es?           pallet_qr

Las cinco clases que el proyecto tiene anotadas encajan una a una, y no por
casualidad —el vocabulario se definió para esto—:

    qr_ubicacion       → eje 1. Su `text_value` es el código del hueco.
    hueco_vacio        → eje 2: `empty`
    pallet             → eje 2: `pallet` si hay identidad, `object_no_qr` si no
    qr_pallet          → eje 3. Su `text_value` es el código del pallet.
    etiqueta_ilegible  → el QR está y no se pudo leer: `unreadable`, que NO es lo
                         mismo que `absent`. Uno dice «no supe leerlo» y el otro
                         «no había etiqueta», y llevan a acciones distintas.

═══════════════════════════════════════════════════════════════════════════════
UNA LECTURA POR FOTOGRAMA, NO POR DETECCIÓN

Un fotograma de un rack tiene varias detecciones: el QR del hueco, el pallet, su QR.
Las tres describen LA MISMA observación de UN hueco. Una lectura por detección daría
tres filas contradictorias del mismo sitio, y la reconciliación contaría el hueco tres
veces.

Así que se agrupa por fotograma y de cada grupo sale UNA lectura. Es una aproximación
consciente y tiene un límite que hay que decir: si un fotograma abarca dos huecos con
sus dos códigos legibles, se queda con el de mayor confianza y el otro se pierde. Con
la cámara de un drone apuntando a un rack eso es raro; con una panorámica sería
sistemático. Cuando haga falta, la salida es agrupar por proximidad al QR de ubicación
en vez de por fotograma, y esta función es donde se cambia.

═══════════════════════════════════════════════════════════════════════════════
LO QUE NO SE HACE: ADIVINAR

Un código que el OCR leyó y el catálogo no reconoce NO se corrige. «RCL104» y «RCL1O4»
se diferencian en un carácter y aproximar convertiría un error de lectura en un dato
del inventario. La lectura entra con `location_id = NULL` y `location_qr` a lo que
corresponda, y `v_reconciliation` la clasifica como `location_qr_unreadable`: visible,
contable, y sin afirmar nada sobre ningún hueco.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Collection
from dataclasses import dataclass, field
from typing import Any

#: Las clases del vocabulario que este puente entiende. Una detección de otra clase no
#: se ignora en silencio: cuenta como contenido si es un bulto, y se anota en
#: `clases_desconocidas` para que la respuesta lo diga.
CLASE_QR_UBICACION = "qr_ubicacion"
CLASE_QR_PALLET = "qr_pallet"
CLASE_PALLET = "pallet"
CLASE_HUECO_VACIO = "hueco_vacio"
CLASE_ILEGIBLE = "etiqueta_ilegible"


@dataclass
class Lectura:
    """Una fila de `inventory.readings`, ya resuelta en sus tres ejes."""

    location_code_observed: str | None
    location_qr: str
    location_confidence: float | None
    content: str
    content_confidence: float | None
    pallet_qr: str
    pallet_code_observed: str | None
    pallet_confidence: float | None
    frame_number: int
    observed_at: Any
    bbox: dict[str, float] | None = None

    #: Milisegundo del video del que sale la lectura. `observed_at` es la hora del
    #: recorrido; esto es el instante DENTRO del material, que es lo que permite volver al
    #: fotograma y saltar el video justo ahi.
    frame_ms: int | None = None

    #: LA PRUEBA VISUAL: tres recortes, uno por eje (0091).
    #:
    #: Son las rutas de los recortes de las TRES detecciones que esta lectura uso para
    #: decidir — no unas parecidas del mismo hueco—:
    #:
    #:     crop_location   la etiqueta que decidio de que hueco se habla
    #:     crop_content    lo que se vio dentro
    #:     crop_pallet     la etiqueta que decidio que pallet es
    #:
    #: Que sean esas tres exactamente es lo que las hace prueba: si la lectura dice «pallet
    #: 22O0010471953» y la imagen ensena otra etiqueta, el fallo se ve. Con una foto del
    #: hueco entero habria que fiarse igual.
    #:
    #: `None` cuando el worker no guardo el recorte: analisis anteriores a 0091, o la
    #: casilla de guardar fotogramas desactivada.
    crop_location_path: str | None = None
    crop_content_path: str | None = None
    crop_pallet_path: str | None = None


@dataclass
class Resumen:
    """Qué salió de la conversión. Se devuelve para que la pantalla lo diga."""

    lecturas: list[Lectura] = field(default_factory=list)
    #: Fotogramas que no produjeron lectura porque no vieron nada útil.
    fotogramas_vacios: int = 0
    #: Clases detectadas que este puente no sabe interpretar. Es un aviso, no un fallo:
    #: significa que el modelo detecta algo para lo que el puente no tiene regla.
    clases_desconocidas: set[str] = field(default_factory=set)
    #: Textos leidos que se descartaron por no tener forma de codigo —ruido de OCR—. Si son
    #: muchos, el recorrido no tiene pocas etiquetas: tiene un problema de lectura.
    textos_descartados: int = 0
    #: Escenas donde se leyeron VARIOS huecos y no se pudo decir a cual pertenece lo que se
    #: veia. No es un fallo del modelo: es un encuadre que abarca dos huecos a la vez.
    escenas_ambiguas: int = 0
    #: Codigos con forma de hueco que se leyeron BIEN y que el catalogo no tiene.
    #:
    #: No es ruido —el ruido no tiene cuatro segmentos— y no es un fallo de captura: es una
    #: etiqueta fisica que ningun sistema del almacen conoce. Se saca a la pantalla porque
    #: exige una accion distinta a todo lo demas: dar de alta esa ubicacion o corregir la
    #: etiqueta del montante.
    ubicaciones_desconocidas: set[str] = field(default_factory=set)


#: Cuanto dura una ESCENA: lo que la camara vio de un sitio antes de pasar al siguiente.
#:
#: Dos segundos es lo que tarda una persona en encuadrar el hueco siguiente. Mas ancho junta
#: dos huecos y la lectura afirmaria que el pallet de uno esta en el otro; mas estrecho
#: vuelve a partir la cadena ubicacion -> pallet -> identidad.
VENTANA_ESCENA_MS = 2000

#: Cuanto sigue valiendo una ubicacion leida para atribuir lo que se vea DESPUES.
#:
#: El recorrido va asi: se encuadra la etiqueta del hueco, y luego se baja a ver que hay
#: dentro. Entre las dos cosas pasan segundos —medido en un recorrido real: la etiqueta a los
#: 0,9 s y el pallet a los 7,7—, asi que el contenido tiene que poder heredar la ubicacion
#: leida ANTES.
#:
#: Con tope, porque sin el un pallet filmado un minuto despues heredaria un hueco que ya no
#: tiene nada que ver. Quince segundos es holgado para un hueco y corto para un pasillo.
VIGENCIA_UBICACION_MS = 15000

#: Cuantos segmentos tiene una ubicacion COMPLETA: rack, cuerpo, nivel y posicion.
SEGMENTOS_UBICACION = 4

#: Con que se reconoce un codigo de PALLET.
#:
#: En este almacen empiezan por `22` seguido de una letra —`22O00…`, `22A00…`— y siguen de
#: corrido, sin guiones. Es CONFIGURABLE a proposito: otra empresa tendra otra serie, y
#: dejarlo fijo obligaria a tocar codigo para instalar el producto en el almacen siguiente.
#:
#: Se ajusta con `OLO_PATRON_CODIGO_PALLET` en la configuracion del backend. Es por
#: DESPLIEGUE y no por tenant: el dia que dos empresas compartan instalacion, esto tiene que
#: pasar a una tabla de configuracion, y entonces este comentario es la pista de donde mirar.
PATRON_PALLET_POR_OMISION = r"^[0-9]{2}[A-Z][0-9A-Z]{6,}$"


def es_codigo_de_ubicacion(codigo: str | None) -> bool:
    """Si el codigo identifica un HUECO: cuatro segmentos separados por guion.

    Los guiones son lo que distingue una ubicacion de cualquier otra cosa que el OCR haya
    podido leer. Se cuentan SEGMENTOS y no se valida la forma de cada uno: el formato del
    rack cambia entre almacenes y una expresion ajustada a `RCL` rechazaria el siguiente.

    La misma regla vive en `frontend/src/modules/perception/codigos.ts` y en
    `tools/inferir.py::es_ubicacion_completa`; los tres archivos lo dicen.
    """
    if not codigo:
        return False
    return len([p for p in str(codigo).strip().split("-") if p]) >= SEGMENTOS_UBICACION


def base_de_ubicacion(codigo: str | None) -> str | None:
    """El hueco SIN su slot: `RCL47-C018-N01-2` → `RCL47-C018-N01`.

    ── PARA QUE SIRVE ────────────────────────────────────────────────────────────

    Los dos slots de un mismo cuerpo y nivel llevan sus etiquetas UNA ENCIMA DE OTRA en el
    mismo montante, y la camara las ve a la vez. Son el mismo sitio fisico visto de una
    pasada, asi que una escena NO se corta al pasar de `…-N01-1` a `…-N01-2`: se corta al
    pasar a otro cuerpo o a otro nivel.

    Cortar por el codigo completo separaba los dos slots en escenas distintas, y entonces la
    desambiguacion por geometria no llegaba a ejecutarse nunca — habia que elegir entre las
    dos reglas y quedarse con la que describe el almacen.
    """
    if not codigo:
        return None
    partes = [p for p in str(codigo).strip().split("-") if p]
    if len(partes) < SEGMENTOS_UBICACION:
        return None
    return "-".join(partes[:-1])


def es_codigo_de_pallet(codigo: str | None, patron: str = PATRON_PALLET_POR_OMISION) -> bool:
    """Si el codigo tiene la forma de un identificador de pallet.

    ── POR QUE HACE FALTA COMPROBAR LA FORMA ─────────────────────────────────────

    Antes se daba por bueno el `text_value` de la clase: lo que dijera una deteccion de
    `qr_pallet` era el codigo del pallet, y lo que dijera una de `qr_ubicacion` era el del
    hueco. Las dos suposiciones fallan, y se comprobo con datos:

      · una anotacion humana marcada como `qr_pallet` era en realidad una etiqueta de
        hueco, y decodificaba `RCL47-C018-N01-2`. Escrito como codigo de pallet, eso mete
        una ubicacion en el campo de la identidad.
      · el OCR devuelve ruido —`1 1 W`, `2 2 7`, `5`— y entraba como codigo LEIDO. En un
        video de prueba, 40 de 80 lecturas afirmaban haber leido un hueco que no existe.

    La clase dice donde MIRO el modelo; la forma dice QUE se leyo. Para decidir que es un
    codigo, manda la forma.
    """
    if not codigo:
        return False
    limpio = str(codigo).strip().upper()
    if not limpio or "-" in limpio:
        #  Un codigo con guiones es una ubicacion, nunca un pallet. Se comprueba aqui
        #  ademas del patron porque es la regla que el almacen ya tiene interiorizada.
        return False
    try:
        return re.match(patron, limpio) is not None
    except re.error:
        #  Un patron mal escrito en la configuracion no puede tumbar la reconciliacion: se
        #  cae al de omision, que es el del almacen actual.
        return re.match(PATRON_PALLET_POR_OMISION, limpio) is not None


def _centro(d: dict[str, Any]) -> tuple[float, float]:
    return (
        float(d.get("bbox_x") or 0) + float(d.get("bbox_width") or 0) / 2,
        float(d.get("bbox_y") or 0) + float(d.get("bbox_height") or 0) / 2,
    )


def _contiene(caja: dict[str, Any], punto: tuple[float, float]) -> bool:
    x, y = punto
    x0 = float(caja.get("bbox_x") or 0)
    y0 = float(caja.get("bbox_y") or 0)
    return (
        x0 <= x <= x0 + float(caja.get("bbox_width") or 0)
        and y0 <= y <= y0 + float(caja.get("bbox_height") or 0)
    )


def _mejor(detecciones: list[dict[str, Any]], clase: str) -> dict[str, Any] | None:
    """La detección más segura de esa clase en el grupo, o `None`.

    La más segura y no la primera: dos lecturas del mismo QR en un fotograma son la
    misma etiqueta vista dos veces, y quedarse con la primera sería quedarse con la que
    el modelo listó antes, que no significa nada.
    """
    candidatas = [d for d in detecciones if d.get("class_name") == clase]
    if not candidatas:
        return None
    return max(candidatas, key=lambda d: float(d.get("confidence") or 0))


def _mejor_con_codigo(
    detecciones: list[dict[str, Any]], clase: str, valido: Callable[[str | None], bool]
) -> dict[str, Any] | None:
    """La detección de esa clase que SÍ trae un código válido, y entre esas, la más segura.

    ── EL FALLO QUE ESTO ARREGLA ─────────────────────────────────────────────────

    Antes se elegía por confianza a secas, y eso tira lecturas buenas. Medido en un
    recorrido real, los primeros dos segundos:

        ms 0     qr_ubicacion  0,62  «RCL47-C018-N01-2»   ← el código bueno
        ms 400   qr_ubicacion  0,65  «KAR OS 5»           ← ruido, más confianza
        ms 600   qr_ubicacion  0,66  (nada)               ← ruido, aún más

    La escena se quedaba con la de 0,66 —que no leyó nada— y la ubicación se perdía: la
    reconciliación decía «hueco no identificado» de un hueco perfectamente leído.

    Y tiene sentido que pase: la confianza mide cuánto cree el modelo que ahí hay una
    etiqueta, no si el código se pudo leer. Son dos cosas distintas y la que importa aquí
    es la segunda. Entre varias que sí leyeron, la confianza vuelve a ser un buen criterio.
    """
    con_codigo = [d for d in detecciones if d.get("class_name") == clase and valido(_texto(d))]
    if con_codigo:
        return max(con_codigo, key=lambda d: float(d.get("confidence") or 0))
    #  Ninguna leyó nada: se devuelve la más segura igualmente, porque su PRESENCIA sigue
    #  siendo información —hay una etiqueta ahí y no se pudo leer, que es `unreadable`—.
    return _mejor(detecciones, clase)


def _texto(det: dict[str, Any] | None) -> str | None:
    if det is None:
        return None
    valor = det.get("text_value")
    if valor is None:
        return None
    limpio = str(valor).strip().upper()
    return limpio or None


def _recorte(det: dict[str, Any] | None) -> str | None:
    """La ruta del recorte de esa deteccion, si el worker la guardo.

    Se lee de la deteccion y no se construye aqui: quien sabe de que fotograma salio es
    quien lo recorto, y recalcular la ruta en dos sitios es como se acaba apuntando a un
    objeto que no existe.
    """
    if det is None:
        return None
    valor = det.get("crop_path")
    return str(valor) if valor else None


def _confianza(det: dict[str, Any] | None) -> float | None:
    if det is None:
        return None
    valor = det.get("confidence")
    return None if valor is None else round(float(valor), 4)


def convertir(
    detecciones: list[dict[str, Any]],
    *,
    ventana_ms: int = VENTANA_ESCENA_MS,
    patron_pallet: str = PATRON_PALLET_POR_OMISION,
    ubicaciones_conocidas: Collection[str] | None = None,
) -> Resumen:
    """Agrupa las detecciones en ESCENAS y devuelve una lectura por escena.

    No toca la base y no sabe qué es un `location_id`: eso lo resuelve el repositorio
    casando `location_code_observed` con el catálogo. Aquí solo se decide QUÉ se vio.

    ── SE AGRUPA POR TIEMPO, NO POR FOTOGRAMA ────────────────────────────────────

    Antes el grupo era el fotograma exacto, y eso rompía la cadena que da sentido a todo:
    se lee la etiqueta del hueco, luego se ve el pallet, luego se lee SU etiqueta. Con la
    cámara barriendo un pasillo esas tres cosas caen en fotogramas distintos, así que cada
    una producía su propia lectura mutilada.

    Medido sobre un recorrido real de 8K: 23 pallets con identidad leída se quedaron sin
    ubicación —clasificados `location_qr_unreadable`, o sea tirados— porque el QR del hueco
    se había leído dos fotogramas antes.

    Una escena es lo que la cámara vio de un sitio antes de pasar al siguiente. Dos
    segundos es lo que tarda una persona en encuadrar el hueco siguiente; con una ventana
    mucho más ancha se juntarían dos huecos y la lectura afirmaría que el pallet de uno
    está en el otro, que es peor que perder la lectura.
    """
    resumen = Resumen()

    """
    ── LA ESCENA SE CORTA POR EL CODIGO DE UBICACION, NO POR EL HUECO ENTRE FOTOGRAMAS ──

    El primer intento cortaba cuando el salto entre dos detecciones pasaba de la ventana.
    No funciona y se vio en cuanto se midio: a 10 fotogramas por segundo los saltos son de
    100 ms, siempre por debajo del umbral, asi que TODAS las detecciones se encadenaron en
    una sola escena — 124 detecciones produjeron 2 lecturas—. Es el fallo clasico del
    agrupamiento por enlace simple: si cada punto esta cerca del siguiente, todo es un
    unico grupo aunque los extremos esten a un minuto.

    El ancla correcta es la que describe el propio recorrido: primero se lee la ubicacion,
    y todo lo que viene despues es de ESE hueco hasta que aparezca otro. Asi que la escena
    se corta cuando:

      · aparece un codigo de ubicacion DISTINTO al de la escena en curso, o
      · pasa la ventana desde que la escena EMPEZO —tope absoluto, no por salto—.

    El tope absoluto es la red de seguridad para el tramo sin etiquetas legibles: sin el,
    un pasillo entero sin lecturas de hueco seria una sola escena y el pallet del final
    acabaria atribuido al hueco del principio.
    """
    """
    ── LA UBICACION SE ARRASTRA HACIA DELANTE, NUNCA HACIA ATRAS ─────────────────

    Corregido con un caso confirmado por el almacen. En un recorrido real:

        0,0 a 0,9 s    etiqueta RCL47-C018-N01-2   ← el hueco de verdad
        7,7 a 9,9 s    pallet 22O0010471953
       11,6 a 11,8 s   etiqueta RCL47-C019-N01-2   ← el hueco SIGUIENTE

    La ultima deteccion del pallet y la etiqueta de C019 estan a 1,7 s, o sea DENTRO de la
    ventana, asi que el pallet se quedaba con la etiqueta que vino DESPUES. El sistema dijo
    C019 y el pallet estaba en C018.

    El orden del recorrido es el que manda: primero se encuadra la etiqueta, luego se baja a
    ver el contenido. Asi que una etiqueta nueva SIEMPRE abre escena —lo que venga detras es
    suyo— y una escena sin etiqueta propia HEREDA la ultima leida mientras siga vigente.

    Es lo que el almacen describio desde el principio; la ventana de tiempo, tal como estaba,
    lo rompia.
    """
    """
    ── UNA ETIQUETA QUE EL CATALOGO NO TIENE NO PUEDE ROBARLE LA ESCENA A UNA QUE SI ──

    Caso medido en `dataset7`, y el almacen confirmo cual era la verdad:

         0,0 a 0,4 s   RCL47-C018-N01-1 y -2      ← las etiquetas del hueco, en el catalogo
        10,0 s         RACK26-C036-N01-1          ← se lee perfectamente. NO esta en el catalogo
        10,4 a 11,8 s  pallet 22O0010471953       ← el pallet
        13,2 s         RCL47-C019-N01-1 y -2      ← el hueco siguiente
        13,8 a 14,6 s  RACK26-C036-N01-1 OTRA VEZ ← junto a las de C019

    `RACK26` se lee 0,4 s antes del pallet, asi que por la regla de arrastre se quedaba con
    la escena y el pallet quedaba colgado de un hueco QUE NO EXISTE. La reconciliacion decia
    «nada que comparar»: el pallet desaparecia de la comparacion con el WMS, que es justo
    para lo que sirve todo esto. Y el almacen confirmo que ese pallet esta en C018-N01-2.

    Que aparezca dos veces en sitios distintos del mismo recorrido dice lo que es: una
    etiqueta suelta, visible desde varios angulos, que ningun sistema del almacen conoce.

    Asi que un codigo desconocido no ancla escena ni se arrastra hacia delante. Pero NO se
    tira: se anota en `ubicaciones_desconocidas`, y si la escena no tiene nada mejor sigue
    siendo su ubicacion observada —y la vista la clasifica `location_unknown`, que es un
    hallazgo de verdad—. Lo que no puede es tapar a una ubicacion real.

    Sin catalogo a mano —`ubicaciones_conocidas` a `None`— todo esto se apaga y el
    comportamiento es el de antes: no se inventa que un codigo sea falso por no poder
    comprobarlo.
    """
    catalogo = (
        None
        if ubicaciones_conocidas is None
        else {str(c).strip().upper() for c in ubicaciones_conocidas}
    )

    def _conocida(codigo: str | None) -> bool:
        if catalogo is None or not codigo:
            return True
        return codigo in catalogo

    ordenadas = sorted(detecciones, key=lambda d: int(d.get("frame_ms") or 0))
    escenas: list[list[dict[str, Any]]] = []
    #: Que ubicacion le corresponde a cada escena, leida o heredada. Mismo indice.
    heredadas: list[str | None] = []
    inicio_ms = 0
    #: La ultima ubicacion leida: su base —cuerpo y nivel—, el CODIGO COMPLETO, cuando, si en
    #: ese momento se leyeron varios slots a la vez, y con cuanta confianza se vio ESE codigo.
    #: Sobrevive al corte de escena: es lo que permite que el contenido filmado despues sepa
    #: de que hueco es.
    #:
    #: Se guarda el codigo completo y no solo la base porque la base —`RCL47-C018-N01`— no
    #: existe en el catalogo: son tres segmentos y las ubicaciones tienen cuatro. Heredarla
    #: atribuia el pallet al cuerpo correcto y aun asi la lectura no casaba con nada.
    ultima: tuple[str, str, int, bool, float] | None = None

    for d in ordenadas:
        ms = int(d.get("frame_ms") or 0)
        #  El codigo se busca en CUALQUIER clase: una etiqueta de hueco leida dentro de una
        #  caja de `pallet` sigue diciendo de que hueco se habla.
        #
        #  Y se compara por el CUERPO Y NIVEL, no por el codigo completo: los dos slots de un
        #  mismo montante son el mismo sitio visto de una pasada.
        suyo = base_de_ubicacion(_texto(d))

        #  Un codigo que el catalogo no tiene se anota y deja de contar como ancla: ni corta
        #  escena ni se arrastra. Ver la nota de arriba —es lo que hacia que un pallet real
        #  colgara de un hueco inexistente—.
        if suyo is not None and not _conocida(_texto(d)):
            resumen.ubicaciones_desconocidas.add(str(_texto(d)))
            suyo = None

        #  Una etiqueta de OTRO cuerpo abre escena siempre, aunque la escena en curso no
        #  tuviera etiqueta propia. Sin esto, la etiqueta del hueco siguiente se colaba en la
        #  escena del contenido del anterior y se lo llevaba.
        completo = _texto(d) if suyo is not None else None
        empieza_otro_hueco = suyo is not None and (ultima is None or suyo != ultima[0])
        nueva = not escenas or empieza_otro_hueco or ms - inicio_ms > ventana_ms

        def _anotar(base: str, codigo: str, cuando: int, conf: float) -> None:
            """Recuerda la ubicacion vigente, y con que slot se queda si hay dos.

            ── ENTRE DOS SLOTS DEL MISMO MONTANTE MANDA LA MEJOR VISTA ───────────────

            Las etiquetas `…-N01-1` y `…-N01-2` van una encima de otra y la camara las lee a
            la vez. Cuando el contenido aparece EN LA MISMA ESCENA se resuelve por geometria
            —cada bulto va con la etiqueta que tiene mas cerca—, pero cuando llega diez
            segundos despues no hay geometria que valga: las etiquetas ya no estan en cuadro.

            Ahi el codigo se quedaba con «el ultimo anotado», que con dos etiquetas en el
            MISMO fotograma es el orden de la lista. O sea azar. Medido en `dataset7`: el
            sistema atribuyo el pallet al slot 1 y el almacen confirmo que estaba en el 2.

            El desempate es la confianza de la deteccion, y no es un truco de conveniencia:
            quien graba encuadra el slot que esta inspeccionando, asi que SU etiqueta sale
            mas grande y mas nitida que la del vecino. En el caso medido, `-2` se leyo tres
            veces con 0,57-0,60 y `-1` con 0,28-0,43.

            La duda no se borra: `dudoso` se sigue marcando y la escena se sigue contando
            como ambigua. Se elige la mejor evidencia disponible Y se dice que habia dos.
            """
            nonlocal ultima
            mismo_cuerpo = bool(ultima and ultima[0] == base)
            otro_slot = bool(mismo_cuerpo and ultima and ultima[1] != codigo)
            ya_dudoso = bool(mismo_cuerpo and ultima and ultima[3])

            #  El tiempo SIEMPRE avanza: la vigencia cuenta desde la ultima vez que se vio el
            #  montante, gane el slot que gane. Lo contrario caducaria una ubicacion que la
            #  camara tiene delante.
            if otro_slot and ultima and conf < ultima[4]:
                ultima = (base, ultima[1], cuando, True, ultima[4])
                return
            ultima = (base, codigo, cuando, otro_slot or ya_dudoso, conf)

        if nueva:
            escenas.append([d])
            inicio_ms = ms
            if suyo is not None and completo:
                _anotar(suyo, completo, ms, float(d.get("confidence") or 0))
                heredadas.append(ultima[1] if ultima else completo)
            else:
                vigente = ultima and ms - ultima[2] <= VIGENCIA_UBICACION_MS
                heredadas.append(ultima[1] if vigente and ultima else None)
                if vigente and ultima and ultima[3]:
                    #  Se hereda, pero el slot no era seguro: dos etiquetas del mismo cuerpo
                    #  se leyeron a la vez. Se cuenta para que la pantalla lo pueda decir.
                    resumen.escenas_ambiguas += 1
        else:
            escenas[-1].append(d)
            if suyo is not None and completo:
                _anotar(suyo, completo, ms, float(d.get("confidence") or 0))
                heredadas[-1] = ultima[1] if ultima else completo

    conocidas = {
        CLASE_QR_UBICACION,
        CLASE_QR_PALLET,
        CLASE_PALLET,
        CLASE_HUECO_VACIO,
        CLASE_ILEGIBLE,
    }

    for indice, grupo in enumerate(escenas):
        resumen.clases_desconocidas.update(
            str(d.get("class_name")) for d in grupo if d.get("class_name") not in conocidas
        )

        #  Se prefiere la que trae un código LEÍDO sobre la que el modelo puntuó más alto:
        #  ver la nota de `_mejor_con_codigo`.
        #  Y entre varias que leyeron, primero las que el catálogo conoce: en una escena con
        #  `RCL47-C019-N01-2` y `RACK26-C036-N01-1` a la vez, quedarse con la más segura es
        #  jugárselo a la confianza del modelo. Si ninguna es del catálogo, vale la que se
        #  leyó —el camino de antes— y acabará como «hueco fuera del catálogo».
        qr_ubi = _mejor_con_codigo(
            grupo, CLASE_QR_UBICACION, lambda c: es_codigo_de_ubicacion(c) and _conocida(c)
        )
        if not es_codigo_de_ubicacion(_texto(qr_ubi)):
            qr_ubi = _mejor_con_codigo(grupo, CLASE_QR_UBICACION, es_codigo_de_ubicacion)
        qr_pal = _mejor_con_codigo(
            grupo, CLASE_QR_PALLET, lambda c: es_codigo_de_pallet(c, patron_pallet)
        )
        bulto = _mejor(grupo, CLASE_PALLET)
        vacio = _mejor(grupo, CLASE_HUECO_VACIO)
        ilegible = _mejor(grupo, CLASE_ILEGIBLE)

        """
        ── EL CODIGO SE ACEPTA POR SU FORMA, NO POR LA CLASE QUE LO TRAJO ─────────

        La clase dice donde MIRO el modelo; la forma dice QUE se leyo. Dar por bueno el
        texto de la clase metia dos cosas falsas en el inventario: ruido de OCR como
        codigo de hueco —`1 1 W`, `2 2 7`— y codigos de ubicacion en el campo de la
        identidad del pallet, porque una etiqueta de hueco se anoto como `qr_pallet`.

        Y se cruzan: un codigo con guiones leido en una caja de `qr_pallet` es una
        ubicacion, y sirve como tal si no habia otra. Tirarlo seria perder una lectura
        buena por un error de clase.
        """
        crudo_ubi = _texto(qr_ubi)
        crudo_pal = _texto(qr_pal)

        codigo_ubi = crudo_ubi if es_codigo_de_ubicacion(crudo_ubi) else None
        if codigo_ubi is None and es_codigo_de_ubicacion(crudo_pal):
            codigo_ubi = crudo_pal

        codigo_pal = crudo_pal if es_codigo_de_pallet(crudo_pal, patron_pallet) else None
        if codigo_pal is None and es_codigo_de_pallet(crudo_ubi, patron_pallet):
            codigo_pal = crudo_ubi

        #  Se cuenta lo que se descarto: un recorrido donde el 90 % de los textos no tienen
        #  forma de codigo no es un recorrido con pocas etiquetas, es un problema de lectura,
        #  y la pantalla tiene que poder decirlo.
        for crudo, usado in ((crudo_ubi, codigo_ubi), (crudo_pal, codigo_pal)):
            if crudo and crudo not in (codigo_ubi, codigo_pal) and crudo != usado:
                resumen.textos_descartados += 1

        #  Un código que el catálogo no tiene cede ante una ubicación real —leída antes y
        #  todavía vigente—. Solo cede ante ESO: si la escena no tiene nada mejor, el código
        #  desconocido sigue siendo lo observado y la vista lo clasifica `location_unknown`,
        #  que es el hallazgo. Lo que no puede es tapar un hueco de verdad.
        if codigo_ubi is not None and not _conocida(codigo_ubi):
            resumen.ubicaciones_desconocidas.add(codigo_ubi)
            if heredadas[indice]:
                codigo_ubi = None

        # ── EJE 1 · atribución ─────────────────────────────────────────────
        #
        #  Si esta escena no leyó etiqueta pero hay una vigente de antes, se hereda: el
        #  contenido que se filma después de encuadrar un hueco es de ESE hueco.
        if codigo_ubi is None and heredadas[indice]:
            codigo_ubi = heredadas[indice]

        if codigo_ubi:
            location_qr = "read"
        elif qr_ubi is not None or ilegible is not None:
            # La etiqueta está en la imagen y no se pudo leer. `unreadable` y no
            # `absent`: uno lleva a limpiar la etiqueta, el otro a ponerla.
            location_qr = "unreadable"
        else:
            # No se buscó ni se vio ninguna. `not_attempted` es lo honesto: `absent`
            # afirmaría que el hueco no tiene etiqueta, y eso no se ha comprobado.
            location_qr = "not_attempted"

        # ── EJE 2 · contenido ──────────────────────────────────────────────
        if bulto is not None:
            # `pallet` exige identidad; sin ella es un bulto sin QR. La distinción es
            # la que separa «hay algo que no sé qué es» de «hay el pallet X».
            content = "pallet" if codigo_pal else "object_no_qr"
            conf_content = _confianza(bulto)
        elif vacio is not None:
            content = "empty"
            conf_content = _confianza(vacio)
        else:
            # Ni bulto ni hueco vacío: el modelo no se pronunció sobre el contenido.
            # `unknown`, que `v_reconciliation` clasifica como `not_scanned`.
            content = "unknown"
            conf_content = None

        # ── EJE 3 · identidad ──────────────────────────────────────────────
        if codigo_pal:
            pallet_qr = "read"
        elif content == "empty":
            # El CHECK `chk_read_empty` de 0064 lo exige: un hueco vacío no puede
            # tener un QR de pallet «ilegible», porque no hay pallet.
            pallet_qr = "absent"
        elif qr_pal is not None or (bulto is not None and ilegible is not None):
            pallet_qr = "unreadable"
        elif bulto is not None:
            # Hay bulto y no se vio ninguna etiqueta en él.
            pallet_qr = "absent"
        else:
            pallet_qr = "not_attempted"

        if location_qr == "not_attempted" and content == "unknown":
            # Un fotograma que no vio ni hueco ni carga no es una observación: es un
            # fotograma en el que el modelo no encontró nada. Guardarlo llenaría la
            # reconciliación de filas `not_scanned` sin información.
            resumen.fotogramas_vacios += 1
            continue

        """
        ── DOS ETIQUETAS EN LA MISMA ESCENA ──────────────────────────────────────

        En el almacen las etiquetas de los slots van una encima de otra en el mismo montante
        —`…-N01-1` arriba, `…-N01-2` abajo— y la camara las ve A LA VEZ. Medido: las dos se
        leyeron en los mismos fotogramas, con 799 ms de diferencia entre una lectura y otra.

        Cuando eso pasa, decir «el pallet es del hueco que leimos» es elegir uno de los dos
        al azar. Asi que se mira la GEOMETRIA: cada bulto se atribuye a la etiqueta que
        tenga mas cerca, que es lo unico que no depende de como se movio la camara.

        Y cuando ni eso vale —el bulto abarca las dos etiquetas, que es lo que pasa cuando
        se graba demasiado cerca y la caja del pallet ocupa el fotograma entero— NO se
        atribuye: la lectura se queda sin contenido y la escena se cuenta como ambigua. Un
        inventario que dice «el hueco 1 tiene este pallet» cuando podia ser el 2 es peor que
        uno que dice «aqui no pude saberlo».
        """
        #  Y aqui tambien manda el catalogo: una etiqueta que no existe no es un candidato a
        #  quedarse con el bulto. Contarla convertia una escena limpia en ambigua —dos codigos
        #  vistos, uno de ellos inexistente— y el contenido se perdia por una duda falsa.
        etiquetas = [
            d for d in grupo if es_codigo_de_ubicacion(_texto(d)) and _conocida(_texto(d))
        ]
        codigos_vistos = {_texto(d) for d in etiquetas}
        if len(codigos_vistos) > 1 and (bulto is not None or vacio is not None):
            contenido_caja = bulto or vacio
            cercana = min(
                etiquetas,
                key=lambda e: abs(_centro(e)[1] - _centro(contenido_caja)[1]),
            )
            #  ¿El bulto abarca tambien la OTRA etiqueta? Entonces no hay geometria que
            #  valga: esta encima de las dos.
            otras = [e for e in etiquetas if _texto(e) != _texto(cercana)]
            abarca_varias = any(_contiene(contenido_caja, _centro(o)) for o in otras)
            if abarca_varias:
                resumen.escenas_ambiguas += 1
                content = "unknown"
                conf_content = None
                pallet_qr = "not_attempted"
                codigo_pal = None
            else:
                codigo_ubi = _texto(cercana)
                location_qr = "read"

        referencia = qr_ubi or bulto or vacio or grupo[0]
        resumen.lecturas.append(
            Lectura(
                location_code_observed=codigo_ubi,
                location_qr=location_qr,
                location_confidence=_confianza(qr_ubi),
                content=content,
                content_confidence=conf_content,
                pallet_qr=pallet_qr,
                pallet_code_observed=codigo_pal,
                pallet_confidence=_confianza(qr_pal),
                #  El fotograma REAL de la detección de referencia, no el índice de la
                #  escena: una escena agrupa varios fotogramas, y guardar su número de
                #  orden en un campo llamado `frame_number` haría que quien lo lea busque
                #  el fotograma 3 de un vídeo donde la escena 3 empieza en el 180.
                frame_number=int(referencia.get("frame_number") or 0),
                observed_at=referencia.get("observed_at"),
                frame_ms=(
                    int(referencia["frame_ms"])
                    if referencia.get("frame_ms") is not None
                    else None
                ),
                #  Las tres detecciones que decidieron, cada una con su recorte. Para el
                #  contenido manda el bulto si lo hay, y si no el hueco vacio: es lo que se
                #  vio, no lo que se esperaba.
                crop_location_path=_recorte(qr_ubi),
                crop_content_path=_recorte(bulto or vacio),
                crop_pallet_path=_recorte(qr_pal),
                bbox={
                    "x": float(referencia.get("bbox_x") or 0),
                    "y": float(referencia.get("bbox_y") or 0),
                    "width": float(referencia.get("bbox_width") or 0),
                    "height": float(referencia.get("bbox_height") or 0),
                },
            )
        )

    return resumen
