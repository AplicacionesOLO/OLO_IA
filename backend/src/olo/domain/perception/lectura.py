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


def convertir(detecciones: list[dict[str, Any]]) -> Resumen:
    """Agrupa las detecciones por fotograma y devuelve una lectura por grupo.

    No toca la base y no sabe qué es un `location_id`: eso lo resuelve el repositorio
    casando `location_code_observed` con el catálogo. Aquí solo se decide QUÉ se vio.
    """
    resumen = Resumen()

    por_fotograma: dict[int, list[dict[str, Any]]] = {}
    for d in detecciones:
        por_fotograma.setdefault(int(d.get("frame_number") or 0), []).append(d)

    conocidas = {
        CLASE_QR_UBICACION,
        CLASE_QR_PALLET,
        CLASE_PALLET,
        CLASE_HUECO_VACIO,
        CLASE_ILEGIBLE,
    }

    for numero in sorted(por_fotograma):
        grupo = por_fotograma[numero]
        resumen.clases_desconocidas.update(
            str(d.get("class_name")) for d in grupo if d.get("class_name") not in conocidas
        )

        qr_ubi = _mejor(grupo, CLASE_QR_UBICACION)
        qr_pal = _mejor(grupo, CLASE_QR_PALLET)
        bulto = _mejor(grupo, CLASE_PALLET)
        vacio = _mejor(grupo, CLASE_HUECO_VACIO)
        ilegible = _mejor(grupo, CLASE_ILEGIBLE)

        codigo_ubi = _texto(qr_ubi)
        codigo_pal = _texto(qr_pal)

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
                frame_number=numero,
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
