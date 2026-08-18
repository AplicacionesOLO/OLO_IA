"""QUE SE PUEDE SACAR DE UN MATERIAL, Y QUE NO.

═══════════════════════════════════════════════════════════════════════════════════════
LOS NUMEROS DE AQUI ESTAN MEDIDOS, NO ELEGIDOS

Sobre las 703 etiquetas de codigo detectadas en los cuatro videos analizados hasta hoy,
cruzando el ancho de cada etiqueta en pixeles con si se consiguio decodificar:

        ancho de la etiqueta        se leyo
        ────────────────────        ───────
        0 - 200 px                    9 %
        200 - 400 px                 31 %
        400 - 600 px                 61 %
        600 - 800 px                 72 %
        1200 px o mas             86-100 %

De ahi salen los dos umbrales de este modulo. No hay nada magico en ellos: son el punto
donde la curva deja de ser una perdida de tiempo y el punto donde se vuelve fiable.

═══════════════════════════════════════════════════════════════════════════════════════
Y LA RESOLUCION DEL VIDEO NO ES LA VARIABLE

Es la conclusion que mas cuesta aceptar, porque «graba en 8K» suena a respuesta. Medido:

        video                     imagen        etiqueta   se lee
        ─────────────────────     ───────────   ────────   ──────
        dataset7 / Video9/10      4320 x 7680     615 px    66-84 %
        DJI ...0008_D             3840 x 2160     199 px     3,8 %

El ancho de imagen difiere un 12 %. El de la etiqueta, un 300 %. Los que funcionan son de
movil a un metro del rack; el que falla es de dron a distancia. Subir de 4K a 8K el MISMO
vuelo habria dejado la etiqueta en 224 px: seguiria sin leerse.

Lo que decide es cuantos pixeles de sensor caen sobre la etiqueta, y eso lo manda la
distancia mucho mas que el sensor. Por eso este modulo razona en pixeles de etiqueta y no
en «4K» ni «8K».
"""

from __future__ import annotations

from dataclasses import dataclass

#: Las clases que SON un codigo, y por tanto las unicas cuyo tamaño explica si el material
#: sirve para identificar. Un `pallet` grande en primer plano no dice nada sobre si su
#: etiqueta se puede leer, asi que mezclarlas falsearia la mediana hacia arriba.
#:
#: Vive aqui y no en el worker porque el diagnostico lo calcula el backend sobre lo que ya
#: esta en la base: dos listas separadas medirian cosas distintas del mismo analisis.
CLASES_DE_CODIGO = frozenset({"qr_ubicacion", "qr_pallet"})

#: Por debajo de esto la lectura es anecdotica: 9 % en el tramo 0-200 px. Un material asi
#: sirve para saber DONDE hay un palet, no para saber CUAL.
ANCHO_MINIMO_LEGIBLE = 200

#: A partir de aqui se lee la mayoria (61 % en 400-600, 72 % despues). Es el objetivo al
#: que hay que acercar la camara, no un limite duro.
ANCHO_COMODO_LEGIBLE = 400

#: El lado al que RF-DETR redimensiona lo que le entra. Todo lo que se le manda pasa por
#: aqui, asi que una etiqueta de 199 px en un fotograma de 3840 llega con 38.
LADO_MODELO = 736

#: Por debajo de este tamaño EN LA ENTRADA DEL MODELO, el detector empieza a perder
#: objetos. La convencion de COCO llama «pequeño» a lo que baja de 32 px de lado; 56 deja
#: margen para que no se pierdan justo los que interesan.
LADO_MINIMO_EN_ENTRADA = 56

#: Cuantas piezas como mucho. No es un limite de calidad sino de sentido comun: un
#: fotograma vertical de 8K sale en 91 trozos, o sea 91 pasadas del modelo por fotograma.
#: Un analisis de 20 minutos pasaria a 30 horas para recuperar detecciones que, con
#: etiquetas de 615 px, ya se estaban haciendo bien. Cuando trocear cuesta esto, la
#: respuesta no es trocear: es acercar la camara.
MAXIMO_DE_TROZOS = 30


@dataclass(frozen=True)
class Decision:
    """Si se trocea, con que lado, y por que. El `motivo` se imprime y se guarda."""

    lado: int
    motivo: str

    @property
    def trocea(self) -> bool:
        return self.lado > 0


def cuantos_trozos(ancho: int, alto: int, lado: int, solape: float = 0.2) -> int:
    """Cuantas piezas saldrian. Es el recuento de `_rejilla` sin construir la lista.

    Vive aqui y no en el worker porque la decision de trocear necesita el COSTE antes de
    trocear, y el worker necesita la rejilla despues. Duplicar la cuenta a ojo —«ancho
    entre lado»— se olvidaria del solape y daria 5 donde hay 8.
    """
    lado_x, lado_y = min(lado, ancho), min(lado, alto)
    if lado_x <= 0 or lado_y <= 0:
        return 0
    paso_x = max(1, int(lado_x * (1 - solape)))
    paso_y = max(1, int(lado_y * (1 - solape)))
    n_x = len(range(0, max(1, ancho - lado_x + 1), paso_x))
    n_y = len(range(0, max(1, alto - lado_y + 1), paso_y))
    #  El ultimo se pega al borde si no llegaba, igual que en `_rejilla`.
    if (n_x - 1) * paso_x + lado_x < ancho:
        n_x += 1
    if (n_y - 1) * paso_y + lado_y < alto:
        n_y += 1
    return n_x * n_y


def decidir_trozos(
    *,
    ancho: int,
    alto: int,
    ancho_mediano_etiqueta: float | None,
    lado: int = LADO_MODELO,
) -> Decision:
    """Si conviene analizar tambien por trozos, visto lo que la sonda encontro.

    `ancho_mediano_etiqueta` es lo que midio la sonda en pixeles del fotograma, o `None`
    si no encontro ninguna etiqueta.

    ── LAS TRES SALIDAS ──────────────────────────────────────────────────────────

    1. NO HACE FALTA. La etiqueta ya llega al modelo con tamaño de sobra. Es el caso de
       los videos de 8K vertical: 615 px reales entre una reduccion de 10,4 son 59 px de
       entrada. Trocear ahi multiplica el tiempo por 91 para no cambiar el resultado.

    2. NO COMPENSA. Haria falta, pero la rejilla se dispara. Se dice, porque un material
       que necesita 91 trozos esta pidiendo a gritos otra cosa: acercar la camara.

    3. SE TROCEA. Es el caso del 4K a distancia: 38 px de entrada, 24 trozos.

    ── LO QUE ESTO NO ARREGLA, Y HAY QUE DECIRLO ─────────────────────────────────

    Trocear mejora la DETECCION, no la lectura. El recorte que se manda al decodificador
    sale del fotograma completo a resolucion nativa —`marco[cy1:cy2, cx1:cx2]`—, asi que
    una etiqueta de 199 px mide 199 px se trocee o no. Lo que se gana es encontrar
    etiquetas y palets que el reescalado borraba, que es cuantos huecos se pueden dar por
    mirados; lo que NO se gana es identificarlos.
    """
    if ancho <= 0 or alto <= 0:
        return Decision(0, "no se sabe cuanto mide el fotograma")

    reduccion = max(ancho, alto) / lado
    piezas = cuantos_trozos(ancho, alto, lado)

    if ancho_mediano_etiqueta is None:
        #  La sonda no vio ninguna etiqueta. Es justo el sintoma que los trozos atacan
        #  —objetos que el reescalado borra— asi que se trocea si el coste lo permite. Y
        #  si no lo permite, no hay nada que trocear pueda arreglar.
        if piezas > MAXIMO_DE_TROZOS:
            return Decision(
                0,
                f"la sonda no encontro ninguna etiqueta y trocear saldria por {piezas} "
                f"pasadas por fotograma: no compensa",
            )
        return Decision(
            lado, f"la sonda no encontro ninguna etiqueta; se trocea en {piezas} piezas"
        )

    en_entrada = ancho_mediano_etiqueta / reduccion
    if en_entrada >= LADO_MINIMO_EN_ENTRADA:
        return Decision(
            0,
            f"las etiquetas llegan al modelo con {en_entrada:.0f} px y con "
            f"{LADO_MINIMO_EN_ENTRADA} basta: trocear no aportaria",
        )
    if piezas > MAXIMO_DE_TROZOS:
        return Decision(
            0,
            f"las etiquetas llegan al modelo con {en_entrada:.0f} px, pero trocear "
            f"saldria por {piezas} pasadas por fotograma: no compensa",
        )
    return Decision(
        lado,
        f"las etiquetas llegan al modelo con {en_entrada:.0f} px de "
        f"{ancho_mediano_etiqueta:.0f} reales; se trocea en {piezas} piezas",
    )


# ═══════════════════════════════════════════════════════════════════════════════════════
# EL DIAGNOSTICO: POR QUE ESTE MATERIAL NO LEYO NADA
#
# Este bloque existe por lo que costo averiguarlo la primera vez. Un analisis devolvio 545
# detecciones y cero codigos de pallet, y para entender por que hubo que bajar el video,
# medirlo, sacar recortes, mirarlos y cruzar 703 etiquetas contra su tasa de lectura. Nada
# de eso estaba en la pantalla: el trabajo decia «completado» y ya.
#
# Todo lo que hizo falta para el diagnostico esta en la base en cuanto termina el analisis.
# Lo unico que faltaba era decirlo.
# ═══════════════════════════════════════════════════════════════════════════════════════

#: Por debajo de esta proporcion de lectura, el material no sirve para identificar. No es un
#: numero fino: con 199 px medidos sale un 4 % y con 615 px un 72 %, asi que cualquier corte
#: entre medias separa los dos mundos igual de bien.
LECTURA_ACEPTABLE = 0.35


@dataclass(frozen=True)
class Diagnostico:
    """Que se pudo sacar de este material, y que habria hecho falta."""

    etiquetas: int
    leidas: int
    ancho_mediano: float | None
    veredicto: str
    """`sin_etiquetas`, `sin_medida`, `ilegible`, `justo` o `bien`. Vocabulario cerrado:
    la pantalla pinta por el, y una cadena libre la obligaria a adivinar."""
    mensaje: str
    acercarse: float | None
    """Cuanto habria que acercar la camara para llegar al tamaño comodo, o `None` si ya
    esta. Un 2,0 es «a la mitad de la distancia»."""

    @property
    def tasa(self) -> float:
        return self.leidas / self.etiquetas if self.etiquetas else 0.0


def diagnosticar(etiquetas: list[tuple[float, bool]]) -> Diagnostico:
    """El veredicto a partir de las etiquetas una a una: `(ancho en pixeles, se leyo)`.

    Es la puerta comoda cuando ya se tienen delante —el worker las tiene—. Quien las
    tenga en la base no debe traerselas: `diagnosticar_resumen` toma los tres numeros que
    SQL sabe calcular solo, y un analisis grande son ocho mil filas.
    """
    total = len(etiquetas)
    if total == 0:
        return diagnosticar_resumen(etiquetas=0, leidas=0, ancho_mediano=None)
    anchos = sorted(a for a, _ in etiquetas)
    mitad = total // 2
    return diagnosticar_resumen(
        etiquetas=total,
        leidas=sum(1 for _, ok in etiquetas if ok),
        ancho_mediano=(anchos[mitad] if total % 2 else (anchos[mitad - 1] + anchos[mitad]) / 2),
    )


def diagnosticar_resumen(
    *, etiquetas: int, leidas: int, ancho_mediano: float | None
) -> Diagnostico:
    """El veredicto sobre un analisis ya hecho, desde el resumen.

    ── POR QUE EL MENSAJE HABLA DE DISTANCIA Y NO DE RESOLUCION ──────────────────

    Porque medido es lo que manda, y porque «graba en 8K» es un consejo que cuesta dinero
    y no habria arreglado nada: el mismo vuelo en 8K habria dejado la etiqueta en 224 px
    donde hacen falta 400. Volar a la mitad de distancia la deja en 398.
    """
    total = etiquetas
    if total == 0:
        return Diagnostico(
            etiquetas=0,
            leidas=0,
            ancho_mediano=None,
            veredicto="sin_etiquetas",
            mensaje=(
                "No se detecto ninguna etiqueta de codigo en todo el material. O no las "
                "hay en el encuadre, o son tan pequeñas que el detector no las distingue."
            ),
            acercarse=None,
        )

    if ancho_mediano is None:
        #  Hay etiquetas y no se sabe cuanto miden: falta el ancho del video. Son dos
        #  cosas distintas y colapsarlas diria «no se detecto ninguna etiqueta» sobre un
        #  analisis que detecto 162 — una respuesta falsa a la pregunta que se hizo—.
        return Diagnostico(
            etiquetas=total,
            leidas=leidas,
            ancho_mediano=None,
            veredicto="sin_medida",
            mensaje=(
                f"Se detectaron {total} etiquetas de codigo y se leyeron {leidas}. No se "
                f"puede decir si el tamaño es el problema porque no consta cuanto mide el "
                f"video: al volver a analizarlo, el worker anota las medidas."
            ),
            acercarse=None,
        )

    mediana = ancho_mediano
    tasa = leidas / total
    falta = ANCHO_COMODO_LEGIBLE / mediana if mediana > 0 else None
    acercarse = round(falta, 1) if falta and falta > 1.1 else None

    if tasa >= LECTURA_ACEPTABLE and mediana >= ANCHO_MINIMO_LEGIBLE:
        return Diagnostico(
            etiquetas=total,
            leidas=leidas,
            ancho_mediano=mediana,
            veredicto="bien",
            mensaje=(
                f"Se leyeron {leidas} de {total} etiquetas. Miden {mediana:.0f} px de "
                f"ancho, que es tamaño de sobra para decodificarlas."
            ),
            acercarse=acercarse,
        )

    #  Se ve algo pero poco: el material sirve a medias y conviene decir cuanto falta.
    if mediana >= ANCHO_MINIMO_LEGIBLE:
        return Diagnostico(
            etiquetas=total,
            leidas=leidas,
            ancho_mediano=mediana,
            veredicto="justo",
            mensaje=(
                f"Se leyeron {leidas} de {total} etiquetas. Miden {mediana:.0f} px y a "
                f"ese tamaño se lee alrededor de una de cada tres: sirve para localizar "
                f"pallets, y para identificarlos solo a ratos."
                + (f" Acercandose {acercarse}x se leerian casi todas." if acercarse else "")
            ),
            acercarse=acercarse,
        )

    return Diagnostico(
        etiquetas=total,
        leidas=leidas,
        ancho_mediano=mediana,
        veredicto="ilegible",
        mensaje=(
            f"Se detectaron {total} etiquetas y solo se pudo leer {leidas}. Miden "
            f"{mediana:.0f} px de ancho y hacen falta unos {ANCHO_COMODO_LEGIBLE} para "
            f"decodificarlas: a este tamaño el codigo no esta en la imagen, asi que no "
            f"hay ajuste de software que lo recupere."
            + (
                f" Lo que lo cambia es acercar la camara unas {acercarse} veces —volar mas "
                f"bajo o mas cerca del rack—; subir la resolucion casi no mueve este numero."
                if acercarse
                else ""
            )
        ),
        acercarse=acercarse,
    )
