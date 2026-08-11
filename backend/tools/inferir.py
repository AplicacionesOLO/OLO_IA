"""Worker de inferencia: coge un trabajo encolado, analiza el medio, y deposita lo leído.

═══════════════════════════════════════════════════════════════════════════════
ESTO ES LA PIEZA QUE FALTABA

Hasta ahora `worker_available` era la constante `False` y la pantalla lo decía:
«los trabajos en cola esperan y no van a avanzar solos». Era verdad. Este guion es lo
que la vuelve mentira, y por eso 0075 convirtió esa constante en un latido.

Es un GUION y no un endpoint por lo mismo que `entrenar.py`: decodificar un vídeo de
1 GB y pasarlo por un modelo tarda minutos y quiere GPU. Dentro de la API sería un
proceso web bloqueado sin forma de repartir el trabajo, y sin poder analizar en una
máquina y servir en otra.

═══════════════════════════════════════════════════════════════════════════════
LO QUE HACE, EN ORDEN

  1. late en `/perception/workers/heartbeat` y sigue latiendo en segundo plano
  2. pide un trabajo `queued`
  3. lo mueve a `running`
  4. pide la URL firmada del medio y lo descarga
  5. decodifica los fotogramas que toque según `frame_sampling_rate`
  6. corre el modelo sobre cada uno; si el `pipeline` lleva OCR, lee el texto
  7. `POST /detections` con todo el lote, que además cierra el trabajo

Si algo falla entre 3 y 7, cierra el trabajo como `failed` CON el motivo. Un trabajo
que se queda en `running` para siempre porque el proceso murió es peor que uno fallido:
parece que sigue trabajando y nadie va a mirarlo.

═══════════════════════════════════════════════════════════════════════════════
SIN LAS LIBRERÍAS NO ANALIZA, Y NO FINGE

Si falta `opencv-python` o `rfdetr`, este guion NO manda detecciones inventadas ni
cierra el trabajo como si hubiera analizado: se detiene y lo dice, y el trabajo
sigue encolado para que lo coja una maquina que si pueda.

    pip install opencv-python rfdetr    # rfdetr arrastra torch: ~2,5 GB
    pip install easyocr                 # solo si el pipeline lleva OCR

RF-DETR y no YOLO por LICENCIA, no por preferencia: la migracion 0061 desactivo las
11 arquitecturas de Ultralytics porque son AGPL-3.0 y OLO_IA es SaaS multi-tenant.
Ver la nota de `_cargar_modelo`.

La diferencia entre «todavía no hay con qué analizar» y «se analizó y esto se vio» es
la que decide si alguien mueve mercancía. Confundirlas metería en la base detecciones
que nadie vio nunca.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ EL LATIDO VA EN UN HILO

Analizar un vídeo de diez minutos tarda más que la ventana de 90 s de 0075. Con el
latido en el bucle principal, el worker se declararía muerto a sí mismo a mitad del
primer trabajo y la pantalla diría que no hay quien procese mientras procesa. El hilo
late cada 30 s pase lo que pase en el principal.

═══════════════════════════════════════════════════════════════════════════════
USO

    python tools/inferir.py --listar          # qué hay en cola y quién está vivo
    python tools/inferir.py                   # coge el siguiente y sale
    python tools/inferir.py --bucle           # se queda esperando trabajo
    python tools/inferir.py --job <uuid>      # uno concreto
    python tools/inferir.py --pesos <ruta.pth>    # con un checkpoint local
    python tools/inferir.py --segundos 60         # corta un directo al minuto
    python tools/inferir.py --job <uuid> --seco   # sin modelo, para probar la fontanería

`--seco` recorre el ciclo completo —late, descarga, decodifica, cuenta fotogramas— SIN
correr ningún modelo, y cierra el trabajo como `failed` con el motivo «prueba en seco».
Sirve para comprobar la subida, la firma y la descarga en una máquina sin GPU sin dejar
detecciones falsas en la base.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import platform
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

#  La sesión renovable vive aparte: la necesitan este guion y el entrenador, y por el
#  mismo motivo — los dos corren más de una hora y el token dura una.
from sesion import Sesion

VERSION = "0.1.0"
SECRETS = Path(r"C:\OLO_IA\.secrets")

#: Cada cuánto late. La ventana de 0075 son 90 s, así que tolera dos perdidos.
LATIDO_S = 30

#: Cada cuántos segundos se manda un lote en un directo. Ni por fotograma —una
#: petición cada 500 ms— ni al final, porque un directo no tiene final y las
#: detecciones no aparecerían nunca en la pantalla.
LOTE_S = 5


# ═══════════════════════════════════════════════════════════════════════════
# CLIENTE
#
# `urllib` y no `httpx`, por lo mismo que en `entrenar.py`: este guion tiene que poder
# correr en una máquina de GPU que solo tenga Python, sin las dependencias del backend.
# Cada `import` extra es una razón más para que no arranque justo donde hace falta.
# ═══════════════════════════════════════════════════════════════════════════
if TYPE_CHECKING:
    from collections.abc import Callable


#: Cada cuánto se le cuenta a la API lo que se lleva analizado. Más frecuente que el
#: refresco de la pantalla —dos segundos—, así que el cuello nunca es este; y agrupado por
#: tiempo y no por fotogramas, porque un vídeo rápido daría decenas de peticiones por
#: segundo y uno lento dejaría la pantalla parada medio minuto.
INTERVALO_AVISO_S = 1.5

#: Cuánto se solapan los trozos. Un 20 % garantiza que cualquier objeto más pequeño que el
#: solape aparezca ENTERO en algún trozo — y los códigos, que son lo que se persigue, lo son
#: siempre. Más solape es más trozos para el mismo fotograma, o sea más tiempo.
SOLAPE_TROZOS = 0.2


class Api:
    def __init__(self, base: str, sesion: Sesion) -> None:
        # El esquema se COMPRUEBA. `urlopen` acepta `file:`, así que un
        # `--api file:///c:/algo` leería el disco local creyendo hablar con la API. Es
        # la clase de cosa que no falla: devuelve algo.
        if not base.startswith(("http://", "https://")):
            msg = f"--api tiene que ser http o https, no {base.split(':', 1)[0]!r}"
            raise ValueError(msg)
        self._base = base.rstrip("/")
        self._sesion = sesion

    def _pedir(self, metodo: str, ruta: str, cuerpo: Any = None) -> Any:
        #  Dos intentos y no mas: el primero con el token que toque, el segundo con uno
        #  recien pedido. Un bucle de reintentos ante un 401 que no fuera de caducidad
        #  daria vueltas pidiendo credenciales para siempre.
        for intento in (1, 2):
            token = self._sesion.vigente() if intento == 1 else self._sesion.token
            generacion = self._sesion.generacion
            req = urllib.request.Request(
                f"{self._base}{ruta}",
                method=metodo,
                data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req) as r:
                    crudo = r.read()
                    return json.loads(crudo)["data"] if crudo else None
            except urllib.error.HTTPError as e:
                if e.code == 401 and intento == 1:
                    #  401 es «tu token ya no vale», y aqui eso casi siempre significa que
                    #  caduco. 403 NO entra: eso es «no tienes permiso», y pedir otro token
                    #  no cambia los permisos — reintentarlo solo esconderia el problema.
                    e.read()
                    self._sesion.renovar(generacion)
                    print("  sesion renovada tras un 401", flush=True)
                    continue
                detalle = e.read().decode("utf-8", "replace")[:600]
                msg = f"HTTP {e.code} en {metodo} {ruta}: {detalle}"
                raise RuntimeError(msg) from e
        msg = f"no se pudo completar {metodo} {ruta} ni renovando la sesion"
        raise RuntimeError(msg)

    def get(self, ruta: str) -> Any:
        return self._pedir("GET", ruta)

    def post(self, ruta: str, cuerpo: Any = None) -> Any:
        return self._pedir("POST", ruta, cuerpo)

    @staticmethod
    def descargar(url: str, destino: Path) -> Path:
        """Descarga la URL FIRMADA del medio. Va sin cabeceras: la firma es la
        autorización, y añadir un Bearer de la API a una petición a Storage no aporta."""
        if not url.startswith(("http://", "https://")):
            msg = "la url firmada no es http(s)"
            raise ValueError(msg)
        with (
            urllib.request.urlopen(url) as r,
            destino.open("wb") as f,
        ):
            shutil.copyfileobj(r, f)
        return destino




# ═══════════════════════════════════════════════════════════════════════════
# DEPENDENCIAS
# ═══════════════════════════════════════════════════════════════════════════
def _hay(modulo: str) -> bool:
    try:
        __import__(modulo)
    except ImportError:
        return False
    return True


def _dispositivo() -> str:
    """`cuda:0`, `mps` o `cpu`. Se guarda en el registro: cuando un trabajo salga mal,
    la primera pregunta va a ser con qué se procesó."""
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda:0"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


# ═══════════════════════════════════════════════════════════════════════════
# LATIDO EN SEGUNDO PLANO
# ═══════════════════════════════════════════════════════════════════════════
class Latido:
    """Late cada 30 s en un hilo aparte. Ver la nota de la cabecera.

    Los fallos del latido se TRAGAN a propósito. Un corte de red de diez segundos no
    debe abortar un análisis de veinte minutos: la consecuencia de perder un latido es
    que la pantalla diga «no hay worker» un rato, y la de abortar el trabajo es perder
    el trabajo.
    """

    def __init__(self, api: Api, nombre: str, capacidades: list[str], device: str) -> None:
        self._api = api
        self._cuerpo: dict[str, Any] = {
            "kind": "inference",
            "name": nombre,
            "capabilities": capacidades,
            "agent_version": VERSION,
            "device": device,
            "current_job": None,
        }
        self._parar = threading.Event()
        self._hilo: threading.Thread | None = None
        self._lock = threading.Lock()

    def latir_ahora(self) -> dict[str, Any]:
        """Un latido sincrónico. El primero SÍ propaga el fallo: si el registro no
        funciona, mejor saberlo antes de empezar a analizar."""
        with self._lock:
            cuerpo = dict(self._cuerpo)
        return dict(self._api.post("/v1/perception/workers/heartbeat", cuerpo))

    def en_trabajo(self, job_id: str | None) -> None:
        with self._lock:
            self._cuerpo["current_job"] = job_id

    def arrancar(self) -> None:
        def bucle() -> None:
            while not self._parar.wait(LATIDO_S):
                try:
                    self.latir_ahora()
                except Exception as exc:
                    print(f"  (latido perdido: {exc})", flush=True)

        self._hilo = threading.Thread(target=bucle, daemon=True, name="latido")
        self._hilo.start()

    def detener(self) -> None:
        self._parar.set()
        if self._hilo:
            self._hilo.join(timeout=2)


# ═══════════════════════════════════════════════════════════════════════════
# DECODIFICAR
# ═══════════════════════════════════════════════════════════════════════════
def _fotogramas(
    ruta: Path, es_video: bool, fps_objetivo: float | None
) -> tuple[list[tuple[int, int, Any]], int]:
    """Los fotogramas a analizar —`(numero, ms, imagen)`— y CUANTOS tiene el vídeo.

    Se muestrea según `frame_sampling_rate` del trabajo, que es lo que el operador
    eligió. Analizar los 25 fps de un vídeo de diez minutos son 15.000 fotogramas para
    ver lo mismo que en 600: un rack no cambia entre dos fotogramas consecutivos.

    ── EL RECUENTO SALE DEL RECORRIDO, NO DE `CAP_PROP_FRAME_COUNT` ───────────────

    Este bucle ya lee TODOS los fotogramas —muestrear decide cuáles se analizan, no
    cuáles se leen—, así que al terminar el índice es el recuento exacto. Y es mejor dato
    que `CAP_PROP_FRAME_COUNT`, que en muchos contenedores es una estimación de la
    cabecera: duración por cadencia declarada, redondeado.

    Hace falta porque nadie más lo sabe. El navegador conoce la duración y las medidas al
    subir, pero no hay API que le diga el recuento, así que `perception.media.total_frames`
    quedaba nulo — y sin él se pierde la cadencia real del material.
    """
    import cv2

    if not es_video:
        img = cv2.imread(str(ruta))
        if img is None:
            msg = f"no se pudo leer la imagen {ruta.name}"
            raise RuntimeError(msg)
        #  Una foto es un fotograma. El recuento va a cero porque no es un vídeo y
        #  anotarle un «1» haría que pareciera un vídeo de un solo fotograma.
        return [(0, 0, img)], 0

    cap = cv2.VideoCapture(str(ruta))
    if not cap.isOpened():
        msg = f"no se pudo abrir el video {ruta.name}"
        raise RuntimeError(msg)
    try:
        fps_real = cap.get(cv2.CAP_PROP_FPS) or 25.0
        # Cada cuántos fotogramas se coge uno. `max(1, ...)` porque pedir más fps de
        # los que tiene el vídeo no puede inventar fotogramas: se coge cada uno.
        paso = max(1, round(fps_real / (fps_objetivo or fps_real)))
        salida: list[tuple[int, int, Any]] = []
        indice = 0
        while True:
            ok, marco = cap.read()
            if not ok:
                break
            if indice % paso == 0:
                salida.append((indice, int(indice / fps_real * 1000), marco))
            indice += 1
        return salida, indice
    finally:
        cap.release()


# ═══════════════════════════════════════════════════════════════════════════
# TROZOS — para que los objetos pequeños lleguen al modelo con forma
#
# RF-DETR redimensiona lo que le entra al tamaño con el que se entrenó: 736 px de lado en
# el modelo actual. Un fotograma de 2160 por 3840 —lo que graba el móvil en 4K— se reduce casi
# seis veces antes de que el modelo lo vea, así que un código QR de 100 px acaba en 18. A
# ese tamaño no hay nada que detectar, por bien entrenado que esté el modelo.
#
# La solución estándar es analizar por trozos: se corta el fotograma en piezas del tamaño
# de la entrada del modelo, cada pieza se analiza a su resolución nativa —sin reducir— y
# las cajas se devuelven a coordenadas del fotograma completo.
#
# Cuesta lo que parece: un fotograma en 15 trozos son 15 pasadas del modelo. Es la razón de
# que esto sea opcional y no el comportamiento por omisión.
# ═══════════════════════════════════════════════════════════════════════════
def _rejilla(ancho: int, alto: int, lado: int, solape: float) -> list[tuple[int, int, int, int]]:
    """Los rectángulos `(x0, y0, x1, y1)` en que se corta un fotograma.

    ── EL SOLAPE NO ES OPCIONAL ──────────────────────────────────────────────────

    Sin solape, un objeto que caiga sobre una junta queda partido en dos mitades y ninguna
    de las dos se parece a lo que el modelo aprendió. Con un 20 %, cualquier objeto más
    pequeño que el solape aparece ENTERO en al menos un trozo — y para códigos, que son lo
    que se persigue aquí, eso siempre se cumple.

    El paso se ajusta para que los trozos cubran justo el fotograma: el último se pega al
    borde en vez de salirse. Así no hay franjas negras que el modelo tenga que interpretar.
    """
    if lado <= 0:
        msg = "el lado del trozo tiene que ser positivo"
        raise ValueError(msg)
    lado_x, lado_y = min(lado, ancho), min(lado, alto)
    paso_x = max(1, int(lado_x * (1 - solape)))
    paso_y = max(1, int(lado_y * (1 - solape)))

    xs = list(range(0, max(1, ancho - lado_x + 1), paso_x))
    ys = list(range(0, max(1, alto - lado_y + 1), paso_y))
    if xs[-1] + lado_x < ancho:
        xs.append(ancho - lado_x)
    if ys[-1] + lado_y < alto:
        ys.append(alto - lado_y)

    return [(x, y, x + lado_x, y + lado_y) for y in ys for x in xs]


def _iou(a: dict[str, Any], b: dict[str, Any]) -> float:
    """Cuánto se solapan dos cajas normalizadas, de 0 a 1."""
    ax2, ay2 = a["bbox_x"] + a["bbox_width"], a["bbox_y"] + a["bbox_height"]
    bx2, by2 = b["bbox_x"] + b["bbox_width"], b["bbox_y"] + b["bbox_height"]
    ix = max(0.0, min(ax2, bx2) - max(a["bbox_x"], b["bbox_x"]))
    iy = max(0.0, min(ay2, by2) - max(a["bbox_y"], b["bbox_y"]))
    interseccion = ix * iy
    if interseccion <= 0:
        return 0.0
    union = (
        a["bbox_width"] * a["bbox_height"] + b["bbox_width"] * b["bbox_height"] - interseccion
    )
    return interseccion / union if union > 0 else 0.0


def _fusionar(candidatas: list[dict[str, Any]], umbral_iou: float = 0.5) -> list[dict[str, Any]]:
    """Quita las repetidas que dejan los trozos solapados.

    Un objeto en la zona de solape lo ven DOS trozos, y sin esto entraría dos veces: el
    recuento diría el doble y la pantalla dibujaría dos cajas encima de la misma cosa.

    Se comparan solo detecciones de la MISMA clase: un pallet y el código pegado a él se
    solapan casi por completo y son dos cosas distintas. Y se conserva la de más confianza,
    que es la del trozo donde el objeto se veía mejor centrado.
    """
    fusionadas: list[dict[str, Any]] = []
    for d in sorted(candidatas, key=lambda x: -float(x["confidence"])):
        if any(
            v["class_name"] == d["class_name"] and _iou(v, d) >= umbral_iou for v in fusionadas
        ):
            continue
        fusionadas.append(d)
    return fusionadas


# ═══════════════════════════════════════════════════════════════════════════
# ANALIZAR
# ═══════════════════════════════════════════════════════════════════════════
#: A que escalas se intenta decodificar el codigo. El orden importa poco; que haya VARIAS,
#: mucho.
#:
#: Medido sobre una etiqueta real de 143 px de lado: a tamano nativo NO se lee, y reducida
#: al 80 % si. Suena al reves y tiene explicacion — a resolucion nativa el JPEG deja ruido
#: y bordes duros entre modulos, y reducir promedia ese ruido—. Con una sola escala, la
#: lectura sale o no sale por suerte.
ESCALAS_CODIGO = (1.0, 0.8, 0.6, 1.5, 0.45)


#: Cuantos segmentos tiene una ubicacion COMPLETA: rack, cuerpo, nivel y posicion.
#: `RCL51-C020-N01-2` los tiene; `RCL51-C020` se queda en el cuerpo.
SEGMENTOS_UBICACION = 4

#: Las clases que nombran una ubicacion. Solo estas llevan un codigo de hueco, y por tanto
#: solo estas pueden promoverse a una observacion espacial.
CLASES_DE_UBICACION = frozenset({"qr_ubicacion"})

#: Donde va a parar una etiqueta que se ve pero no sirve para ubicar.
CLASE_ILEGIBLE = "etiqueta_ilegible"


def es_ubicacion_completa(codigo: str | None) -> bool:
    """Si el codigo identifica un HUECO concreto y no algo mas grande.

    ── LA REGLA VIENE DEL WMS, NO DE LA VISION ───────────────────────────────────

    `RCL51-C020` es un cuerpo de estanteria —una «altura», en el lenguaje del almacen— y en
    el WMS el operador elige el nivel a mano. Una lectura asi no dice en que hueco esta el
    pallet: dice en que columna. Tratarla como ubicacion seria inventar una precision que
    la etiqueta no tiene, y el inventario hueco a hueco se llenaria de datos que parecen
    exactos y no lo son.

    Solo cuenta el codigo completo —rack, cuerpo, nivel y posicion, `RCL51-C020-N01-2`—,
    que es el que van a llevar las etiquetas nuevas. Lo demas se trata como etiqueta que se
    ve y no ubica.

    Se cuentan SEGMENTOS y no se valida cada uno con su forma. Es a proposito: el formato
    del rack varia entre almacenes y una expresion regular ajustada a `RCL` rechazaria el
    almacen siguiente. Lo que no varia es que una ubicacion completa baja cuatro niveles.
    """
    if not codigo:
        return False
    partes = [p for p in str(codigo).strip().split("-") if p]
    return len(partes) >= SEGMENTOS_UBICACION


def _leer_codigo(recorte: Any) -> str | None:
    """El contenido de un codigo QR del recorte, o `None`.

    ── ESTO ES LEER, Y EL OCR NO LO ERA ──────────────────────────────────────────

    El `pipeline` traia easyocr, que lee TEXTO impreso. Un QR no es texto: es un patron de
    modulos, y ningun OCR lo descifra. Sobre la etiqueta de un hueco el OCR devolvia
    `RCL51 C020 NO1` —leyendo la linea impresa, con una O donde hay un cero y sin el ultimo
    digito— mientras el QR de al lado contenia `RCL51-C020-N01-2` exacto.

    La diferencia no es de calidad, es de naturaleza: un codigo decodificado esta bien o no
    esta; un texto leido por OCR hay que adivinarlo. Y para casar contra el catalogo de
    ubicaciones eso es todo.

    ── SE DECODIFICA SOBRE EL RECORTE, NO SOBRE EL FOTOGRAMA ─────────────────────

    Medido sobre la misma foto: en la imagen completa el decodificador falla en casi todas
    las escalas —hay estanteria, cajas y agujeros compitiendo—, y sobre el recorte de la
    etiqueta acierta en las cinco que se probaron. Aislar la etiqueta es justo lo que aporta
    el detector, y por eso los dos pasos se necesitan.
    """
    import cv2

    if recorte is None or recorte.size == 0:
        return None

    #: El detector con Aruco (OpenCV 4.7+) es mejor con codigos pequenos o girados, pero no
    #: esta en todas las versiones. Se prueban los dos: cuesta milisegundos.
    detectores = [cv2.QRCodeDetector]
    if hasattr(cv2, "QRCodeDetectorAruco"):
        detectores.append(cv2.QRCodeDetectorAruco)

    def _intentar(imagen: Any) -> str | None:
        if imagen is None or min(imagen.shape[:2]) < 20:
            return None
        for fabrica in detectores:
            try:
                texto, _, _ = fabrica().detectAndDecode(imagen)
            except Exception:  # noqa: S112  fallar aquí es lo normal, ver abajo
                #  No se registra a propósito, y es la única excepción que se calla en este
                #  guion. Aquí fallar es lo NORMAL: se prueban varias escalas por dos
                #  detectores y la mayoría no encuentran nada. Escribir una línea por cada
                #  intento fallido llenaría el log de un análisis con miles de avisos que no
                #  significan nada, y enterraría los que sí. Lo que importa —si al final se
                #  leyó el código o no— queda en la detección.
                continue
            if texto:
                return str(texto).strip()[:200]
        return None

    #  ── Primero lo barato: el recorte tal cual y a varias escalas ──────────────
    for escala in ESCALAS_CODIGO:
        if escala == 1.0:
            imagen = recorte
        else:
            interp = cv2.INTER_AREA if escala < 1 else cv2.INTER_CUBIC
            imagen = cv2.resize(recorte, None, fx=escala, fy=escala, interpolation=interp)
        leido = _intentar(imagen)
        if leido:
            return leido

    """
    ── Y SOLO SI ESO FALLA, LO CARO ──────────────────────────────────────────────

    Ampliar mucho y enfocar desbloquea códigos que las escalas suaves no alcanzan. Medido
    sobre los 64 recortes que fallaban con lo barato: ampliar 2-4x desbloquea 3 y la máscara
    de enfoque los mismos 3 —incluida una ubicación completa, `RCL50-C019-N01-2`—.

    Son 3 de 64, o sea que esto NO es la solución al problema: la mayoría de esos recortes
    miden 105 por 60 píxeles y están borrosos, y ahí el código no existe como información.
    Se hace porque cuesta milisegundos y solo se ejecuta cuando lo barato ya falló; lo que
    de verdad mueve el número es acercar la cámara.
    """
    gris = cv2.cvtColor(recorte, cv2.COLOR_BGR2GRAY)
    borroso = cv2.GaussianBlur(gris, (0, 0), 3)
    nitido = cv2.addWeighted(gris, 1.8, borroso, -0.8, 0)

    for base in (recorte, nitido):
        for factor in (2, 3, 4):
            grande = cv2.resize(base, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
            leido = _intentar(grande)
            if leido:
                return leido
    return None


def _leer_texto(recorte: Any, lector: Any) -> str | None:
    """El texto de un recorte, o `None`.

    Se devuelve tal cual lo lee el OCR, SIN corregirlo. «RCL104» y «RCL1O4» se
    diferencian en un carácter, y adivinar cuál quiso decir convertiría un error de
    lectura en un dato. El puente a observaciones ya devuelve los que no casan como
    `unresolved`, que es la respuesta honesta.
    """
    if lector is None:
        return None
    try:
        leido = lector.readtext(recorte, detail=0)
    except Exception:
        return None
    if not leido:
        return None
    texto = " ".join(str(x) for x in leido).strip().upper()
    return texto[:200] or None


def _analizar(
    fotogramas: list[tuple[int, int, Any]],
    pesos: Path | str,
    umbral: float,
    con_ocr: bool,
    observado_base: datetime,
    clases: dict[int, str],
    al_avanzar: Callable[[int, list[dict[str, Any]]], None] | None = None,
    trozos: int = 0,
) -> list[dict[str, Any]]:
    """Corre el modelo y devuelve las detecciones en el contrato de la API.

    `bbox_format: normalized` porque las coordenadas se guardan relativas al tamaño del
    fotograma: en píxeles, un vídeo reescalado dejaría las cajas de los análisis
    anteriores apuntando a otro sitio.

    Se filtran las que no llegan al umbral ANTES de mandarlas. El backend rechaza el
    lote entero si alguna baja del umbral que el propio trabajo declaró —y hace bien:
    filtrarlas en silencio dejaría al operador con un recuento que no cuadra—.

    ── `al_avanzar` ES LO QUE HACE QUE SE VEA ALGO MIENTRAS TANTO ────────────────

    Se llama tras CADA fotograma con lo que ese fotograma dio. Antes esta función
    devolvía todo junto al terminar, así que la pantalla enseñaba «0 de 58 fotogramas ·
    0 detecciones» durante todo el análisis y luego saltaba al resultado completo. Quien
    miraba no podía distinguir «está trabajando» de «se colgó», que es exactamente la
    duda que había que quitar.

    Quien recibe el aviso decide cada cuánto lo manda: avisar por fotograma es barato,
    mandarlo a la API por fotograma no.
    """
    modelo = _cargar_modelo(pesos, clases)
    lector = None
    if con_ocr:
        import easyocr

        # `gpu=False`: easyocr con GPU compite por la memoria con el detector, y en una
        # tarjeta modesta el análisis muere a mitad. El OCR sobre recortes pequeños es
        # rápido en CPU.
        lector = easyocr.Reader(["es", "en"], gpu=False, verbose=False)

    detecciones: list[dict[str, Any]] = []
    for numero, ms, marco in fotogramas:
        del_fotograma: list[dict[str, Any]] = []
        alto, ancho = marco.shape[:2]

        # RF-DETR quiere RGB; cv2 entrega BGR. Sin la conversión el modelo analiza una
        # imagen con los canales cruzados: no falla, detecta PEOR, y la causa no se ve
        # en ningún sitio.
        import cv2

        rgb = cv2.cvtColor(marco, cv2.COLOR_BGR2RGB)

        # ── Las regiones a analizar ─────────────────────────────────────────
        #
        # Siempre el fotograma COMPLETO, y además los trozos si se pidieron.
        #
        # El completo no se puede quitar: un pallet que ocupa media imagen no cabe entero
        # en ningún trozo, y analizar solo por trozos cambiaría un problema —los objetos
        # pequeños— por el simétrico. Cada región lleva su origen para devolver las cajas
        # a coordenadas del fotograma.
        regiones: list[tuple[int, int, Any]] = [(0, 0, rgb)]
        if trozos and trozos > 0:
            for x0, y0, x1r, y1r in _rejilla(ancho, alto, trozos, SOLAPE_TROZOS):
                regiones.append((x0, y0, rgb[y0:y1r, x0:x1r]))

        for ox, oy, region in regiones:
            resultado = modelo.predict(region, threshold=umbral)

            # `Detections` de supervision: arrays paralelos, no una lista de objetos.
            for i in range(len(resultado.xyxy)):
                conf = (
                    float(resultado.confidence[i]) if resultado.confidence is not None else 1.0
                )
                if conf < umbral:
                    continue
                #  Las coordenadas vienen en píxeles DE LA REGIÓN. Se les suma el origen
                #  del trozo y se dividen por el tamaño del FOTOGRAMA, no de la región:
                #  dividir por la región dejaría cada caja normalizada contra un lienzo
                #  distinto, y todas caerían en el sitio equivocado menos las del completo.
                rx1, ry1, rx2, ry2 = (float(v) for v in resultado.xyxy[i])
                x1, y1, x2, y2 = rx1 + ox, ry1 + oy, rx2 + ox, ry2 + oy
                idx = int(resultado.class_id[i]) if resultado.class_id is not None else 0
                # El nombre sale del `class_map` del propio trabajo. Sin él, un índice
                # crudo —«3»— no le dice nada a nadie en la pantalla de revisión.
                clase = clases.get(idx, f"clase_{idx}")

                texto = None
                if con_ocr:
                    # El recorte se acota al marco: una caja que sobresale un píxel daría
                    # un recorte vacío y el OCR devolvería nada sin decir por qué.
                    #
                    # Y se ENSANCHA un poco: el modelo aprende a ajustar la caja al código,
                    # y un QR pegado al borde del recorte pierde el margen blanco que el
                    # decodificador necesita para encontrar sus esquinas. Un 12 % basta.
                    margen = int(0.12 * max(x2 - x1, y2 - y1))
                    cx1, cy1 = max(0, int(x1) - margen), max(0, int(y1) - margen)
                    cx2, cy2 = min(ancho, int(x2) + margen), min(alto, int(y2) + margen)
                    if cx2 > cx1 and cy2 > cy1:
                        recorte = marco[cy1:cy2, cx1:cx2]
                        #  Primero DECODIFICAR y solo si no hay código, leer con OCR. Un
                        #  código decodificado es exacto; un texto de OCR hay que
                        #  adivinarlo. Anteponer el OCR habría dejado `RCL51 C020 NO1`
                        #  —con una O por un cero— donde el QR dice `RCL51-C020-N01-2`.
                        codigo = _leer_codigo(recorte)
                        texto = codigo or _leer_texto(recorte, lector)

                        #  Un código de ubicación INCOMPLETO no es una ubicación. Se guarda
                        #  el texto —quien revise tiene derecho a ver qué se leyó— pero la
                        #  clase pasa a `etiqueta_ilegible`, que es exactamente lo que es:
                        #  una etiqueta que se ve y no sirve para ubicar. Sin esto, un
                        #  `RCL51-C020` viajaría como ubicación y el puente al WMS
                        #  promovería una precisión que la etiqueta no tiene.
                        if (
                            clase in CLASES_DE_UBICACION
                            and codigo
                            and not es_ubicacion_completa(codigo)
                        ):
                            clase = CLASE_ILEGIBLE

                del_fotograma.append(
                    {
                        # La hora de CAPTURA, no la de llegada: es la clave de partición
                        # de 0069, y con la hora de llegada las 8.000 detecciones de un
                        # vuelo caerían en la misma partición.
                        "observed_at": observado_base.timestamp() + ms / 1000,
                        "frame_number": numero,
                        "frame_ms": ms,
                        "class_name": clase,
                        "confidence": round(conf, 4),
                        "bbox_x": round(x1 / ancho, 6),
                        "bbox_y": round(y1 / alto, 6),
                        "bbox_width": round((x2 - x1) / ancho, 6),
                        "bbox_height": round((y2 - y1) / alto, 6),
                        "bbox_format": "normalized",
                        "text_value": texto,
                        "is_manual": False,
                    }
                )

        #  Con trozos solapados, un objeto en la junta lo ven dos regiones. Sin fusionar,
        #  el recuento diría el doble y la pantalla dibujaría dos cajas sobre la misma cosa.
        if len(regiones) > 1:
            del_fotograma = _fusionar(del_fotograma)

        detecciones.extend(del_fotograma)
        if al_avanzar is not None:
            #  Un fotograma analizado es un fotograma del que ya se puede informar. Si
            #  avisar falla, el análisis NO se para: contar el progreso es para que se vea
            #  algo, y perder el resultado entero por no poder contarlo sería absurdo.
            try:
                al_avanzar(1, del_fotograma)
            except Exception as exc:
                print(f"  aviso: no se pudo informar del progreso ({exc})", flush=True)
    return detecciones


def _cargar_modelo(pesos: Path | str, clases: dict[int, str]) -> Any:
    """El modelo RF-DETR, desde un punto de control entrenado o preentrenado.

    ── POR QUÉ RF-DETR Y NO YOLO ───────────────────────────────────────────

    Decisión del proyecto, no preferencia técnica: la migración 0061 desactivó las 11
    arquitecturas de Ultralytics porque YOLO11 y YOLOv8 son **AGPL-3.0**, y su §13
    obliga a entregar el código fuente completo a cualquier usuario que interactúe con
    el software por red. OLO_IA es SaaS multi-tenant: cada tenant es un usuario remoto,
    así que la obligación alcanzaría al producto entero. Ultralytics sostiene además
    que la licencia alcanza a los PESOS entrenados con su código.

    RF-DETR es Apache 2.0 y acepta `bbox` —que es lo que hay anotado— y vídeo.

    Si el punto de control no existe, se cae al preentrenado del tamaño nano. Se AVISA:
    lo que salga no es del modelo entrenado y las detecciones se guardan con el
    `model_label` del trabajo.
    """
    from rfdetr import RFDETRNano, from_checkpoint

    ruta = Path(pesos) if not isinstance(pesos, str) or pesos != "__preentrenado__" else None
    if ruta is not None and ruta.exists():
        # `trust_checkpoint` no se pasa: el punto de control viene del propio Storage
        # del proyecto, pero cargarlo es un `torch.load` y confiar por omisión en un
        # fichero descargado es exactamente lo que la bandera existe para evitar.
        return from_checkpoint(str(ruta))

    print(
        "  AVISO: sin punto de control entrenado. Se usa RF-DETR Nano preentrenado\n"
        "         (COCO), y lo que salga NO es del modelo del proyecto."
    )
    # `num_classes` NO se fuerza al vocabulario del proyecto: el preentrenado trae las
    # 80 de COCO y cambiar el número reinicializaría la cabeza, dejando un modelo que
    # no detecta nada. Los nombres se traducen después con `clases`, y los índices que
    # no estén en el mapa salen como `clase_N`, que es visiblemente raro y por tanto
    # revisable.
    return RFDETRNano()


# ═══════════════════════════════════════════════════════════════════════════
# DIRECTOS
#
# La diferencia con un archivo no es de dónde se leen los fotogramas: es que NO SE
# ACABAN. Eso cambia tres cosas, y las tres importan.
#
#   1. No se puede decodificar todo y analizar después. Un vuelo de media hora en
#      memoria son gigabytes, y el resultado llegaría media hora tarde. Se analiza
#      fotograma a fotograma y se manda en lotes.
#
#   2. Hay que TIRAR fotogramas. Si el modelo tarda 300 ms y la cámara entrega 25 fps,
#      encolarlos todos hace que la latencia crezca sin techo: al minuto se estarían
#      analizando imágenes de hace un minuto. Se lee el más reciente y se descarta el
#      resto — es lo contrario de lo que se hace con un archivo, donde no se pierde uno.
#
#   3. El corte lo decide una persona, no el final del archivo. El bucle para con
#      Ctrl-C o cuando el trabajo deja de estar `running`, y en los dos casos cierra el
#      trabajo diciendo cuántos fotogramas vio.
# ═══════════════════════════════════════════════════════════════════════════
def _abrir_stream(url: str) -> Any:
    """Abre la URL con cv2 y comprueba que de verdad entrega fotogramas.

    `isOpened()` no basta: con RTMP devuelve `True` en cuanto la conexión se establece,
    antes de recibir el primer fotograma, así que un stream que conecta y no emite pasaría
    por bueno. Se lee uno de prueba.
    """
    import cv2

    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap.release()
        msg = (
            f"no se pudo abrir el directo {url}. Comprueba que el servidor de medios "
            "este emitiendo: OLO_IA no acepta la emision, la LEE de donde la sirvan."
        )
        raise RuntimeError(msg)

    # Un buffer pequeño para que `read()` devuelva lo ÚLTIMO y no lo más antiguo. No
    # todos los backends lo respetan —de ahí el descarte explícito del bucle— pero
    # cuando lo hace ahorra el trabajo.
    #
    # `suppress` y no un `except: pass`: es una optimización, así que si el backend no
    # admite la propiedad da igual. Lo que NO puede es tirar el directo por eso.
    with contextlib.suppress(Exception):
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    ok, primero = cap.read()
    if not ok or primero is None:
        cap.release()
        msg = f"el directo {url} conecta pero no entrega fotogramas"
        raise RuntimeError(msg)
    return cap


def _procesar_directo(
    api: Api,
    job: dict[str, Any],
    latido: Latido,
    *,
    local: Path | None,
    clases_manual: list[str] | None,
    max_segundos: int | None,
) -> int:
    """Analiza un directo hasta que alguien lo pare.

    Manda un lote por cada `LOTE_S` segundos de analisis: ni por fotograma —seria una
    peticion cada 500 ms— ni al final —un directo no tiene final, y las detecciones no
    aparecerian nunca en la pantalla—.
    """
    import cv2

    job_id = job["id"]
    url = job.get("media_stream_url") or job.get("media_filename")
    umbral = float(job["confidence_threshold"])
    fps = float(job.get("frame_sampling_rate") or 2.0)
    con_ocr = job["pipeline"] in ("ocr", "detection-ocr")

    print(f"\n→ DIRECTO {job_id}")
    print(f"  nombre    : {job['name']}")
    print(f"  origen    : {url}")
    print(f"  muestreo  : {fps} fps · umbral {umbral}")
    print("  para con Ctrl-C\n")

    latido.en_trabajo(job_id)
    api.post(f"/v1/perception/jobs/{job_id}/status", {"to_status": "running"})

    cap = None
    modelo = None
    lector = None
    enviadas = 0
    vistos = 0
    arranque = time.monotonic()
    try:
        cap = _abrir_stream(str(url))
        clases = _mapa_de_clases(job, clases_manual)
        modelo = _cargar_modelo(local or "__preentrenado__", clases)
        if con_ocr:
            import easyocr

            lector = easyocr.Reader(["es", "en"], gpu=False, verbose=False)

        pendientes: list[dict[str, Any]] = []
        ultimo_envio = time.monotonic()
        siguiente = 0.0

        while True:
            ok, marco = cap.read()
            if not ok or marco is None:
                # El emisor cortó. No es un fallo del worker: es el final de la emisión.
                print("  el emisor dejo de enviar")
                break
            vistos += 1

            ahora = time.monotonic() - arranque
            if ahora < siguiente:
                # TIRAR el fotograma, y aquí está la decisión del punto 2 de arriba.
                continue
            siguiente = ahora + 1.0 / fps

            alto, ancho = marco.shape[:2]
            resultado = modelo.predict(
                cv2.cvtColor(marco, cv2.COLOR_BGR2RGB), threshold=umbral
            )
            capturado = datetime.now(UTC)
            for i in range(len(resultado.xyxy)):
                conf = (
                    float(resultado.confidence[i])
                    if resultado.confidence is not None
                    else 1.0
                )
                if conf < umbral:
                    continue
                x1, y1, x2, y2 = (float(v) for v in resultado.xyxy[i])
                idx = int(resultado.class_id[i]) if resultado.class_id is not None else 0

                texto = None
                if con_ocr:
                    rx1, ry1 = max(0, int(x1)), max(0, int(y1))
                    rx2, ry2 = min(ancho, int(x2)), min(alto, int(y2))
                    if rx2 > rx1 and ry2 > ry1:
                        texto = _leer_texto(marco[ry1:ry2, rx1:rx2], lector)

                pendientes.append(
                    {
                        "observed_at": capturado.isoformat(),
                        "frame_number": vistos,
                        "frame_ms": int(ahora * 1000),
                        "class_name": clases.get(idx, f"clase_{idx}"),
                        "confidence": round(conf, 4),
                        "bbox_x": round(x1 / ancho, 6),
                        "bbox_y": round(y1 / alto, 6),
                        "bbox_width": round((x2 - x1) / ancho, 6),
                        "bbox_height": round((y2 - y1) / alto, 6),
                        "bbox_format": "normalized",
                        "text_value": texto,
                        "is_manual": False,
                    }
                )

            if time.monotonic() - ultimo_envio >= LOTE_S:
                # `replace: False` y `mark_completed: False`: en un directo cada lote
                # AÑADE. Con `replace` el segundo lote borraría el primero.
                if pendientes:
                    api.post(
                        f"/v1/perception/jobs/{job_id}/detections",
                        {
                            "detections": pendientes[:5000],
                            "replace": False,
                            "mark_completed": False,
                        },
                    )
                    enviadas += len(pendientes[:5000])
                api.post(
                    f"/v1/perception/jobs/{job_id}/live-progress",
                    {"frames": vistos},
                )
                print(
                    f"  {int(time.monotonic() - arranque):4} s · {vistos} fotogramas "
                    f"· {enviadas} detecciones",
                    flush=True,
                )
                pendientes = []
                vistos = 0
                ultimo_envio = time.monotonic()

            if max_segundos is not None and time.monotonic() - arranque >= max_segundos:
                print(f"  alcanzado el limite de {max_segundos} s")
                break

        # Lo que quede sin mandar, y el cierre.
        if pendientes:
            api.post(
                f"/v1/perception/jobs/{job_id}/detections",
                {"detections": pendientes[:5000], "replace": False, "mark_completed": False},
            )
            enviadas += len(pendientes[:5000])
        if vistos:
            api.post(
                f"/v1/perception/jobs/{job_id}/live-progress",
                {"frames": vistos},
            )

        api.post(
            f"/v1/perception/jobs/{job_id}/detections",
            {"detections": [], "replace": False, "mark_completed": True},
        )
        print(f"\n  CERRADO · {enviadas} detecciones en {time.monotonic() - arranque:.0f} s")
        return 0

    except KeyboardInterrupt:
        # Parar a mano NO es un fallo: es como se termina un directo. Se cierra como
        # completado con lo que se llevaba analizado.
        print("\n  interrumpido: cerrando el directo")
        try:
            if pendientes:
                api.post(
                    f"/v1/perception/jobs/{job_id}/detections",
                    {"detections": pendientes[:5000], "replace": False, "mark_completed": False},
                )
            api.post(
                f"/v1/perception/jobs/{job_id}/detections",
                {"detections": [], "replace": False, "mark_completed": True},
            )
            print(f"  CERRADO · {enviadas} detecciones")
        except Exception as exc:
            print(f"  y no se pudo cerrar: {exc}")
        return 130

    except Exception as exc:
        motivo = f"{type(exc).__name__}: {exc}"[:2000]
        print(f"\n  FALLO: {motivo}")
        try:
            api.post(
                f"/v1/perception/jobs/{job_id}/status",
                {"to_status": "failed", "reason": motivo},
            )
        except Exception as cierre:
            print(f"  Y NO SE PUDO CERRAR: {cierre}")
        return 1

    finally:
        latido.en_trabajo(None)
        if cap is not None:
            cap.release()


# ═══════════════════════════════════════════════════════════════════════════
# UN TRABAJO
# ═══════════════════════════════════════════════════════════════════════════
def _procesar(
    api: Api,
    job: dict[str, Any],
    latido: Latido,
    *,
    seco: bool,
    local: Path | None = None,
    clases_manual: list[str] | None = None,
    max_segundos: int | None = None,
    trozos: int = 0,
) -> int:
    # Un directo se analiza de otra forma: los fotogramas no se acaban. Ver el
    # bloque DIRECTOS de arriba.
    if job.get("media_kind") == "stream":
        return _procesar_directo(
            api,
            job,
            latido,
            local=local,
            clases_manual=clases_manual,
            max_segundos=max_segundos,
        )

    job_id = job["id"]
    pipeline = job["pipeline"]
    umbral = float(job["confidence_threshold"])
    es_video = job["media_kind"] == "video"

    print(f"\n→ trabajo {job_id}")
    print(f"  nombre    : {job['name']}")
    print(f"  pipeline  : {pipeline}")
    print(f"  medio     : {job['media_filename']} ({job['media_kind']})")
    print(f"  modelo    : {job.get('model_label') or '(ninguno)'}")
    print(f"  umbral    : {umbral}")

    # `local is None` en la condición: con `--pesos` SÍ hay modelo que correr, aunque el
    # trabajo no apunte a ninguna versión publicada. Es justo el caso de la máquina que
    # acaba de entrenar y del checkpoint que no cabe en Storage.
    if not seco and local is None and job.get("model_version_id") is None:
        # No se falla el trabajo: se deja encolado. Que no haya modelo publicado es un
        # estado del sistema, no un defecto de este trabajo, y cerrarlo como fallido
        # obligaría a recrearlo cuando lo haya.
        print(
            "\n  este trabajo no tiene modelo asignado y no hay nada que correr.\n"
            "  entrena y publica una version primero:  python tools/entrenar.py\n"
            "  o pasa un checkpoint local:             --pesos <ruta.pth>\n"
            "  el trabajo se queda ENCOLADO."
        )
        return 3

    if local is not None and job.get("model_version_id") is None:
        # Se DICE, y fuerte: las detecciones van a quedar con `model_label` vacío, así
        # que dentro de un mes nadie sabrá con qué se produjeron si no está en las notas.
        print(
            "\n  AVISO: el trabajo no apunta a ninguna version publicada y se analiza\n"
            "         con un checkpoint local. Las detecciones NO quedaran atribuidas\n"
            "         a ninguna version del registro."
        )

    latido.en_trabajo(job_id)
    api.post(f"/v1/perception/jobs/{job_id}/status", {"to_status": "running"})
    arranque = time.monotonic()

    trabajo_dir = Path(tempfile.mkdtemp(prefix="olo-inferencia-"))
    try:
        # ── El medio ────────────────────────────────────────────────────────
        firma = api.get(f"/v1/perception/jobs/{job_id}/media-url")
        destino = trabajo_dir / job["media_filename"]
        print("  descargando el medio…", flush=True)
        Api.descargar(firma["url"], destino)
        print(f"  {destino.stat().st_size / 1024 / 1024:.1f} MB")

        # ── Los fotogramas ──────────────────────────────────────────────────
        marcos, total_real = _fotogramas(destino, es_video, job.get("frame_sampling_rate"))
        print(f"  {len(marcos)} fotogramas a analizar de {total_real or 1} que tiene")

        # ── Se devuelve el recuento a quien no puede saberlo ────────────────
        #
        # El navegador no puede contar los fotogramas al subir, así que el medio llega con
        # `total_frames` nulo. Aquí ya están contados, y con la duración sale la cadencia
        # real: lo que hace falta para que un fotograma mandado a anotar diga su número de
        # verdad y no uno derivado a 25 fps por convención.
        #
        # No corta el análisis si falla: el recuento es un dato útil, no un requisito. Que
        # el trabajo entero se caiga porque no se pudo anotar un metadato sería confundir
        # lo accesorio con lo esencial.
        if total_real > 0:
            try:
                r = api.post(
                    f"/v1/perception/jobs/{job_id}/frame-count",
                    {"total_frames": total_real},
                )
                if r.get("cambio"):
                    print(f"  recuento  : anotados {total_real} fotogramas en el medio")
            except Exception as exc:
                print(f"  aviso: no se pudo anotar el recuento ({exc})", flush=True)

        if seco:
            api.post(
                f"/v1/perception/jobs/{job_id}/status",
                {
                    "to_status": "failed",
                    "reason": (
                        f"prueba en seco: se descargo el medio y se decodificaron "
                        f"{len(marcos)} fotogramas, pero no se corrio ningun modelo"
                    ),
                },
            )
            print("\n  SECO: la fontaneria funciona. El trabajo queda `failed` con el motivo.")
            return 0

        # ── El modelo ───────────────────────────────────────────────────────
        pesos = _descargar_pesos(api, job, trabajo_dir, local)
        print(f"  pesos     : {pesos}")

        """
        ── SE INFORMA MIENTRAS SE ANALIZA, NO AL FINAL ─────────────────────────

        Antes esto corría entero y luego mandaba el resultado de golpe. Desde fuera, un
        análisis de un minuto se veía así: «0 de 58 fotogramas · 0 detecciones» durante
        todo el rato, y de pronto todo hecho. No había forma de distinguir un worker
        trabajando de uno colgado, y la pregunta era siempre la misma: ¿está procesando,
        o falló?

        Ahora cada fotograma analizado suma en el trabajo y sus detecciones se depositan
        según aparecen, así que la pantalla —que ya se refresca sola cada dos segundos—
        enseña la barra avanzando y las cajas saliendo una a una.

        El envío se agrupa por TIEMPO, no por fotogramas: con un vídeo rápido, mandar uno
        por fotograma serían decenas de peticiones por segundo; con uno lento, agrupar de
        diez en diez dejaría la pantalla parada medio minuto. Metro y medio de segundo es
        más frecuente que el refresco de la pantalla, así que nunca es el cuello.
        """

        # El primer envío, VACÍO y con `replace`, limpia lo que dejara un intento
        # anterior. Tiene que ir antes de la primera detección: hacerlo después borraría
        # justo lo que se acaba de mandar.
        api.post(
            f"/v1/perception/jobs/{job_id}/detections",
            {"detections": [], "replace": True, "mark_completed": False},
        )

        pendientes: list[dict[str, Any]] = []
        sin_contar = 0
        ultimo_aviso = time.monotonic()
        vistos = 0

        def _volcar() -> None:
            nonlocal sin_contar, ultimo_aviso
            if pendientes:
                for d in pendientes:
                    d["observed_at"] = datetime.fromtimestamp(d["observed_at"], UTC).isoformat()
                api.post(
                    f"/v1/perception/jobs/{job_id}/detections",
                    {"detections": pendientes, "replace": False, "mark_completed": False},
                )
                pendientes.clear()
            if sin_contar:
                api.post(f"/v1/perception/jobs/{job_id}/live-progress", {"frames": sin_contar})
                sin_contar = 0
            ultimo_aviso = time.monotonic()

        def _avanzar(fotogramas: int, nuevas: list[dict[str, Any]]) -> None:
            nonlocal sin_contar, vistos
            sin_contar += fotogramas
            vistos += fotogramas
            pendientes.extend(nuevas)
            if time.monotonic() - ultimo_aviso >= INTERVALO_AVISO_S:
                _volcar()
                print(f"  {vistos}/{len(marcos)} fotogramas", flush=True)

        detecciones = _analizar(
            marcos,
            pesos,
            umbral,
            con_ocr=pipeline in ("ocr", "detection-ocr"),
            observado_base=datetime.now(UTC),
            clases=_mapa_de_clases(job, clases_manual),
            al_avanzar=_avanzar,
            trozos=trozos,
        )
        _volcar()
        print(f"  {len(detecciones)} detecciones sobre el umbral")

        # ── Cerrar ──────────────────────────────────────────────────────────
        #
        # Las detecciones ya están depositadas: fueron saliendo durante el análisis. Aquí
        # solo queda marcar el final, con un envío vacío.
        #
        # `mark_completed` fija además `frames_processed` al total del trabajo, así que
        # corrige de paso cualquier desajuste que hubieran dejado los avisos parciales —un
        # aviso perdido por un corte de red dejaría la cuenta corta, y terminar diciendo
        # «56 de 58» sería mentir sobre un trabajo que sí acabó—.
        api.post(
            f"/v1/perception/jobs/{job_id}/detections",
            {"detections": [], "replace": False, "mark_completed": True},
        )

        print(f"\n  LISTO en {time.monotonic() - arranque:.1f} s")
        return 0

    except Exception as exc:
        motivo = f"{type(exc).__name__}: {exc}"[:2000]
        print(f"\n  FALLO: {motivo}")
        try:
            api.post(
                f"/v1/perception/jobs/{job_id}/status",
                {"to_status": "failed", "reason": motivo},
            )
            print("  el trabajo queda `failed` con el motivo escrito")
        except Exception as cierre:
            # Aquí sí importa avisar fuerte: el trabajo se queda en `running` para
            # siempre y alguien va a creer que sigue trabajando.
            print(f"  Y NO SE PUDO CERRAR: {cierre}")
            print(f"  el trabajo {job_id} se queda en `running` — ciérralo a mano")
        return 1
    finally:
        latido.en_trabajo(None)
        shutil.rmtree(trabajo_dir, ignore_errors=True)


def _mapa_de_clases(
    job: dict[str, Any], manual: list[str] | None = None
) -> dict[int, str]:
    """Índice de clase → nombre, tal como lo declaró el modelo.

    Sale del catálogo publicado, que trae `classes` con su `index` de entrenamiento.
    Sin esto, la pantalla de revisión enseñaría «3» donde debería decir «pallet», y una
    detección que no se puede nombrar no se puede revisar. Peor: el puente al WMS la
    rechaza, porque no puede saber si es un hueco vacío o un pallet.

    `manual` es la lista pasada con `--clases`, EN EL ORDEN DE ENTRENAMIENTO. Hace falta
    cuando se analiza con un checkpoint que no está en el registro: entonces no hay
    versión publicada de la que sacar el vocabulario.
    """
    if manual:
        return dict(enumerate(manual))

    mapa: dict[int, str] = {}
    for c in job.get("model_classes") or []:
        idx = c.get("index")
        if idx is not None:
            mapa[int(idx)] = str(c.get("name") or f"clase_{idx}")
    return mapa


def _descargar_pesos(
    api: Api, job: dict[str, Any], destino_dir: Path, local: Path | None = None
) -> Path | str:
    """Los pesos del modelo del trabajo.

    Se resuelven por el catálogo publicado, que es lo único que un tenant ve de `ai`.
    Si la versión no trae asset de pesos, se cae al RF-DETR preentrenado: es mejor
    analizar con un detector genérico —y que se vea qué detecta— que no analizar. Queda
    dicho en la salida para que nadie confunda un resultado genérico con el del modelo
    entrenado.
    """
    # ── Un checkpoint LOCAL, si se indicó ──────────────────────────────────
    #
    # Para la máquina que acaba de entrenar: tiene los pesos en disco y darles la vuelta
    # por Storage para volver a bajarlos son 240 MB de ida y vuelta para nada.
    #
    # Y es la única vía cuando el checkpoint no cabe en Storage. RF-DETR Nano son ~30 M
    # parámetros = 120 MB en fp32, y el plan gratuito de Supabase corta la subida en
    # 50 MB —medido: 40 MB pasa, 60 MB no—, un tope de PLAN que no se sube con un ajuste.
    #
    # El `model_label` del trabajo sigue siendo el del modelo que declaró, así que la
    # procedencia no se pierde: lo que se salta es el transporte, no el registro.
    if local is not None:
        if not local.exists():
            msg = f"no existe el checkpoint local {local}"
            raise RuntimeError(msg)
        print(f"  pesos LOCALES: {local.name} ({local.stat().st_size / 1e6:.1f} MB)")
        # Las clases se piden igual: sin ellas las detecciones saldrían como `clase_3`.
        version_id_local = job.get("model_version_id")
        if version_id_local:
            catalogo = api.get("/v1/perception/models")
            v = next(
                (
                    m
                    for m in catalogo["models"]
                    if str(m.get("model_version_id")) == str(version_id_local)
                ),
                None,
            )
            if v and v.get("classes"):
                job["model_classes"] = v["classes"]
        return local

    version_id = job.get("model_version_id")
    modelos = api.get("/v1/perception/models")
    version = next(
        (m for m in modelos["models"] if str(m.get("model_version_id")) == str(version_id)),
        None,
    )
    # Las clases viajan con el modelo en el catálogo; se guardan en el trabajo para que
    # `_mapa_de_clases` las tenga sin repetir la consulta.
    if version and version.get("classes"):
        job["model_classes"] = version["classes"]

    asset_id = (version or {}).get("weights_asset_id")
    if not asset_id or not (version or {}).get("weights_object_path"):
        # Se AVISA fuerte y no se falla: analizar con un detector generico y decirlo
        # es mas util que no analizar. Lo que no se puede es callarlo, porque las
        # detecciones se guardan con el `model_label` del modelo del trabajo y nadie
        # sabria despues que las produjo otro.
        print(
            "  AVISO: la version publicada no trae pesos descargables. Se usa el"
            " RF-DETR preentrenado, y lo que salga NO es del modelo entrenado."
        )
        return "__preentrenado__"

    destino = destino_dir / "pesos.pt"
    # `/url` y no `/download`: es el nombre real del endpoint. Y exige PLATFORM
    # OWNER —el bucket `ai-assets` lo pide en sus cuatro politicas (0045)—, asi que
    # este worker necesita una cuenta que lo sea. El medio del trabajo, en cambio,
    # es del tenant y le basta `perception:ingest`. Ver la cabecera de 0077.
    firma = api.get(f"/v1/ai/assets/{asset_id}/url")
    Api.descargar(firma["url"], destino)
    return destino


def _abrir_log(ruta: Path) -> None:
    """Manda `print` a un archivo ademas de a la consola, y con marca de tiempo.

    Un worker que lleva dias corriendo produce un registro donde «cogi el trabajo X»
    sin hora no sirve para nada: lo que se pregunta siempre es CUANDO dejo de
    funcionar.

    Se rota por tamaño —2 MB— porque esto corre indefinidamente y un log que crece sin
    limite acaba llenando el disco meses despues, cuando ya nadie recuerda que existe.
    """
    ruta.parent.mkdir(parents=True, exist_ok=True)
    if ruta.exists() and ruta.stat().st_size > 2 * 1024 * 1024:
        ruta.replace(ruta.with_suffix(ruta.suffix + ".1"))

    archivo = ruta.open("a", encoding="utf-8", buffering=1)
    original = sys.stdout

    class _Doble:
        """Escribe en los dos. `pythonw.exe` deja `sys.stdout` en None, y ahi el
        archivo es el unico destino — de ahi la comprobacion."""

        def write(self, texto: str) -> int:
            marcado = texto
            if texto.strip():
                marca = time.strftime("%Y-%m-%d %H:%M:%S")
                marcado = f"[{marca}] {texto}"
            archivo.write(marcado)
            if original is not None:
                # Se traga el fallo de la consola, NO el del archivo: si la consola
                # desaparece —pythonw, o una terminal cerrada— el registro debe seguir.
                # Al reves seria perder el log por un detalle cosmetico.
                with contextlib.suppress(ValueError, OSError):
                    original.write(texto)
            return len(texto)

        def flush(self) -> None:
            archivo.flush()
            if original is not None:
                with contextlib.suppress(ValueError, OSError):
                    original.flush()

    sys.stdout = _Doble()  # type: ignore[assignment]
    sys.stderr = sys.stdout


# ═══════════════════════════════════════════════════════════════════════════
def main() -> int:
    ap = argparse.ArgumentParser(description="Worker de inferencia de OLO_IA")
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="arojas@ologistics.com")
    ap.add_argument("--job", help="uuid del trabajo; sin esto coge el siguiente encolado")
    ap.add_argument("--listar", action="store_true", help="lista la cola y los workers")
    ap.add_argument(
        "--bucle",
        action="store_true",
        help="se queda esperando trabajo en vez de salir tras uno",
    )
    ap.add_argument("--espera", type=int, default=15, help="segundos entre sondeos en --bucle")
    ap.add_argument(
        "--seco",
        action="store_true",
        help="descarga y decodifica SIN correr modelo, y cierra el trabajo como fallido "
        "con el motivo. Para probar la fontaneria en una maquina sin GPU",
    )
    ap.add_argument(
        "--pesos",
        help="ruta a un checkpoint LOCAL, en vez de bajarlo del catalogo. Para la "
        "maquina que acaba de entrenar, o cuando el checkpoint no cabe en Storage",
    )
    ap.add_argument(
        "--clases",
        help="nombres de las clases separados por coma, EN EL ORDEN DE "
        "ENTRENAMIENTO. Solo hace falta con --pesos sobre un checkpoint que no "
        "esta en el registro: sin vocabulario, las detecciones salen como "
        "`clase_3` y el puente al WMS las rechaza",
    )
    ap.add_argument(
        "--segundos",
        type=int,
        help="corta un directo tras N segundos. Sin esto corre hasta Ctrl-C o hasta "
        "que el emisor pare",
    )
    ap.add_argument(
        "--trozos",
        type=int,
        default=0,
        metavar="LADO",
        help="analiza tambien por TROZOS de LADO pixeles, a resolucion nativa. Para "
        "objetos pequenos en material grande: el modelo redimensiona lo que le entra a "
        "736 px, asi que un fotograma 4K se reduce seis veces y un codigo QR de 100 px "
        "acaba en 18 — a ese tamano no hay nada que detectar. Pon el mismo valor con el "
        "que se entreno el modelo (736). CUESTA: un fotograma en 15 trozos son 15 pasadas "
        "del modelo, asi que el analisis tarda ese factor mas",
    )
    ap.add_argument("--nombre", default=platform.node() or "worker")
    ap.add_argument(
        "--log",
        help="escribe la salida a este archivo ademas de a la consola. Hace falta para "
        "correr como servicio de Windows: la tarea programada usa `pythonw.exe`, que no "
        "abre consola —si abriera una, alguien la cerraria y mataria el worker— y "
        "entonces no hay nada que redirigir desde fuera.",
    )
    args = ap.parse_args()

    if args.log:
        _abrir_log(Path(args.log))

    pesos_local = Path(args.pesos) if args.pesos else None
    clases_manual = (
        [c.strip() for c in args.clases.split(",") if c.strip()] if args.clases else None
    )

    pw = SECRETS / "adminpw.txt"
    if not pw.exists():
        print(f"FALTA la contraseña en {pw}")
        return 2
    #  La sesion se renueva sola. La contraseña se queda aqui dentro y sirve de respaldo
    #  si el token de refresco deja de valer: un worker en `--bucle` tiene que sobrevivir a
    #  la caducidad de su propia sesion, que es de una hora.
    sesion = Sesion(args.api, args.email, pw.read_text(encoding="utf-8").strip())
    api = Api(args.api, sesion)

    if args.listar:
        cola = api.get("/v1/perception/jobs?limit=50")
        print(f"worker disponible segun la API: {cola['worker_available']}")
        registrados = api.get("/v1/perception/workers?kind=inference")
        print(f"workers registrados: {len(registrados['workers'])} · vivos: {registrados['alive']}")
        for w in registrados["workers"]:
            estado = "VIVO" if w["alive"] else f"muerto (hace {w['seconds_since']} s)"
            print(f"  {w['name']:20} {estado:24} {w['device'] or '-'}")
        print("\ntrabajos:")
        for j in cola["jobs"]:
            print(
                f"  {j['status']:10} {j['id']} · {j['name'][:30]:30} "
                f"· {j['media_kind']:5} · {j['detection_count']} detecciones"
            )
        if not cola["jobs"]:
            print("  (ninguno todavia)")
        return 0

    # ── Dependencias ───────────────────────────────────────────────────────
    if not _hay("cv2"):
        print(
            "\nFALTA `opencv-python`: sin el no se puede decodificar un video ni leer\n"
            "una imagen. NO se manda nada y los trabajos se quedan ENCOLADOS.\n"
            "  pip install opencv-python"
        )
        return 3
    if not args.seco and not _hay("rfdetr"):
        print(
            "\nFALTA `rfdetr`, asi que NO se analiza y el trabajo se queda ENCOLADO\n"
            "para una maquina que si pueda.\n"
            "  pip install rfdetr      (arrastra torch, ~2,5 GB)\n"
            "\nNo se mandan detecciones inventadas: «todavia no hay con que analizar» y\n"
            "«se analizo y esto se vio» no son lo mismo, y de la segunda alguien mueve\n"
            "mercancia.\n"
            "\nRF-DETR y no YOLO por licencia: ver la nota de `_cargar_modelo`."
        )
        return 3

    device = _dispositivo()
    latido = Latido(
        api,
        args.nombre,
        ["object-detection", "ocr", "detection-ocr"] if _hay("easyocr") else ["object-detection"],
        device,
    )
    fila = latido.latir_ahora()
    print(f"worker «{fila['name']}» registrado · {device} · v{VERSION}")
    latido.arrancar()

    try:
        if args.job:
            trabajo = api.get(f"/v1/perception/jobs/{args.job}")
            return _procesar(
                api,
                trabajo,
                latido,
                seco=args.seco,
                local=pesos_local,
                clases_manual=clases_manual,
                max_segundos=args.segundos,
                trozos=args.trozos,
            )

        while True:
            """
            ── UN CORTE DE RED NO ES EL FIN DEL WORKER ───────────────────────────

            Sondear la cola falla si la API no está: se reinicia para desplegar, se corta
            el wifi del almacén, se cae un segundo. Medido hoy: al reiniciar la API, el
            worker respondió `URLError: WinError 10061 — el equipo de destino denegó la
            conexión` y se murió. Quedó igual que cuando le caducaba el token: un worker
            que no está, una cola que no avanza y nadie enterado.

            Con `--bucle` eso pasa a ser un aviso y un reintento. Sin `--bucle` sigue
            siendo un error que sale por la puerta: quien pide UNA pasada quiere saber que
            no se pudo hacer, no que se está reintentando en segundo plano.
            """
            try:
                cola = api.get("/v1/perception/jobs?status=queued&limit=1")
            except (OSError, RuntimeError) as exc:
                if not args.bucle:
                    raise
                print(
                    f"la API no responde ({type(exc).__name__}); reintento en "
                    f"{args.espera} s",
                    flush=True,
                )
                time.sleep(args.espera)
                continue

            if cola["jobs"]:
                job = api.get(f"/v1/perception/jobs/{cola['jobs'][0]['id']}")
                codigo = _procesar(
                    api,
                    job,
                    latido,
                    seco=args.seco,
                    local=pesos_local,
                    clases_manual=clases_manual,
                    max_segundos=args.segundos,
                    trozos=args.trozos,
                )
                if not args.bucle:
                    return codigo
            else:
                if not args.bucle:
                    print("no hay ningun trabajo encolado")
                    return 0
                print(f"cola vacia · esperando {args.espera} s", flush=True)
                time.sleep(args.espera)
    except KeyboardInterrupt:
        print("\ninterrumpido")
        return 130
    finally:
        latido.detener()


if __name__ == "__main__":
    sys.exit(main())
