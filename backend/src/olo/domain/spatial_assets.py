"""LAS FIGURAS DEL PLANO: qué se admite, dónde van sus bytes y cuánto miden.

═══════════════════════════════════════════════════════════════════════════════
POR QUE UN MODULO DE DOMINIO Y NO CUATRO COMPROBACIONES EN EL SERVICIO

Porque son reglas, no fontanería: qué formatos se admiten, cuánto puede pesar un modelo,
cómo se construye su ruta y cuándo una escala es absurda. Todas se pueden comprobar sin
base de datos y sin red, y ahí es donde tienen que estar probadas.

La ruta, además, es la frontera del aislamiento entre operadores. Eso NUNCA puede vivir en
el cliente ni decidirse en el servicio a mano: se genera aquí, en un sitio, y la política
del bucket la vuelve a contar por su cuenta.

═══════════════════════════════════════════════════════════════════════════════
LO QUE YA COSTO APRENDER

`perception_media_path_ok` exige cuatro segmentos y el prefijo de los recortes añadía una
carpeta, que hacían cinco. Storage rechazaba CADA subida con «row-level security policy» y
el worker se lo tragaba recorte a recorte: dos análisis completos, 180 detecciones, cero
imágenes, y ningún fallo visible.

La lección no fue «contar mejor»: fue que la regla tiene que estar escrita UNA vez y
probada contando. `spatial_asset_path_ok` (0093) cuenta TRES, y `ruta_de_figura` los
produce.
"""

from __future__ import annotations

from uuid import UUID

#: El bucket de las figuras. Aparte de `perception-media` a proposito: un video se analiza
#: y se puede borrar, una figura la usan mil planos.
BUCKET_FIGURAS = "spatial-assets"

#: El literal del ambito de la biblioteca COMUN. No un UUID de relleno: un UUID falso se
#: confundiria con el de algun operador, y aqui la confusion es un fallo de aislamiento.
AMBITO_PLATAFORMA = "plataforma"

#: Los tipos que se admiten.
#:
#: glTF 2.0 y nada mas. Binario (`.glb`) es lo normal —un archivo con todo dentro— y el
#: `.gltf` de texto se admite porque algunas herramientas solo exportan eso, aunque
#: arrastre sus imagenes aparte.
#:
#: OBJ no lleva materiales de verdad, FBX es propietario y DWG el navegador ni lo abre.
TIPOS_DE_FIGURA: dict[str, str] = {
    "model/gltf-binary": "glb",
    "model/gltf+json": "gltf",
}

#: Las categorias. Lista CERRADA y no texto libre: la pantalla agrupa por esto, y con texto
#: libre acabaria con «dron», «drone», «Dron» y «dron dji» como cuatro familias distintas.
#:
#: Es la MISMA lista que el `CHECK` de 0093. Si divergieran, la pantalla ofreceria una
#: categoria que la base rechaza — y el error saldria al guardar, no al elegir—.
CATEGORIAS = frozenset(
    {
        "persona",
        "dron",
        "montacargas",
        "vehiculo",
        "tarima",
        "senal",
        "mobiliario",
        "otro",
    }
)

#: Tope por archivo, en bytes. 64 MB, el mismo que el bucket.
#:
#: Un modelo de almacen bien hecho pesa entre 1 y 10 MB. El tope corta el escaneado de
#: 400 MB que ningun navegador podria cargar — y que, subido, se descubriria tarde: al
#: abrir el plano, con la pestaña colgada—.
TOPE_BYTES = 64 * 1024 * 1024

#: Lo mas grande que puede medir una figura, en metros.
#:
#: 200 m es absurdo para una persona y sigue siendo posible para una nave. El tope no busca
#: adivinar la escala buena: busca cortar el error de UNIDAD —milimetros donde van metros—
#: que produce una figura de 1.700 m al lado de un rack de 12 y un plano inservible.
TOPE_METROS = 200.0


def validar_figura(content_type: str, byte_count: int) -> str | None:
    """El motivo por el que este archivo no se admite, o `None` si se admite.

    Devuelve el motivo en vez de lanzar para que quien llame decida el tipo de error. Es el
    mismo criterio que `validar_medio`.
    """
    if content_type not in TIPOS_DE_FIGURA:
        admitidos = ", ".join(sorted(TIPOS_DE_FIGURA))
        return (
            f"El formato {content_type or 'sin declarar'} no se admite. "
            f"Hace falta glTF 2.0: {admitidos}. Un `.glb` es un archivo con la geometria, "
            f"los materiales y la animacion dentro."
        )
    if byte_count <= 0:
        return "El archivo esta vacio."
    if byte_count > TOPE_BYTES:
        return (
            f"El archivo pesa {byte_count / 1e6:.0f} MB y el tope es "
            f"{TOPE_BYTES // (1024 * 1024)} MB. Un modelo de almacen bien hecho pesa entre "
            f"1 y 10 MB; por encima del tope el navegador no podria cargarlo."
        )
    return None


def sanitizar_nombre_de_archivo(original: str, content_type: str) -> str:
    """Un nombre de archivo seguro, con la extension que corresponde al tipo.

    No se confia en el nombre que manda el cliente: se conserva solo lo reconocible y la
    extension la pone el TIPO, no lo que venga escrito. Un `.glb` llamado `x.exe` seguiria
    siendo un `.glb`, pero el nombre no tiene por que mentir.
    """
    ext = TIPOS_DE_FIGURA[content_type]
    raiz = "".join(c if (c.isalnum() or c in "-_") else "-" for c in original.rsplit(".", 1)[0])
    raiz = raiz.strip("-")[:60] or "figura"
    return f"{raiz}.{ext}"


def ruta_de_figura(
    tenant_id: UUID | None,
    model_id: UUID,
    original_filename: str,
    content_type: str,
) -> str:
    """La ruta la genera SIEMPRE el servidor. TRES segmentos, ni uno mas.

    `core.spatial_asset_path_ok()` (0093) exige exactamente tres: con mas, un
    `a/b/c/../../otro` navegaria fuera de su prefijo. Contar es lo que lo impide.

    `tenant_id` a `None` es la biblioteca COMUN, y su primer segmento es el literal
    `plataforma`. Solo el Platform Owner puede escribir ahi — lo comprueba la politica del
    bucket, no esta funcion—.
    """
    ambito = AMBITO_PLATAFORMA if tenant_id is None else str(tenant_id)
    return f"{ambito}/{model_id}/{sanitizar_nombre_de_archivo(original_filename, content_type)}"


def validar_medidas(
    size_x_m: float | None,
    size_y_m: float | None,
    size_z_m: float | None,
) -> str | None:
    """El motivo por el que estas medidas no valen, o `None`.

    ── POR QUE SE MIDE Y NO SE SUPONE ────────────────────────────────────────────

    Un `.glb` no declara en que unidad esta. glTF dice que las unidades son metros, pero
    quien exporta desde Blender sin tocar nada saca centimetros, y quien exporta un CAD
    saca milimetros. Una persona de 170 m al lado de un rack de 12 no es un detalle: hace
    el plano inservible y no hay forma de saber que paso mirando la figura.

    Asi que las medidas se toman del modelo al subirlo y se guardan. Si vienen mal, la
    escala las corrige — y queda escrito que se corrigieron—.
    """
    for nombre, v in (("ancho", size_x_m), ("alto", size_y_m), ("fondo", size_z_m)):
        if v is None:
            continue
        if v <= 0:
            return f"El {nombre} del modelo es {v}. Una medida de cero o negativa no existe."
        if v > TOPE_METROS:
            return (
                f"El {nombre} del modelo mide {v:.0f} m, por encima del tope de "
                f"{TOPE_METROS:.0f} m. Casi seguro que el archivo esta en milimetros o en "
                f"centimetros: corrigelo con la escala en vez de subirlo asi."
            )
    return None


def escala_sugerida(
    alto_m: float | None,
    alto_tipico_m: float | None,
) -> float | None:
    """Por cuanto habria que multiplicar para que el alto cuadre con lo tipico.

    ── PARA QUE SIRVE, Y QUE NO HACE ─────────────────────────────────────────────

    Para que la pantalla pueda decir «esto mide 170 m; una persona mide 1,7 — ¿multiplico
    por 0,01?» en vez de dejar a alguien tecleando ceros. Es una SUGERENCIA: no se aplica
    sola, porque adivinar la escala de un modelo ajeno y guardarla como dato seria inventar
    una medida, que es justo lo que este sistema no hace.

    `None` cuando no hay con que comparar. Un cociente absurdo tambien devuelve `None`: si
    el modelo mide 1,8 y lo tipico es 1,7 no hay nada que sugerir, y proponer «x 0,94»
    invita a estropear un modelo que ya estaba bien.
    """
    if not alto_m or not alto_tipico_m or alto_m <= 0 or alto_tipico_m <= 0:
        return None
    factor = alto_tipico_m / alto_m
    #  Entre 0,5 y 2 no se sugiere nada: ahi la diferencia es de modelado, no de unidad.
    if 0.5 <= factor <= 2:
        return None
    return round(factor, 6)


#: Alto tipico de cada categoria, en metros. Solo para SUGERIR una escala.
#:
#: No se guarda como medida de nada: es una referencia para detectar un error de unidad de
#: tres ordenes de magnitud, no una afirmacion sobre el modelo de nadie.
ALTO_TIPICO_M: dict[str, float] = {
    "persona": 1.7,
    "dron": 0.3,
    "montacargas": 2.2,
    "vehiculo": 2.5,
    "tarima": 1.5,
    "senal": 2.0,
    "mobiliario": 1.0,
}
