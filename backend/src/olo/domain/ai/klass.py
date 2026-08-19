"""Clases del proyecto y el vocabulario de cada modelo.

`klass` y no `class`: `class` es palabra reservada.

DOS ÍNDICES CON PROPÓSITOS DISTINTOS, y confundirlos es el error caro:

  · `AiClass.class_index`      identidad estable de la clase en el PROYECTO.
                               Inmutable desde la migración 0026. No se reutiliza
                               aunque la clase se desactive.
  · `ModelClass.training_index` índice contiguo 0..N-1 que verán los pesos de ESE
                               modelo. Es lo que el framework escribe en el .pt.

Un proyecto puede tener las clases 0..9 y un modelo declarar solo la 3 y la 7, que
para él son `training_index` 0 y 1. Sin esa separación, el detector de daños
heredaría los índices 3 y 7 y el framework esperaría diez clases donde hay dos.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from olo.domain.warehouse import DomainRuleError

_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

#: Lo que NO es parte de un nombre de clase. Todo lo demas se convierte en `_`.
_NO_NOMBRE_RE = re.compile(r"[^a-z0-9]+")

#: Acentos y eñes, a su letra sin adornos. El nombre viaja a los ficheros del dataset y a
#: comparaciones en codigo: una `ñ` o una `á` los rompe en sitios que no se ven.
_SIN_TILDES = str.maketrans("áàäâãéèëêíìïîóòöôõúùüûñç", "aaaaaeeeeiiiiooooouuuunc")


def normalizar_nombre(nombre: str) -> str:
    """El nombre de una clase, en la forma canonica del vocabulario.

    ── POR QUE EXISTE ESTO ───────────────────────────────────────────────────────

    Porque el nombre de una clase NO es una etiqueta para leer: es una clave que se
    compara en codigo. El worker decide con ella si una deteccion lleva codigo, si se le
    guarda recorte y si puede promoverse a una observacion espacial:

        CLASES_DE_CODIGO   = {"qr_ubicacion", "qr_pallet"}
        CLASES_CON_PRUEBA  = {"qr_ubicacion", "qr_pallet", "pallet", "hueco_vacio"}
        CLASES_DE_UBICACION = {"qr_ubicacion"}

    Todas esas comparaciones son exactas. Una clase creada como `Larguero` nunca casa con
    un `"larguero"` escrito en el codigo, y el sintoma NO es un error: es una deteccion
    que se guarda sin recorte, o un hueco que no se promueve, sin una linea en ningun log.
    Paso de verdad: `Larguero` y `Paral` se crearon con mayuscula desde la pantalla.

    Tambien viaja a los ficheros del dataset que exporta el entrenamiento, donde una `ñ` o
    un espacio son un problema distinto y del mismo origen.

    ── QUE HACE ──────────────────────────────────────────────────────────────────

    Minusculas, sin tildes, y cualquier otra cosa —espacios, guiones, puntos— a `_`. No
    recorta a un maximo: de la longitud se encarga el esquema de la API.
    """
    limpio = nombre.strip().lower().translate(_SIN_TILDES)
    return _NO_NOMBRE_RE.sub("_", limpio).strip("_")


@dataclass(slots=True)
class AiClass:
    """Una clase del vocabulario del proyecto.

    Se DESACTIVA, no se borra: los pesos guardan índices y renumerar hace que un
    modelo entrenado devuelva la etiqueta equivocada sin producir ningún error.
    """

    id: UUID
    project_id: UUID
    name: str
    class_index: int
    color: str
    is_active: bool
    version: int
    created_at: datetime
    updated_at: datetime
    description: str | None = None
    deleted_at: datetime | None = None

    def __post_init__(self) -> None:
        if not self.name.strip():
            msg = "El nombre de la clase no puede estar vacío"
            raise DomainRuleError(msg)

        #  El nombre se NORMALIZA aqui, no se rechaza. Quien lo escribe en la pantalla
        #  pone «Larguero» o «Paral» porque asi se dice, y hacerle corregir la
        #  capitalizacion seria trasladarle un detalle nuestro: que el nombre es una clave
        #  que se compara en codigo. Ver `normalizar_nombre`.
        original = self.name
        self.name = normalizar_nombre(self.name)
        if not self.name:
            msg = f"El nombre {original!r} no deja ningun caracter utilizable"
            raise DomainRuleError(msg)

        if self.class_index < 0:
            msg = "class_index no puede ser negativo"
            raise DomainRuleError(msg)

        if not _COLOR_RE.match(self.color):
            msg = f"El color {self.color!r} debe tener la forma #RRGGBB"
            raise DomainRuleError(msg)

    @property
    def usable(self) -> bool:
        """¿Puede entrar en el vocabulario de un modelo?

        Una clase desactivada no: sus anotaciones quedan fuera de los datasets
        futuros, así que un modelo que la declarara entrenaría sobre nada.
        """
        return self.is_active and self.deleted_at is None


@dataclass(slots=True)
class ModelClass:
    """Pertenencia clase → modelo, con su índice de entrenamiento."""

    model_id: UUID
    class_id: UUID
    project_id: UUID
    training_index: int
    created_at: datetime

    # Derivados del JOIN con ai.classes, para no obligar a dos consultas.
    class_name: str | None = None
    class_color: str | None = None
    class_index: int | None = None
    class_is_active: bool | None = None

    def __post_init__(self) -> None:
        if self.training_index < 0:
            msg = "training_index no puede ser negativo"
            raise DomainRuleError(msg)


def asignar_indices_contiguos(class_ids: Sequence[UUID]) -> list[tuple[UUID, int]]:
    """Empareja cada clase con su `training_index` según la POSICIÓN en la lista.

    Es la operación del `PUT` de vocabulario, y la razón de que ese endpoint sea un
    reemplazo completo y no un parcheo.

    `training_index` tiene que ser contiguo `0..N-1` porque es lo que el framework
    espera. Con altas y bajas individuales, retirar la clase del índice 1 de tres
    deja `0, 2` —un hueco que el framework no admite— y renumerar el resto exigiría
    varias peticiones sin atomicidad. Enviando la lista ordenada completa, el orden
    ES el índice y la operación cabe en una transacción.

    Rechaza duplicados: repetir una clase produciría dos índices para la misma
    etiqueta, y el modelo aprendería a distinguir algo de sí mismo.
    """
    if not class_ids:
        msg = "El vocabulario de un modelo no puede estar vacío"
        raise DomainRuleError(msg)

    vistos: set[UUID] = set()
    duplicados: list[UUID] = []
    for class_id in class_ids:
        if class_id in vistos:
            duplicados.append(class_id)
        vistos.add(class_id)

    if duplicados:
        msg = (
            "El vocabulario no puede repetir clases. Repetidas: "
            + ", ".join(str(d) for d in dict.fromkeys(duplicados))
        )
        raise DomainRuleError(msg)

    return [(class_id, posicion) for posicion, class_id in enumerate(class_ids)]


def siguiente_class_index(indices_existentes: Sequence[int]) -> int:
    """El siguiente índice monotónico del proyecto.

    ⚠ Esta función NO es segura por sí sola frente a concurrencia, y el sitio donde
    se usa tiene que saberlo. Dos peticiones simultáneas que lean los mismos
    índices calcularían el mismo valor y una violaría `uq_class_indice`.

    La serialización se hace en el repositorio con
    `pg_advisory_xact_lock(4243, hashtext(project_id))` dentro de la misma
    transacción que el INSERT. Aquí solo vive la aritmética, que es lo único que el
    dominio puede saber sin la base.

    No reutiliza huecos: si existen 0, 1, 3 —porque la 2 se borró— devuelve 4, no 2.
    Reutilizar un índice haría que un modelo entrenado con la clase 2 antigua
    interpretara la nueva con esa etiqueta.
    """
    if not indices_existentes:
        return 0
    return max(indices_existentes) + 1
