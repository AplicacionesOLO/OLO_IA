"""Versiones de dataset: la instantánea inmutable que un entrenamiento consume.

─────────────────────────────────────────────────────────────────────────────
POR QUE EL REPARTO SE CONGELA

Si train/val/test se sortea en cada entrenamiento, dos runs «con la misma
configuración» miden cosas distintas y comparar sus mAP no dice nada. Peor: la misma
imagen cae en `train` en uno y en `val` en otro, así que el segundo puntúa contra
material que el primero ya usó y su métrica está inflada.

Cada entrenamiento apunta a EXACTAMENTE una versión. Eso, y solo eso, permite
afirmar «la v3 es mejor que la v2».

─────────────────────────────────────────────────────────────────────────────
EL REPARTO ES DETERMINISTA, NO ALEATORIO

`repartir()` no usa `random`. Deriva la posición de cada imagen de
`blake2b(semilla || image_id)`, así que:

  · el mismo conjunto y la misma semilla dan SIEMPRE el mismo reparto, en
    cualquier máquina y en cualquier versión de Python — `random.shuffle` no lo
    garantiza entre versiones del intérprete;
  · el orden en que lleguen los identificadores no influye. Con `random.shuffle`
    sobre una lista ordenada por `created_at`, subir una imagen más cambia el
    reparto de TODAS las demás.

La semilla se guarda para poder reproducir el reparto, no para volver a sortearlo.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from olo.domain.warehouse import DomainRuleError

SPLIT_TRAIN = "train"
SPLIT_VAL = "val"
SPLIT_TEST = "test"

#: Reparto por omisión. 70/20/10 es la convención de detección de objetos: `val`
#: necesita suficiente material para que la métrica no salte entre épocas, y `test`
#: existe para medir UNA vez al final sin haber ajustado nada contra él.
REPARTO_POR_OMISION = (0.7, 0.2, 0.1)


@dataclass(slots=True, frozen=True)
class ClaseCongelada:
    """Una clase tal y como estaba al congelar.

    `index` es el `class_index` del proyecto, no el `training_index` de un modelo.
    Se guarda porque los pesos YOLO almacenan índices: sin esta instantánea, un
    modelo entrenado hace tres meses no se podría interpretar si después se
    desactivaron clases o se añadieron otras.
    """

    index: int
    name: str

    def as_json(self) -> dict[str, object]:
        return {"index": self.index, "name": self.name}


@dataclass(slots=True, frozen=True)
class ImagenCandidata:
    """Una imagen que podría entrar en la versión."""

    id: UUID
    status: str
    annotation_count: int


@dataclass(slots=True, frozen=True)
class DatasetVersion:
    id: UUID
    project_id: UUID
    version: int
    name: str | None
    notes: str | None
    class_snapshot: tuple[ClaseCongelada, ...]
    image_count: int
    train_count: int
    val_count: int
    test_count: int
    split_seed: int
    frozen_at: datetime


#: Estados cuyas imágenes SÍ entran en un dataset.
#:
#: `annotated` tiene cajas por construcción. `validated` puede tener cero, y eso es
#: deliberado: una imagen revisada sin ninguna caja es un NEGATIVO —«aquí no hay
#: nada»— y YOLO aprende de los negativos tanto como de los positivos, porque son lo
#: que le enseña a no inventar detecciones sobre suelo vacío.
#:
#: `pending` queda fuera: cero cajas ahí no significa «no hay nada», significa «nadie
#: ha mirado». Meterla enseñaría al modelo a ignorar objetos reales.
ESTADOS_ENTRENABLES = frozenset({"annotated", "validated"})


def elegibles(candidatas: Sequence[ImagenCandidata]) -> list[ImagenCandidata]:
    """Las que pueden entrar, en el orden recibido."""
    return [c for c in candidatas if c.status in ESTADOS_ENTRENABLES]


def repartir(
    image_ids: Sequence[UUID],
    *,
    seed: int,
    proporciones: tuple[float, float, float] = REPARTO_POR_OMISION,
) -> list[tuple[UUID, str]]:
    """Asigna un split a cada imagen, de forma determinista y reproducible.

    ── LA GARANTIA DE `val` ────────────────────────────────────────────────

    Con pocas imágenes, `round(17 * 0.2)` puede dar 3 pero `round(4 * 0.2)` da 1 y
    `round(2 * 0.2)` da 0. Una versión con `val = 0` produce un entrenamiento que NO
    PUEDE MEDIRSE: el framework entrena y no reporta mAP, así que no hay forma de
    saber si el modelo aprendió o memorizó.

    Así que con 2 o más imágenes se reserva al menos una para `val`, aunque eso
    rompa la proporción pedida. `test` sí puede quedar en cero: medir una vez al
    final es deseable, no imprescindible, y con 3 imágenes no hay material para las
    dos cosas.
    """
    if not image_ids:
        msg = "no hay imágenes que repartir"
        raise DomainRuleError(msg)

    t, v, s = proporciones
    if min(t, v, s) < 0:
        msg = "las proporciones no pueden ser negativas"
        raise DomainRuleError(msg)
    if abs(t + v + s - 1.0) > 1e-6:
        msg = f"las proporciones deben sumar 1, suman {t + v + s}"
        raise DomainRuleError(msg)

    # Orden determinista derivado de la semilla. Ver la cabecera del módulo: no se
    # usa `random` para que el resultado no dependa del intérprete ni del orden de
    # llegada.
    def clave(image_id: UUID) -> str:
        h = hashlib.blake2b(f"{seed}:{image_id}".encode(), digest_size=16)
        return h.hexdigest()

    ordenadas = sorted(image_ids, key=clave)
    n = len(ordenadas)

    n_val = round(n * v)
    n_test = round(n * s)

    # La garantía de `val`. Se le quita a `train`, que es quien puede permitírselo.
    if n >= 2 and n_val == 0:
        n_val = 1
    # Y nunca puede quedarse `train` sin nada: un dataset sin train no entrena.
    while n_val + n_test >= n and (n_val + n_test) > 0:
        if n_test > 0:
            n_test -= 1
        else:
            n_val -= 1

    n_train = n - n_val - n_test

    salida: list[tuple[UUID, str]] = []
    for i, image_id in enumerate(ordenadas):
        if i < n_train:
            salida.append((image_id, SPLIT_TRAIN))
        elif i < n_train + n_val:
            salida.append((image_id, SPLIT_VAL))
        else:
            salida.append((image_id, SPLIT_TEST))
    return salida


def contar(reparto: Sequence[tuple[UUID, str]]) -> tuple[int, int, int]:
    """`(train, val, test)`. El CHECK del motor exige que sumen `image_count`."""
    train = sum(1 for _, s in reparto if s == SPLIT_TRAIN)
    val = sum(1 for _, s in reparto if s == SPLIT_VAL)
    test = sum(1 for _, s in reparto if s == SPLIT_TEST)
    return train, val, test


def validar_congelable(
    candidatas: Sequence[ImagenCandidata], clases: Sequence[ClaseCongelada]
) -> list[ImagenCandidata]:
    """Comprueba que hay material suficiente y devuelve las imágenes elegibles.

    Los tres motivos de rechazo son distintos y el mensaje tiene que distinguirlos,
    porque la acción del operador es distinta en cada caso: anotar, activar clases, o
    revisar el estado de las imágenes.
    """
    if not clases:
        msg = (
            "el proyecto no tiene clases activas. Un dataset sin vocabulario no puede "
            "entrenar nada"
        )
        raise DomainRuleError(msg)

    aptas = elegibles(candidatas)
    if not aptas:
        pendientes = sum(1 for c in candidatas if c.status == "pending")
        msg = (
            f"ninguna imagen está lista: hacen falta imágenes en estado «annotated» o "
            f"«validated» y hay {pendientes} en «pending». Anota alguna antes de congelar"
        )
        raise DomainRuleError(msg)

    # Al menos una caja en TODO el conjunto. Un dataset donde todas las imágenes son
    # negativos no le enseña al modelo qué buscar: solo qué ignorar.
    if sum(c.annotation_count for c in aptas) == 0:
        msg = (
            "las imágenes elegibles no tienen ninguna anotación. Un dataset sin cajas "
            "no le enseña al modelo qué detectar"
        )
        raise DomainRuleError(msg)

    return aptas
