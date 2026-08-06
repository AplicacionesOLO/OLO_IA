"""Runner de entrenamiento: coge una ejecución encolada, entrena, y reporta.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ ESTO ES UN GUION Y NO UN ENDPOINT

Entrenar tarda de minutos a horas y necesita GPU. Dentro de la API sería un proceso
web bloqueado durante ese tiempo, sin forma de repartir el trabajo entre máquinas y
sin poder entrenar en un sitio y servir en otro. Así que la API es el REGISTRO —qué se
pidió, con qué datos, qué salió— y esto es el que trabaja.

Se ejecuta donde esté la GPU: en el portátil con CUDA, en una caja de alquiler, en
Colab con el repositorio montado. Lo único que necesita es alcanzar la API.

═══════════════════════════════════════════════════════════════════════════════
LO QUE HACE, EN ORDEN

  1. pide la siguiente ejecución `queued` (o la que se le indique con --run)
  2. `POST /start` con el nombre de esta máquina
  3. descarga el dataset congelado con el export YOLO que ya existe
  4. entrena con RF-DETR (Apache 2.0; ver la nota de `_entrenar`)
  5. `POST /finish` con las métricas reales y la referencia a los pesos

Si algo falla en 3, 4 o 5, cierra la ejecución como `failed` CON el motivo. Una
ejecución que se queda en `running` para siempre porque el proceso murió es peor que
una fallida: parece que sigue trabajando.

═══════════════════════════════════════════════════════════════════════════════
SIN RF-DETR NO ENTRENA, Y NO FINGE

Si `rfdetr` no está instalado, este guion NO reporta métricas inventadas ni cierra
la ejecución como si hubiera entrenado: se detiene y lo dice, y la ejecución sigue
encolada para que la coja una máquina que sí pueda.

    pip install rfdetr        # arrastra torch: ~2,5 GB

═══════════════════════════════════════════════════════════════════════════════
USO

    python tools/entrenar.py --listar
    python tools/entrenar.py                      # coge la siguiente encolada
    python tools/entrenar.py --run <uuid>
    python tools/entrenar.py --run <uuid> --seco   # sin entrenar, solo el ciclo

`--seco` recorre el ciclo completo —arranca, exporta el dataset, cierra— SIN entrenar
y SIN métricas, y deja la ejecución en `failed` con el motivo «prueba en seco». Sirve
para comprobar la fontanería de la API en una máquina sin GPU sin dejar un modelo
falso en el registro.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import platform
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
ENV_LOCAL = REPO / ".env.local"
SECRETS = REPO / ".secrets"


def _leer_clave(path: Path, clave: str) -> str | None:
    if not path.exists():
        return None
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        linea = raw.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        k, _, v = linea.partition("=")
        if k.strip() == clave:
            return v.strip().strip('"').strip("'")
    return None


class Api:
    """Cliente mínimo. `urllib` y no `httpx` a propósito.

    Este guion tiene que poder correr en una máquina que solo tiene Python y
    rfdetr —una caja de GPU alquilada, un Colab— sin instalar las dependencias
    del backend. Cada `import` extra es una razón más para que no arranque justo donde
    hace falta.
    """

    def __init__(self, base: str, token: str) -> None:
        # El esquema se COMPRUEBA, no se silencia. `urlopen` acepta `file:` y
        # esquemas propios, asi que un `--api file:///c:/algo` leeria el disco local
        # creyendo hablar con la API. Es la clase de cosa que no falla: devuelve algo.
        if not base.startswith(("http://", "https://")):
            msg = f"--api tiene que ser http o https, no {base.split(':', 1)[0]!r}"
            raise ValueError(msg)
        self._base = base.rstrip("/")
        self._token = token

    def _pedir(self, metodo: str, ruta: str, cuerpo: Any = None) -> Any:
        req = urllib.request.Request(
            f"{self._base}{ruta}",
            method=metodo,
            data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req) as r:
                crudo = r.read()
                return json.loads(crudo)["data"] if crudo else None
        except urllib.error.HTTPError as e:
            detalle = e.read().decode("utf-8", "replace")[:600]
            msg = f"HTTP {e.code} en {metodo} {ruta}: {detalle}"
            raise RuntimeError(msg) from e

    def get(self, ruta: str) -> Any:
        return self._pedir("GET", ruta)

    def post(self, ruta: str, cuerpo: Any = None) -> Any:
        return self._pedir("POST", ruta, cuerpo)

    def subir(self, url: str, datos: bytes, content_type: str) -> None:
        """Sube los bytes a Storage, con `POST` y con el token propio.

        Directo al almacenamiento y no a traves de la API: pasar 6 MB de pesos por el
        proceso web solo para reenviarlos gastaria memoria del servidor sin añadir nada.

        Dos detalles que cuestan un intento cada uno si se dan por hechos:

        · es POST, no PUT. Lo dice el docstring de `upload_endpoint`: «donde el cliente
          hace el POST del binario, con su propio token».
        · lleva `Authorization`. Sin ella Storage responde 401 y el `confirm` posterior
          falla diciendo «el objeto no existe», que es cierto y no explica por que.

        Y `confirm` COMPRUEBA que el objeto este: no hay forma de registrar un asset
        cuyos bytes no se subieron, que es exactamente lo que hay que querer.
        """
        req = urllib.request.Request(
            url,
            method="POST",
            data=datos,
            headers={
                "Content-Type": content_type,
                "Authorization": f"Bearer {self._token}",
            },
        )
        try:
            with urllib.request.urlopen(req) as r:
                if r.status >= 300:
                    msg = f"la subida devolvio HTTP {r.status}"
                    raise RuntimeError(msg)
        except urllib.error.HTTPError as e:
            # El CUERPO del error, no solo el codigo. Storage explica lo que rechaza
            # —«Duplicate», «mime type not supported», «exceeded maximum size»— y sin
            # ese texto un 400 es indiagnosticable. Medido: un entrenamiento de 6
            # minutos terminado, los pesos en disco, y `HTTPError: HTTP Error 400: Bad
            # Request` como unica pista.
            detalle = e.read().decode("utf-8", "replace")[:400]
            pista = ""
            if "EntityTooLarge" in detalle or "exceeded the maximum" in detalle:
                # El tope que muerde NO es el del bucket. `ai-assets` declara 2 GiB
                # (migracion 0045) y aun asi Storage rechaza 120 MB: el limite es el
                # GLOBAL del proyecto de Supabase, que se configura en el panel
                # —Storage → Settings → Upload file size limit— y en el plan gratuito
                # esta en 50 MB.
                #
                # Un checkpoint de RF-DETR Nano son ~120 MB, asi que sin subir ese tope
                # no hay forma de publicar ningun modelo entrenado.
                pista = (
                    "\n\n      El tope que rechaza NO es el del bucket (2 GiB). Es el "
                    "limite GLOBAL de subida del proyecto de Supabase.\n"
                    "      Subelo en el panel: Storage -> Settings -> Upload file size "
                    "limit (un checkpoint de RF-DETR Nano son ~120 MB).\n"
                    "      Los pesos siguen en disco: cuando lo subas, repite este "
                    "comando y se publican sin reentrenar."
                )
            msg = f"la subida devolvio HTTP {e.code}: {detalle}{pista}"
            raise RuntimeError(msg) from e

    def descargar(self, ruta: str, destino: Path) -> Path:
        """Descarga un binario de la API, con el token."""
        req = urllib.request.Request(
            f"{self._base}{ruta}", headers={"Authorization": f"Bearer {self._token}"}
        )
        with urllib.request.urlopen(req) as r, destino.open("wb") as f:
            shutil.copyfileobj(r, f)
        return destino

    @staticmethod
    def descargar_url(url: str, destino: Path) -> Path:
        """Descarga una URL FIRMADA de Storage.

        Sin cabeceras: la firma ES la autorización. Mandar además el Bearer de la API a
        Storage no aporta nada y confunde al diagnosticar un 401.
        """
        if not url.startswith(("http://", "https://")):
            msg = "la url firmada no es http(s)"
            raise ValueError(msg)
        with urllib.request.urlopen(url) as r, destino.open("wb") as f:
            shutil.copyfileobj(r, f)
        return destino


def _login(base: str, email: str, password: str) -> str:
    if not base.startswith(("http://", "https://")):
        msg = f"--api tiene que ser http o https, no {base.split(':', 1)[0]!r}"
        raise ValueError(msg)
    req = urllib.request.Request(
        f"{base.rstrip('/')}/v1/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return str(json.load(r)["data"]["access_token"])


def _nombre_de_maquina() -> str:
    """Quién entrenó. Se manda al arrancar y queda en la ejecución.

    Es el dato que explica dos ejecuciones con los mismos hiperparámetros y métricas
    distintas: casi siempre es dónde corrieron.
    """
    gpu = "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            gpu = torch.cuda.get_device_name(0).replace(" ", "-")
    except Exception:  # noqa: S110 — sin torch, el nombre se queda en «cpu»
        pass
    return f"{platform.node()}/{gpu}"[:100]


def _hay_rfdetr() -> bool:
    import importlib.util

    return importlib.util.find_spec("rfdetr") is not None


def _materializar(api: Api, proyecto: str, version: str, raiz: Path) -> int:
    """Baja el dataset congelado a disco, en la estructura que YOLO espera.

    ── EL EXPORT ES UN MANIFIESTO, NO UN ZIP ───────────────────────────────

    Este guion intentaba `zipfile.ZipFile(...)` sobre la respuesta y fallaba con
    `BadZipFile: File is not a zip file`. No era un fichero corrupto: el endpoint nunca
    devolvió un ZIP. Devuelve JSON con `data_yaml`, `class_map` y un `items` donde cada
    entrada trae el `object_path` de la imagen y su `label` —las cajas ya remapeadas a
    índices contiguos—.

    Y es lo correcto: un ZIP obligaría al backend a leer 5.000 imágenes de Storage,
    comprimirlas y servirlas por el proceso web. Con el manifiesto, cada imagen se baja
    firmada y directa desde Storage, en paralelo si hiciera falta.

    Devuelve cuántas imágenes se materializaron.
    """
    manifiesto = api.get(
        f"/v1/ai/projects/{proyecto}/dataset-versions/{version}/export"
    )
    raiz.mkdir(parents=True, exist_ok=True)
    (raiz / "data.yaml").write_text(manifiesto["data_yaml"], encoding="utf-8")

    bajadas = 0
    for item in manifiesto["items"]:
        # El export usa `val`; RF-DETR y Roboflow usan `valid`. Se normaliza aquí para
        # que la conversión a COCO encuentre los tres splits sin adivinar.
        split = {"val": "val", "valid": "val"}.get(item["split"], item["split"])
        img_dir = raiz / "images" / split
        lbl_dir = raiz / "labels" / split
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)

        destino = img_dir / item["filename"]
        if not destino.exists():
            # La firma se pide por asset: es una llamada HTTP por imagen, y con 15 no
            # merece paralelizar. Con miles habría que hacerlo, y el manifiesto ya lo
            # permite porque trae todos los `asset_id` de golpe.
            firma = api.get(f"/v1/ai/assets/{item['asset_id']}/url")
            api.descargar_url(firma["url"], destino)
        bajadas += 1

        # El `.txt` va SIEMPRE, incluso vacío: una imagen sin cajas es un negativo
        # legítimo que le enseña al modelo dónde no hay nada. Sin el fichero, algunos
        # cargadores la tratan como imagen sin etiquetar y la descartan.
        (lbl_dir / f"{Path(item['filename']).stem}.txt").write_text(
            item["label"] + ("\n" if item["label"] else ""), encoding="utf-8"
        )

    return bajadas


def _yolo_a_coco(raiz: Path) -> Path:
    """Convierte el export YOLO del backend a COCO, que es lo que RF-DETR entrena.

    ── POR QUÉ LA CONVERSIÓN VIVE AQUÍ Y NO EN EL BACKEND ──────────────────

    El export del dataset congelado es YOLO —`data.yaml` + un `.txt` por imagen— y ese
    es su contrato: lo que congela es QUÉ imágenes y QUÉ cajas, no en qué formato las
    lee un entrenador concreto. Añadir un segundo formato al backend sería duplicar la
    materialización de un dataset para acomodar a una librería.

    RF-DETR espera la estructura de Roboflow: `train/`, `valid/`, `test/`, cada uno con
    sus imágenes y un `_annotations.coco.json`.

    ── EL DETALLE QUE IMPORTA ──────────────────────────────────────────────

    YOLO guarda las cajas NORMALIZADAS y centradas (`cx cy w h` de 0 a 1); COCO las
    quiere en PÍXELES y desde la esquina (`x y w h`). Convertir mal no falla: entrena y
    el modelo aprende cajas desplazadas. Por eso hace falta el tamaño real de cada
    imagen, y se lee de la imagen, no del `data.yaml` —que no lo trae—.
    """
    import cv2

    destino = raiz / "coco"
    if (destino / "train" / "_annotations.coco.json").exists():
        return destino

    # El nombre de las clases sale del `data.yaml`, que el export sí garantiza.
    yaml = next(iter(raiz.rglob("data.yaml")), None)
    if yaml is None:
        msg = f"el export no trae data.yaml en {raiz}"
        raise RuntimeError(msg)
    nombres: list[str] = []
    dentro = False
    for linea in yaml.read_text(encoding="utf-8").splitlines():
        if linea.startswith("names:"):
            dentro = True
            continue
        if dentro:
            recortada = linea.strip()
            if recortada.startswith("-"):
                nombres.append(recortada.lstrip("- ").strip().strip("'\""))
            elif recortada and ":" in recortada and not recortada[0].isdigit():
                break
            elif recortada and recortada[0].isdigit():
                nombres.append(recortada.split(":", 1)[1].strip().strip("'\""))

    # COCO numera las categorías desde 1; YOLO desde 0. El desfase de uno es el error
    # clásico de esta conversión y deja todas las clases corridas una posición.
    categorias = [{"id": i + 1, "name": n or f"clase_{i}"} for i, n in enumerate(nombres)]

    for split in ("train", "valid", "test"):
        # ── Los DOS diseños de YOLO en disco, y los dos nombres del split ────
        #
        # `_materializar` deja `images/{split}` y `labels/{split}` —el diseño que usa
        # el export de este proyecto— pero un dataset traído de fuera puede venir como
        # `{split}/images`. Se aceptan los dos porque el runner tiene que poder
        # entrenar con un dataset que no salió de aquí.
        #
        # Y el split se llama `val` en el export y `valid` en RF-DETR. Buscar solo uno
        # es lo que dejó la conversión en CERO imágenes, con un error final —«Please
        # call iter(combined_loader) first»— que no menciona rutas ni splits. La pista
        # real estaba tres pantallas antes: «dataset is too small: 0 < 40».
        alias = {"train": ("train",), "valid": ("valid", "val"), "test": ("test",)}
        candidatos: list[tuple[Path, Path]] = []
        for nombre in alias[split]:
            candidatos.append((raiz / "images" / nombre, raiz / "labels" / nombre))
            candidatos.append((raiz / nombre / "images", raiz / nombre / "labels"))
            candidatos.append((raiz / nombre, raiz / nombre))
        pareja = next(((img, lbl) for img, lbl in candidatos if img.is_dir()), None)
        if pareja is None:
            continue
        img_dir, lbl_dir = pareja

        out = destino / split
        out.mkdir(parents=True, exist_ok=True)
        imagenes: list[dict[str, Any]] = []
        anotaciones: list[dict[str, Any]] = []
        for n, img_path in enumerate(sorted(p for p in img_dir.iterdir() if p.is_file())):
            if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
                continue
            leida = cv2.imread(str(img_path))
            if leida is None:
                continue
            alto, ancho = leida.shape[:2]
            shutil.copy2(img_path, out / img_path.name)
            imagenes.append(
                {"id": n + 1, "file_name": img_path.name, "width": ancho, "height": alto}
            )

            etiquetas = lbl_dir / f"{img_path.stem}.txt"
            if not etiquetas.exists():
                # Una imagen SIN etiquetas es un negativo legítimo, no un fallo: le
                # enseña al modelo dónde no hay nada. Se incluye sin anotaciones.
                continue
            for fila in etiquetas.read_text(encoding="utf-8").splitlines():
                partes = fila.split()
                if len(partes) < 5:
                    continue
                clase = int(float(partes[0]))
                cx, cy, w, h = (float(v) for v in partes[1:5])
                anotaciones.append(
                    {
                        "id": len(anotaciones) + 1,
                        "image_id": n + 1,
                        "category_id": clase + 1,
                        "bbox": [
                            round((cx - w / 2) * ancho, 2),
                            round((cy - h / 2) * alto, 2),
                            round(w * ancho, 2),
                            round(h * alto, 2),
                        ],
                        "area": round(w * ancho * h * alto, 2),
                        "iscrowd": 0,
                    }
                )

        (out / "_annotations.coco.json").write_text(
            json.dumps(
                {"images": imagenes, "annotations": anotaciones, "categories": categorias}
            ),
            encoding="utf-8",
        )
        print(f"    {split}: {len(imagenes)} imagenes, {len(anotaciones)} cajas")

    # RF-DETR exige los tres directorios. Si el dataset no tiene `test`, se crea vacío:
    # sin él la librería falla al construir el cargador, y por un split opcional.
    for split in ("train", "valid", "test"):
        d = destino / split
        d.mkdir(parents=True, exist_ok=True)
        if not (d / "_annotations.coco.json").exists():
            (d / "_annotations.coco.json").write_text(
                json.dumps({"images": [], "annotations": [], "categories": categorias}),
                encoding="utf-8",
            )
    return destino


def _entrenar(
    *, raiz_dataset: Path, arquitectura: str, hiperparams: dict[str, Any], salida: Path
) -> dict[str, Any]:
    """Entrena de verdad y devuelve las métricas que produjo el entrenador.

    ── RF-DETR, NO YOLO, Y POR QUÉ ─────────────────────────────────────────

    La migración 0061 desactivó las 11 arquitecturas de Ultralytics: YOLO11 y YOLOv8 son
    AGPL-3.0 y su §13 obliga a entregar el código fuente completo a cualquier usuario que
    interactúe por red. OLO_IA es SaaS multi-tenant, así que la obligación alcanzaría al
    producto entero —y Ultralytics sostiene que alcanza también a los PESOS entrenados—.

    Este guion usaba `ultralytics` pese a esa decisión. Corregido: RF-DETR es Apache 2.0,
    acepta `bbox` —lo que el proyecto tiene anotado— y es lo que 0061 dejó activo.

    Las métricas se LEEN del resultado, no se calculan aquí ni se redondean a algo
    presentable: son las que el entrenador midió sobre el conjunto de validación, y son
    lo único con lo que después se puede comparar dos modelos.
    """
    epocas = int(hiperparams.get("epochs", 50))
    resolucion = int(hiperparams.get("resolution", hiperparams.get("imgsz", 560)))
    batch = int(hiperparams.get("batch_size", hiperparams.get("batch", 4)))
    lr = float(hiperparams.get("lr", 1e-4))

    print("    convirtiendo el export YOLO a COCO…")
    coco = _yolo_a_coco(raiz_dataset)

    modelo = _modelo_rfdetr(arquitectura)

    # ── La resolución tiene que ser divisible por `patch_size * num_windows` ──
    #
    # Y ese producto DEPENDE DE LA VARIANTE: en nano es 16 * 2 = 32; en base es otro.
    # La nota de la migración 0061 dice «divisible por 56» y es incorrecta para nano
    # —392 lo es y aun así falla—, así que el divisor se LEE del modelo en vez de
    # suponerse. Medido: `resolution=392 is not divisible by patch_size (16) *
    # num_windows (2) = 32`.
    #
    # Se comprueba ANTES de entrenar porque el fallo ocurre al construir el modelo,
    # después de haber materializado el dataset y descargado 349 MB de pesos.
    cfg = getattr(modelo, "model_config", None)
    divisor = int(getattr(cfg, "patch_size", 16)) * int(getattr(cfg, "num_windows", 1))
    if divisor > 0 and resolucion % divisor != 0:
        ajustada = max(divisor, round(resolucion / divisor) * divisor)
        print(
            f"    resolucion {resolucion} no es divisible por {divisor} "
            f"(patch_size * num_windows de {arquitectura}): se usa {ajustada}"
        )
        resolucion = ajustada

    t0 = time.monotonic()
    modelo.train(
        dataset_dir=str(coco),
        epochs=epocas,
        batch_size=batch,
        lr=lr,
        resolution=resolucion,
        output_dir=str(salida),
    )
    segundos = round(time.monotonic() - t0, 1)

    metricas: dict[str, Any] = {
        "epochs": epocas,
        "resolution": resolucion,
        "batch_size": batch,
        "lr": lr,
        "train_seconds": segundos,
        "architecture": arquitectura,
        "framework": "rfdetr",
    }

    # ── Los pesos ANTES de las métricas, y el orden importa ────────────────────
    #
    # RF-DETR guarda TRES checkpoints con métricas distintas: `best_regular`, `best_ema`
    # y `best_total`, que es el mejor de los dos anteriores según su propio criterio.
    #
    # `best_total` primero, y no `best_ema`: cuál gana cambia de una ejecución a otra.
    # Medido con los mismos hiperparámetros y el mismo dataset:
    #
    #     run 3adf9172 → gana EMA      (regular 0,3322 · ema 0,3658)
    #     run 7632d814 → gana REGULAR  (regular 0,3176 · ema 0,2756)
    #
    # Preferir `best_ema` a ciegas publicó en la segunda el peor de los dos —0,276 en
    # lugar de 0,318—. No era un error visible: las métricas seguían describiendo los
    # pesos subidos, así que el modelo publicado era simplemente peor sin que nada
    # lo dijera.
    patrones = (
        "*best_total*.pth", "*best_ema*.pth", "*best*.pth", "*best*.pt", "*.pth", "*.pt",
    )
    for patron in patrones:
        pesos = next(iter(sorted(salida.rglob(patron))), None)
        if pesos is not None:
            metricas["weights_file"] = str(pesos)
            metricas["weights_bytes"] = pesos.stat().st_size
            break

    # Las métricas se LEEN de lo que RF-DETR deja, no se inventan. Si no hay registro,
    # `metricas` va SIN mAP: un 0 sería una afirmación —«el modelo no acierta nada»— y
    # lo cierto es «no lo sé». La pantalla distingue las dos cosas.
    metricas.update(_metricas_csv(salida, metricas.get("weights_file")))
    if "map50_95" in metricas:
        return metricas

    # Camino antiguo: versiones de RF-DETR anteriores a PyTorch Lightning escribían un
    # log JSON por líneas. Se conserva para no romper una máquina que no haya
    # actualizado la librería.
    for nombre in ("results.json", "log.txt", "results.txt"):
        registro = next(iter(sorted(salida.rglob(nombre))), None)
        if registro is None:
            continue
        try:
            crudo = registro.read_text(encoding="utf-8", errors="replace")
            # El log de RF-DETR es JSON por líneas; se coge la última que traiga mAP.
            for linea in reversed(crudo.strip().splitlines()):
                try:
                    fila = json.loads(linea)
                except ValueError:
                    continue
                if not isinstance(fila, dict):
                    continue
                for destino, posibles in (
                    ("map50", ("test_coco_eval_bbox_50", "map50", "AP50")),
                    ("map50_95", ("test_coco_eval_bbox", "map", "AP")),
                ):
                    for clave in posibles:
                        valor = fila.get(clave)
                        if isinstance(valor, list) and valor:
                            valor = valor[0]
                        if isinstance(valor, (int, float)):
                            metricas.setdefault(destino, round(float(valor), 5))
                            break
                if "map50_95" in metricas:
                    break
        except OSError:
            continue
        break

    return metricas


def _maximo_columna(csv_path: Path, columna: str) -> float | None:
    """El valor mas alto de una columna del `metrics.csv`, o `None` si no hay ninguno."""
    try:
        with csv_path.open(encoding="utf-8", newline="") as f:
            valores = []
            for fila in csv.DictReader(f):
                crudo = (fila.get(columna) or "").strip()
                try:
                    valores.append(float(crudo))
                except ValueError:
                    continue
    except OSError:
        return None
    return max(valores) if valores else None


def _gana_ema(csv_path: Path) -> bool:
    """Que familia de pesos es la mejor: EMA o regular.

    Es el mismo criterio que usa RF-DETR para decidir de cual saca
    `checkpoint_best_total.pth`, y hay que reproducirlo porque el nombre de ese archivo
    no lo dice. Ante empate o falta de datos, EMA: es lo que RF-DETR guarda por defecto.
    """
    regular = _maximo_columna(csv_path, "val/mAP_50_95")
    ema = _maximo_columna(csv_path, "val/ema_mAP_50_95")
    if regular is None or ema is None:
        return ema is not None
    return ema >= regular


def _metricas_csv(salida: Path, pesos: str | None) -> dict[str, Any]:
    """Las métricas del `metrics.csv` que escribe PyTorch Lightning.

    ── POR QUE HIZO FALTA ────────────────────────────────────────────────────────

    RF-DETR paso a PyTorch Lightning y dejo de escribir `results.json`. El lector
    antiguo no encontraba nada, asi que la version se registraba SIN mAP: medido en la
    ejecucion 3adf9172, que entreno hasta 0,366 y guardo
    «metricas que no vinieron: map50, map50_95». Un modelo publicado sin metricas no se
    puede comparar con el siguiente, que es justo para lo que sirve versionarlos.

    ── POR QUE MIRA QUE CHECKPOINT SE SUBE ──────────────────────────────────────

    Lightning registra dos familias de columnas para la misma epoca:

        val/mAP_50, val/mAP_50_95            los pesos «regular»
        val/ema_mAP_50, val/ema_mAP_50_95    los pesos EMA (media movil)

    Y no coinciden: en esa ejecucion, 0,332 frente a 0,366. RF-DETR guarda el mejor de
    los dos como `checkpoint_best_total.pth` y por eso `_entrenar` sube el `best_ema`
    cuando existe. Reportar las columnas regulares describiria unos pesos DISTINTOS de
    los publicados — un error que nadie detectaria porque las dos cifras son creibles.

    Se coge la fila con el mAP_50_95 mas alto de la familia que corresponde, no la
    ultima: la ultima epoca no es necesariamente la mejor, y el checkpoint guardado es
    el mejor.

    ── EL CASO `best_total` ──────────────────────────────────────────────────────

    `checkpoint_best_total.pth` es el que RF-DETR elige entre los dos, y su NOMBRE no
    dice de cual salio. Asi que se reproduce su criterio: gana la familia con el
    mAP_50_95 mas alto. Es lo mismo que decide el, y comprobado contra sus propios
    mensajes en las dos ejecuciones («saved from EMA» y «saved from regular»).
    """
    csv_path = next(iter(sorted(salida.rglob("metrics.csv"))), None)
    if csv_path is None:
        return {}

    nombre_pesos = Path(pesos).name.lower() if pesos else ""
    if "ema" in nombre_pesos:
        ema = True
    elif "regular" in nombre_pesos:
        ema = False
    else:
        # `best_total` u otro: se decide comparando, como hace RF-DETR.
        ema = _gana_ema(csv_path)
    prefijo = "val/ema_" if ema else "val/"
    columnas = {
        "map50": f"{prefijo}mAP_50",
        "map50_95": f"{prefijo}mAP_50_95",
        "mar": f"{prefijo}mAR",
        "f1": "val/F1",
    }

    try:
        with csv_path.open(encoding="utf-8", newline="") as f:
            filas = list(csv.DictReader(f))
    except OSError:
        return {}

    def numero(fila: dict[str, str], col: str) -> float | None:
        crudo = (fila.get(col) or "").strip()
        try:
            return float(crudo)
        except ValueError:
            return None

    # Lightning escribe una fila por evento, asi que muchas traen la columna vacia.
    candidatas = [f for f in filas if numero(f, columnas["map50_95"]) is not None]
    if not candidatas:
        return {}
    mejor = max(candidatas, key=lambda f: numero(f, columnas["map50_95"]) or 0.0)

    salida_metricas: dict[str, Any] = {"metrics_source": csv_path.name, "weights_ema": ema}
    for destino, col in columnas.items():
        v = numero(mejor, col)
        if v is not None:
            salida_metricas[destino] = round(v, 5)

    ep = numero(mejor, "epoch")
    if ep is not None:
        salida_metricas["best_epoch"] = int(ep)

    # AP por clase: es lo que dice QUE se lee mal, no solo cuanto. Con 5 clases, saber
    # que `qr_ubicacion` va a 0 y `pallet` a 0,72 es la diferencia entre «el modelo es
    # regular» y «el modelo no lee codigos de hueco».
    por_clase = {}
    for col in mejor:
        if col.startswith("val/AP/"):
            v = numero(mejor, col)
            if v is not None:
                por_clase[col.removeprefix("val/AP/")] = round(v, 5)
    if por_clase:
        salida_metricas["ap_por_clase"] = por_clase
    return salida_metricas


def _modelo_rfdetr(arquitectura: str) -> Any:
    """La variante de RF-DETR que pide la arquitectura del catálogo.

    El mapa es explícito y no una construcción por nombre: `getattr(rfdetr, ...)` sobre
    una cadena que viene de la base de datos convertiría una fila mal escrita en una
    llamada a cualquier atributo del módulo.
    """
    from rfdetr import RFDETRBase, RFDETRLarge, RFDETRMedium, RFDETRNano, RFDETRSmall

    variantes = {
        "rf-detr-nano": RFDETRNano,
        "rf-detr-small": RFDETRSmall,
        "rf-detr-medium": RFDETRMedium,
        "rf-detr-base": RFDETRBase,
        "rf-detr-large": RFDETRLarge,
    }
    clase = variantes.get(arquitectura)
    if clase is None:
        msg = (
            f"la arquitectura «{arquitectura}» no es de RF-DETR. Las activas son: "
            + ", ".join(sorted(variantes))
            + ". Las de Ultralytics estan desactivadas desde 0061 por licencia AGPL."
        )
        raise RuntimeError(msg)
    return clase()


def main() -> int:
    ap = argparse.ArgumentParser(description="Runner de entrenamiento de OLO_IA")
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", default="arojas@ologistics.com")
    ap.add_argument("--run", help="uuid de la ejecucion; sin esto coge la siguiente encolada")
    ap.add_argument("--listar", action="store_true", help="lista las ejecuciones y sale")
    ap.add_argument(
        "--seco",
        action="store_true",
        help="recorre el ciclo SIN entrenar y cierra como fallida con el motivo. "
        "Para comprobar la fontaneria en una maquina sin GPU sin dejar un modelo falso",
    )
    ap.add_argument("--trabajo", default=str(Path.home() / "olo-entrenamientos"))
    args = ap.parse_args()

    pw_path = SECRETS / "adminpw.txt"
    if not pw_path.exists():
        print(f"FALTA la contraseña en {pw_path}")
        return 2
    token = _login(args.api, args.email, pw_path.read_text(encoding="utf-8").strip())
    api = Api(args.api, token)

    if args.listar:
        datos = api.get("/v1/ai/training-runs?limit=50")
        print(f"runner conectado segun la API: {datos['runner_available']}")
        if datos.get("unavailable_reason"):
            print(f"   {datos['unavailable_reason']}")
        for r in datos["runs"]:
            print(
                f"  {r['status']:10} {r['id']} · {r['architecture_code']:12} "
                f"· runner={r['runner'] or '-'} · {r['created_at'][:19]}"
            )
        if not datos["runs"]:
            print("  (ninguna ejecucion todavia)")
        return 0

    # ── Elegir la ejecución ────────────────────────────────────────────────
    if args.run:
        run = api.get(f"/v1/ai/training-runs/{args.run}")
    else:
        cola = api.get("/v1/ai/training-runs?status=queued&limit=1")
        if not cola["runs"]:
            print("no hay ninguna ejecucion encolada")
            return 0
        run = cola["runs"][0]

    run_id = run["id"]
    print(f"→ ejecucion {run_id}")
    print(f"  arquitectura : {run['architecture_code']}")
    print(f"  dataset      : {run['dataset_version_id']}")
    print(f"  clases       : {len(run['class_map'])}")
    print(f"  hiperparams  : {json.dumps(run['hyperparams'], ensure_ascii=False)}")

    if not args.seco and not _hay_rfdetr():
        # NO se cierra la ejecución: se deja encolada para que la coja una máquina que
        # pueda. Cerrarla como fallida por no tener la librería castigaría al
        # entrenamiento por un problema de esta máquina.
        print(
            "\nFALTA `rfdetr` en esta maquina, asi que NO se entrena y la ejecucion se\n"
            "queda ENCOLADA para otra que si pueda.\n"
            "  pip install rfdetr      (arrastra torch, ~2,5 GB)\n"
            "\nNo se reportan metricas inventadas: «todavia no hay con que entrenar» y\n"
            "«se entreno y estos son los resultados» no son lo mismo.\n"
            "\nRF-DETR y no YOLO por licencia: ver la nota de `_entrenar`."
        )
        return 3

    # ── Arrancar ───────────────────────────────────────────────────────────
    maquina = _nombre_de_maquina()
    run = api.post(f"/v1/ai/training-runs/{run_id}/start", {"runner": maquina})
    print(f"\n[1/3] arrancada en {maquina}")

    trabajo = Path(args.trabajo) / str(run_id)
    trabajo.mkdir(parents=True, exist_ok=True)

    try:
        # ── Dataset ────────────────────────────────────────────────────────
        proyecto = run["project_id"]
        dv = run["dataset_version_id"]
        raiz = trabajo / "dataset"
        imagenes = _materializar(api, proyecto, dv, raiz)
        print(f"[2/3] dataset materializado: {imagenes} imagenes en {raiz}")

        if args.seco:
            # Se cierra como FALLIDA con el motivo, no como éxito sin métricas: una
            # ejecución `succeeded` sin pesos sería un modelo que no existe.
            api.post(
                f"/v1/ai/training-runs/{run_id}/finish",
                {
                    "error_message": (
                        f"prueba en seco: se comprobo el ciclo completo y el dataset "
                        f"({imagenes} imagenes) sin entrenar. No hay modelo."
                    )
                },
            )
            print("[3/3] cerrada como fallida · prueba en seco, sin modelo")
            return 0

        # ── Entrenar ───────────────────────────────────────────────────────
        metricas = _entrenar(
            raiz_dataset=raiz,
            arquitectura=str(run["architecture_code"]),
            hiperparams=dict(run["hyperparams"]),
            salida=trabajo / "salida",
        )
        print(f"[3/3] entrenado: {json.dumps(metricas, ensure_ascii=False)}")

        # ── Subir los pesos ────────────────────────────────────────────────
        #
        # `ai.model_versions.weights_asset_id` es NOT NULL, y con razon: una version
        # sin archivo no es una version, es una anotacion sobre unas metricas. Asi que
        # el `best.pt` se sube como asset de tipo `weights` con el mismo
        # prepare/confirm que las imagenes del proyecto.
        pesos = metricas.get("weights_file")
        if not pesos or not Path(pesos).exists():
            msg = (
                "el entrenamiento termino y no dejo `best.pt`: sin archivo de pesos no "
                "se puede registrar la version"
            )
            raise RuntimeError(msg)

        ruta_pesos = Path(pesos)
        contenido = ruta_pesos.read_bytes()
        sha = hashlib.sha256(contenido).hexdigest()
        print(f"      subiendo pesos: {ruta_pesos.name} · {len(contenido) / 1e6:.1f} MB")

        prep = api.post(
            f"/v1/ai/projects/{proyecto}/assets/prepare",
            {
                "kind": "weights",
                "content_type": "application/octet-stream",
                "bytes": len(contenido),
                "original_filename": ruta_pesos.name,
            },
        )
        api.subir(prep["upload_url"], contenido, "application/octet-stream")
        asset = api.post(
            f"/v1/ai/projects/{proyecto}/assets/confirm",
            {
                "asset_id": prep["asset_id"],
                "kind": "weights",
                "original_filename": ruta_pesos.name,
                "content_type": "application/octet-stream",
                "bytes": len(contenido),
                "sha256": sha,
            },
        )
        print(f"      pesos guardados como asset {asset['id']}")

        resultado = api.post(
            f"/v1/ai/training-runs/{run_id}/finish",
            {
                "metrics": metricas,
                "weights_asset_id": asset["id"],
                # DONDE CORRIO, que es distinto de donde estan los bytes: eso lo dice
                # el asset. Las dos cosas hacen falta para reproducir un resultado.
                "source_reference": f"{maquina}:{pesos}",
                "version_notes": (
                    f"entrenado por {maquina} · "
                    f"mAP50={metricas.get('map50', 'n/d')} · "
                    f"{metricas.get('train_seconds')} s"
                ),
            },
        )
        v = resultado.get("version")
        print(f"\n✓ version registrada: v{v['version']} ({v['status']})" if v else "\n✓ cerrada")
        if resultado.get("missing_metrics"):
            print(f"  metricas que no vinieron: {', '.join(resultado['missing_metrics'])}")
        if v:
            print(
                "\nLa version nace en `registered`. Para que percepcion la ofrezca hay "
                "que validarla y publicarla:\n"
                f"  POST /v1/ai/model-versions/{v['id']}/status  "
                '{"to_status": "validating"}  → validated → published'
            )
        return 0

    except Exception as exc:  # se reporta y se cierra la ejecución
        # Una ejecución que se queda en `running` para siempre porque el proceso murió
        # es peor que una fallida: parece que sigue trabajando.
        motivo = f"{type(exc).__name__}: {exc}"[:3900]
        print(f"\n✗ FALLO: {motivo}")
        try:
            api.post(f"/v1/ai/training-runs/{run_id}/finish", {"error_message": motivo})
            print("  ejecucion cerrada como `failed` con el motivo")
        except Exception as cierre:
            print(f"  ADEMAS no se pudo cerrar la ejecucion: {cierre}")
            print(f"  cierrala a mano: POST /v1/ai/training-runs/{run_id}/cancel")
        return 1


if __name__ == "__main__":
    sys.exit(main())
