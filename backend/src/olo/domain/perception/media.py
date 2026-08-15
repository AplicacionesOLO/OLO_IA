"""LA RUTA DE UN MEDIO DE PERCEPCIÓN, y por qué la genera el servidor.

    {tenant_id}/{warehouse_id}/{media_id}/{nombre_saneado}

Los dos primeros segmentos son la frontera del aislamiento, y `core.
perception_media_path_ok()` de la migración 0076 la convierte en invariante: exige que
el primero sea el tenant actual y el segundo un almacén al que el usuario tiene acceso.

Esta función existe para que el CLIENTE nunca proponga una ruta. `confirm` la recalcula
a partir del mismo `media_id`, tipo y nombre que usó `prepare`, así que no hay forma de
subir a un sitio y reclamar otro. Es el mismo razonamiento que `domain/ai/asset.py`, con
un nivel más: allí el prefijo es el proyecto, aquí son tenant y almacén, porque el
acceso en este sistema se acota por almacén.

── POR QUÉ SANITIZAR ES DETERMINISTA, Y POR QUÉ IMPORTA ────────────────────

`prepare` devuelve una URL de subida construida con esta ruta; `confirm` la recalcula
para comprobar que el objeto está donde debería. Si `sanitizar_nombre` no diera
EXACTAMENTE el mismo resultado para la misma entrada, el objeto subido quedaría
inalcanzable y el error diría «no existe en Storage», que es cierto y no explica nada.
"""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from uuid import UUID

#: Bucket propio, no `ai-assets`. Ver la cabecera de 0076: las políticas de `ai-assets`
#: exigen `is_platform_owner`, y un vídeo del pasillo lo sube el jefe de turno.
BUCKET = "perception-media"

#: La extensión la fija el MIME, no el nombre que traiga el archivo. Un `.exe` con
#: `content_type` de vídeo acaba como `.mp4`, y lo que Storage sirva no podrá
#: desmentir su propia extensión.
EXTENSION_POR_TIPO: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    # Lo que manda un navegador cuando no reconoce el archivo del drone. Se acepta
    # porque rechazarlo obligaría al operador a renombrar su propio vuelo, y la
    # extensión se deduce del nombre original en ese caso —es el único donde el
    # nombre manda, y solo porque no hay nada mejor—.
    "application/octet-stream": "bin",
}

#: Los mismos que declara el bucket en 0076. Escritos aquí también porque el rechazo
#: tiene que llegar como un 422 que dice qué se admite, no como un error de Storage.
TIPOS_ADMITIDOS = frozenset(EXTENSION_POR_TIPO)

#: 2 GiB, igual que el tope del bucket. Un vuelo de diez minutos en 4K pasa de 1 GB.
BYTES_MAX = 2 * 1024 * 1024 * 1024

_RUIDO = re.compile(r"[^a-z0-9._-]+")
_PUNTOS = re.compile(r"\.{2,}")
_NOMBRE_MAX = 80


def sanitizar_nombre(original: str, content_type: str) -> str:
    """Nombre de archivo seguro y determinista. Ver la nota de la cabecera."""
    # Los acentos se transliteran en vez de colapsarse: sin esto «camión» quedaría
    # como «cami-n» y el nombre deja de servir para reconocer el archivo en una lista.
    plano = (
        unicodedata.normalize("NFKD", original).encode("ascii", "ignore").decode("ascii")
    )
    # Ni separadores de Windows ni de POSIX sobreviven: el nombre es UN segmento, y un
    # `..\\..\\algo` que llegara entero rompería la comprobación de cuatro segmentos.
    base = plano.replace("\\", "/").rsplit("/", 1)[-1].strip().lower()
    base = _RUIDO.sub("-", base)
    base = _PUNTOS.sub(".", base).strip("-._")
    raiz = base.rsplit(".", 1)[0] if "." in base else base
    raiz = raiz[:_NOMBRE_MAX].strip("-._") or "medio"

    ext = EXTENSION_POR_TIPO.get(content_type, "bin")
    if ext == "bin":
        # Único caso donde el nombre original manda: el navegador no supo el tipo. Se
        # conserva su extensión si es plausible, porque `.bin` deja al worker sin
        # saber si decodificar vídeo o imagen.
        cola = base.rsplit(".", 1)[-1] if "." in base else ""
        if cola in set(EXTENSION_POR_TIPO.values()):
            ext = cola
    return f"{raiz}.{ext}"


def ruta_canonica(
    tenant_id: UUID,
    warehouse_id: UUID,
    media_id: UUID,
    content_type: str,
    original_filename: str,
) -> str:
    """La ruta la genera SIEMPRE el servidor. Cuatro segmentos, ni uno más.

    `core.perception_media_path_ok()` (0076) exige exactamente cuatro: con más, un
    `a/b/c/d/../../otro` navegaría fuera de su prefijo.
    """
    return (
        f"{tenant_id}/{warehouse_id}/{media_id}/"
        f"{sanitizar_nombre(original_filename, content_type)}"
    )


def prefijo_de_recortes(tenant_id: UUID, warehouse_id: UUID, job_id: UUID) -> str:
    """Donde van los recortes de la prueba visual (0091). TRES segmentos, no cuatro.

    ── POR QUE AQUI Y NO EN EL SERVICIO ──────────────────────────────────────────

    Porque la regla de la ruta ya vivia aqui, y tenerla escrita en dos sitios es
    exactamente como se rompio: `ruta_canonica` respetaba los cuatro segmentos y el
    prefijo de los recortes —escrito aparte, en el servicio— anadia una carpeta
    `recortes/` que hacia cinco. Storage rechazaba CADA subida con «new row violates
    row-level security policy», el worker lo tragaba recorte a recorte porque la prueba
    visual es un extra, y el analisis terminaba entero sin una sola imagen.

    Tres y no cuatro porque el worker anade el nombre del archivo detras: el total tiene
    que dar cuatro, que es lo que `core.perception_media_path_ok()` (0076) cuenta.

    El tercer segmento es el TRABAJO y no el medio: los recortes son de un analisis
    concreto, y reanalizar el mismo video tiene que poder dejar los suyos sin pisar los
    del anterior.
    """
    return f"{tenant_id}/{warehouse_id}/{job_id}"


def validar_medio(content_type: str, byte_count: int) -> str | None:
    """El motivo por el que este archivo no se admite, o `None` si se admite.

    Devuelve el motivo en vez de lanzar para que el servicio decida el tipo de error.
    Y lo comprueba el servidor aunque el bucket ya lo haga: un rechazo de Storage llega
    como un fallo de subida opaco, y este llega como un 422 que dice qué se admite.
    """
    if content_type not in TIPOS_ADMITIDOS:
        return (
            f"«{content_type}» no se admite. Formatos válidos: "
            + ", ".join(sorted(TIPOS_ADMITIDOS))
            + "."
        )
    if byte_count <= 0:
        return "El archivo está vacío."
    if byte_count > BYTES_MAX:
        return (
            f"{byte_count / 1024 / 1024:.0f} MB supera el límite de "
            f"{BYTES_MAX // 1024 // 1024} MB."
        )
    return None
