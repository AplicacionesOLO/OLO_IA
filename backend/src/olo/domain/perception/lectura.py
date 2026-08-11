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


#: Cuanto dura una ESCENA: lo que la camara vio de un sitio antes de pasar al siguiente.
#:
#: Dos segundos es lo que tarda una persona en encuadrar el hueco siguiente. Mas ancho junta
#: dos huecos y la lectura afirmaria que el pallet de uno esta en el otro; mas estrecho
#: vuelve a partir la cadena ubicacion -> pallet -> identidad.
VENTANA_ESCENA_MS = 2000

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


def _texto(det: dict[str, Any] | None) -> str | None:
    if det is None:
        return None
    valor = det.get("text_value")
    if valor is None:
        return None
    limpio = str(valor).strip().upper()
    return limpio or None


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
    ordenadas = sorted(detecciones, key=lambda d: int(d.get("frame_ms") or 0))
    escenas: list[list[dict[str, Any]]] = []
    inicio_ms = 0
    ubicacion_actual: str | None = None

    for d in ordenadas:
        ms = int(d.get("frame_ms") or 0)
        #  El codigo se busca en CUALQUIER clase: una etiqueta de hueco leida dentro de una
        #  caja de `pallet` sigue diciendo de que hueco se habla.
        codigo = _texto(d)
        suyo = codigo if es_codigo_de_ubicacion(codigo) else None

        nueva = (
            not escenas
            or (suyo is not None and ubicacion_actual is not None and suyo != ubicacion_actual)
            or ms - inicio_ms > ventana_ms
        )
        if nueva:
            escenas.append([d])
            inicio_ms = ms
            ubicacion_actual = suyo
        else:
            escenas[-1].append(d)
            if suyo is not None and ubicacion_actual is None:
                #  La escena habia empezado sin saber de que hueco era y ahora se sabe. No
                #  se reinicia el reloj: la ubicacion se leyo DENTRO de esta escena.
                ubicacion_actual = suyo


    conocidas = {
        CLASE_QR_UBICACION,
        CLASE_QR_PALLET,
        CLASE_PALLET,
        CLASE_HUECO_VACIO,
        CLASE_ILEGIBLE,
    }

    for grupo in escenas:
        resumen.clases_desconocidas.update(
            str(d.get("class_name")) for d in grupo if d.get("class_name") not in conocidas
        )

        qr_ubi = _mejor(grupo, CLASE_QR_UBICACION)
        qr_pal = _mejor(grupo, CLASE_QR_PALLET)
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

        # ── EJE 1 · atribución ─────────────────────────────────────────────
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
                bbox={
                    "x": float(referencia.get("bbox_x") or 0),
                    "y": float(referencia.get("bbox_y") or 0),
                    "width": float(referencia.get("bbox_width") or 0),
                    "height": float(referencia.get("bbox_height") or 0),
                },
            )
        )

    return resumen
