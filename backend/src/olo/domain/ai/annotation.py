"""Anotaciones: la caja que una persona dibuja sobre una imagen.

─────────────────────────────────────────────────────────────────────────────
COORDENADAS NORMALIZADAS 0..1, NUNCA PÍXELES

Es el formato nativo de YOLO —no hay conversión al exportar— y sobrevive a que la
imagen se redimensione o se recomprima. Con píxeles, generar una miniatura o
reescalar el dataset invalidaría en silencio todas las anotaciones: las cajas
seguirían ahí, apuntando a sitios que ya no son.

Los mismos rangos los verifica el motor con CHECK (migración 0030). Aquí se
comprueban otra vez a propósito: una violación de CHECK llega como un 500 con un
mensaje de Postgres, y quien anota necesita saber QUÉ caja está mal y por qué.

─────────────────────────────────────────────────────────────────────────────
EL GUARDADO ES UN REEMPLAZO DE TODO EL CONJUNTO DE UNA IMAGEN

No hay alta, baja y modificación por caja, y no es por comodidad:

  · quien anota dibuja, corrige y borra varias cajas antes de guardar. Con
    operaciones por caja, cerrar el navegador a mitad deja la imagen con tres
    cajas de cinco y ninguna señal de que falta algo;
  · el estado de la imagen (`pending` → `annotated`) depende del conjunto
    completo, no de una caja suelta;
  · `ai.annotations` NO tiene política de DELETE en RLS —solo SELECT, INSERT y
    UPDATE—, así que retirar una caja es por definición una actualización, y
    mezclar eso con altas en varias peticiones no es atómico.

`planificar_guardado()` calcula el diff para que un guardado no rehaga las cajas
que no cambiaron: conserva su `created_at` y su autoría, que es lo que permite
saber quién dibujó qué.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from olo.domain.warehouse import DomainRuleError

# Absorbe el redondeo de numeric(9,8) sin dejar pasar cajas realmente desbordadas.
# Es la misma tolerancia que usan los CHECK de la migración 0030: si aquí fuera más
# estricta, rechazaríamos cajas que el motor acepta, y al revés dejaríamos pasar al
# motor cajas que él rechaza con un mensaje ilegible.
TOLERANCIA = Decimal("0.000001")

KIND_BBOX = "bbox"
ORIGEN_HUMANO = "human"


@dataclass(slots=True, frozen=True)
class BBox:
    """Caja en formato YOLO: centro, ancho y alto, normalizados 0..1."""

    cx: Decimal
    cy: Decimal
    w: Decimal
    h: Decimal

    def __post_init__(self) -> None:
        for nombre, valor in (("cx", self.cx), ("cy", self.cy)):
            if not (Decimal(0) <= valor <= Decimal(1)):
                msg = f"{nombre} = {valor} está fuera de la imagen: debe estar entre 0 y 1"
                raise DomainRuleError(msg)

        for nombre, valor in (("w", self.w), ("h", self.h)):
            if not (Decimal(0) < valor <= Decimal(1)):
                msg = f"{nombre} = {valor} no es válido: debe ser mayor que 0 y como máximo 1"
                raise DomainRuleError(msg)

        # La caja COMPLETA tiene que caber. Un centro válido con un ancho grande
        # produce una caja que se sale, y al entrenar eso recorta objetos por la
        # mitad sin avisar.
        if self.cx - self.w / 2 < -TOLERANCIA or self.cx + self.w / 2 > 1 + TOLERANCIA:
            msg = (
                f"la caja se sale por los lados: centro {self.cx} con ancho {self.w} "
                f"llega de {self.cx - self.w / 2} a {self.cx + self.w / 2}"
            )
            raise DomainRuleError(msg)
        if self.cy - self.h / 2 < -TOLERANCIA or self.cy + self.h / 2 > 1 + TOLERANCIA:
            msg = (
                f"la caja se sale por arriba o abajo: centro {self.cy} con alto {self.h} "
                f"llega de {self.cy - self.h / 2} a {self.cy + self.h / 2}"
            )
            raise DomainRuleError(msg)

    def igual_a(self, otra: BBox) -> bool:
        """Comparación numérica, no de representación.

        `Decimal('0.5') != Decimal('0.50000000')` como objetos, pero son la misma
        caja. Sin esto, cada guardado marcaría como cambiadas todas las cajas que
        volvieron de la base con la escala de `numeric(9,8)`.
        """
        return (
            self.cx == otra.cx and self.cy == otra.cy
            and self.w == otra.w and self.h == otra.h
        )


@dataclass(slots=True)
class Annotation:
    """Una anotación ya persistida."""

    id: UUID
    project_id: UUID
    image_id: UUID
    class_id: UUID
    kind: str
    box: BBox | None
    origin: str
    version: int
    created_at: datetime
    updated_at: datetime
    confidence: Decimal | None = None
    deleted_at: datetime | None = None

    # Derivados del JOIN con ai.classes: el anotador necesita pintar cada caja con
    # el color de su clase, y pedirlas aparte serían dos consultas por imagen.
    class_name: str | None = None
    class_color: str | None = None
    class_index: int | None = None

    def __post_init__(self) -> None:
        if self.kind == KIND_BBOX and self.box is None:
            msg = "una anotación de tipo bbox necesita sus cuatro coordenadas"
            raise DomainRuleError(msg)

        # `confidence` solo tiene sentido si NO lo dibujó una persona. Y si lo
        # dibujó una persona no puede haber confianza: es verdad, no estimación.
        if (self.origin == ORIGEN_HUMANO) != (self.confidence is None):
            msg = (
                "una anotación humana no lleva confianza, y una que no es humana la "
                f"necesita; origin={self.origin!r} confidence={self.confidence!r}"
            )
            raise DomainRuleError(msg)


@dataclass(slots=True, frozen=True)
class AnnotationDraft:
    """Lo que el cliente envía: una caja, con `id` solo si ya existía."""

    class_id: UUID
    box: BBox
    id: UUID | None = None


@dataclass(slots=True, frozen=True)
class PlanGuardado:
    """Qué hay que hacer para que el conjunto guardado sea el pedido."""

    insertar: tuple[AnnotationDraft, ...]
    #: `(id, borrador)`. El `id` va aparte y NO como `AnnotationDraft.id` opcional a
    #: propósito: en un borrador el `id` puede faltar, pero una actualización sin `id`
    #: no existe. Llevándolo en la tupla, el tipo lo garantiza y quien consume el plan
    #: no necesita comprobarlo ni afirmarlo.
    actualizar: tuple[tuple[UUID, AnnotationDraft], ...]
    retirar: tuple[Annotation, ...]
    #: Las que no cambiaron. No se tocan: así conservan `created_at` y su autoría.
    intactas: tuple[Annotation, ...]

    @property
    def total_resultante(self) -> int:
        return len(self.insertar) + len(self.actualizar) + len(self.intactas)

    @property
    def hay_cambios(self) -> bool:
        return bool(self.insertar or self.actualizar or self.retirar)


def planificar_guardado(
    existentes: Sequence[Annotation],
    deseadas: Sequence[AnnotationDraft],
) -> PlanGuardado:
    """Diff entre lo que hay y lo que se pide, sin tocar la base.

    Es una función pura para poder probarla sin base de datos, que es donde están
    los casos difíciles: enviar dos veces el mismo `id`, o un `id` que pertenece a
    otra imagen.

    Rechaza los dos:

      · un `id` REPETIDO en la petición describiría dos cajas distintas para la
        misma fila, y la última ganaría en silencio;
      · un `id` DESCONOCIDO significa que el cliente trae una caja de otra imagen
        —o de un estado que ya no existe—, y crearla con ese `id` la ataría a la
        imagen equivocada.
    """
    por_id = {a.id: a for a in existentes}

    vistos: set[UUID] = set()
    repetidos: list[UUID] = []
    desconocidos: list[UUID] = []

    for d in deseadas:
        if d.id is None:
            continue
        if d.id in vistos:
            repetidos.append(d.id)
        vistos.add(d.id)
        if d.id not in por_id:
            desconocidos.append(d.id)

    if repetidos:
        listado = ", ".join(str(x) for x in dict.fromkeys(repetidos))
        msg = f"la petición repite anotaciones: {listado}"
        raise DomainRuleError(msg)

    if desconocidos:
        listado = ", ".join(str(x) for x in dict.fromkeys(desconocidos))
        msg = (
            f"estas anotaciones no existen en esta imagen: {listado}. "
            "Vuelve a leer la imagen antes de guardar."
        )
        raise DomainRuleError(msg)

    insertar: list[AnnotationDraft] = []
    actualizar: list[tuple[UUID, AnnotationDraft]] = []
    intactas: list[Annotation] = []

    for d in deseadas:
        if d.id is None:
            insertar.append(d)
            continue
        actual = por_id[d.id]
        sin_cambio = (
            actual.class_id == d.class_id
            and actual.box is not None
            and actual.box.igual_a(d.box)
        )
        if sin_cambio:
            intactas.append(actual)
        else:
            actualizar.append((d.id, d))

    retirar = tuple(a for a in existentes if a.id not in vistos)

    return PlanGuardado(
        insertar=tuple(insertar),
        actualizar=tuple(actualizar),
        retirar=retirar,
        intactas=tuple(intactas),
    )


def siguiente_estado_imagen(actual: str, anotaciones: int) -> str | None:
    """El estado que le toca a la imagen tras guardar, o `None` si no cambia.

    Deliberadamente CONSERVADOR: solo mueve la frontera entre `pending` y
    `annotated`, que es la que el acto de anotar decide. No toca `validated`,
    `rejected` ni `archived`.

    El motivo es que esos tres los pone una PERSONA revisando, y guardar una
    corrección de una caja no puede deshacer una validación. Si alguien valida una
    imagen y luego ajusta una caja, la imagen sigue validada: quien la validó
    tendrá que revisarla otra vez, y esa decisión es suya, no del guardado.
    """
    if anotaciones > 0 and actual == "pending":
        return "annotated"
    if anotaciones == 0 and actual == "annotated":
        return "pending"
    return None
