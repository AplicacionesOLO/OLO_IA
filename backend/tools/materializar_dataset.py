"""Materializa en disco una versión de dataset y deja listo el entrenamiento.

─────────────────────────────────────────────────────────────────────────────
POR QUE ESTE PASO EXISTE

El export de la API es un MANIFIESTO, no un ZIP: las imágenes viven en Supabase
Storage y no pasan por el backend. Con 5.000 fotos, un ZIP serían gigabytes
atravesando la API y un `timeout` de proxy garantizado.

Este script coge el manifiesto, descarga los binarios con las URLs firmadas y escribe
el árbol que ultralytics espera:

    <destino>/
      data.yaml
      images/train/*.jpg   labels/train/*.txt
      images/val/*.jpg     labels/val/*.txt
      images/test/*.jpg    labels/test/*.txt

─────────────────────────────────────────────────────────────────────────────
EL ENTRENAMIENTO NO CORRE AQUI, Y NO ES UNA LIMITACION

`ai.model_versions.weights_asset_id` es NOT NULL: el modelo de datos dice que una
versión de modelo se REGISTRA con sus pesos, no que se entrene dentro. Y el backend
no tiene torch ni ultralytics a propósito — entrenar dentro de una petición HTTP
bloquearía un worker de uvicorn durante horas y moriría con el primer redespliegue.

Así que se entrena fuera, con el comando que este script imprime al terminar, y los
pesos resultantes se suben como asset `kind=weights`.

─────────────────────────────────────────────────────────────────────────────
USO

    python tools/materializar_dataset.py \
        --api http://127.0.0.1:8000/v1 \
        --token "<access token>" \
        --project <uuid> --version <uuid> \
        --destino C:\\datasets\\alturas-v1

El token es el JWT de la sesión: se pasa por argumento y NO se imprime nunca. Las
URLs firmadas caducan en 15 minutos, así que la descarga tiene que empezar ya.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import httpx

_SPLITS = ("train", "val", "test")


def descargar_manifiesto(api: str, token: str, project: str, version: str) -> dict[str, Any]:
    url = f"{api.rstrip('/')}/ai/projects/{project}/dataset-versions/{version}/export"
    r = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=120.0)
    if r.status_code != 200:
        # Se imprime el cuerpo, que trae el código de error del backend, pero NUNCA la
        # cabecera de autorización.
        print(f"la API respondio {r.status_code}: {r.text[:400]}", file=sys.stderr)
        raise SystemExit(1)
    return r.json()["data"]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--api", required=True)
    p.add_argument("--token", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--destino", required=True, type=Path)
    args = p.parse_args()

    datos = descargar_manifiesto(args.api, args.token, args.project, args.version)

    if not datos.get("signed"):
        print(
            f"el manifiesto llego SIN URLs firmadas ({datos['image_count']} imagenes "
            f"supera el techo de {datos['sign_limit']}). Este script necesita las firmas.",
            file=sys.stderr,
        )
        return 1

    raiz: Path = args.destino
    for s in _SPLITS:
        (raiz / "images" / s).mkdir(parents=True, exist_ok=True)
        (raiz / "labels" / s).mkdir(parents=True, exist_ok=True)

    (raiz / "data.yaml").write_text(datos["data_yaml"], encoding="utf-8")

    print(f"version {datos['version']} · {datos['image_count']} imagenes "
          f"({datos['train_count']}/{datos['val_count']}/{datos['test_count']})")
    print("mapa de clases (training_index → nombre):")
    for c in datos["class_map"]:
        ti, nombre_c, ci = c["training_index"], c["name"], c["class_index"]
        print(f"  {ti}: {nombre_c}   (class_index del proyecto: {ci})")
    print()

    fallos = 0
    with httpx.Client(timeout=120.0, follow_redirects=True) as cliente:
        for i, item in enumerate(datos["items"], start=1):
            split = item["split"]
            nombre = item["filename"]
            destino_img = raiz / "images" / split / nombre
            # El `.txt` comparte nombre base con la imagen: es como ultralytics los
            # empareja. Si no coinciden, entrena con las cajas de otra foto.
            destino_lbl = raiz / "labels" / split / f"{Path(nombre).stem}.txt"

            if not item.get("url"):
                print(f"  [{i}] SIN URL: {nombre}", file=sys.stderr)
                fallos += 1
                continue
            try:
                r = cliente.get(item["url"])
                r.raise_for_status()
            except httpx.HTTPError as exc:
                print(f"  [{i}] fallo la descarga de {nombre}: {exc}", file=sys.stderr)
                fallos += 1
                continue

            destino_img.write_bytes(r.content)
            # Un `.txt` VACIO es válido y necesario: marca la imagen como negativo. Sin
            # el archivo, ultralytics la trata como no etiquetada y la ignora.
            destino_lbl.write_text(
                (item["label"] + "\n") if item["label"] else "", encoding="utf-8"
            )
            print(f"  [{i}/{len(datos['items'])}] {split}/{nombre} · {item['box_count']} cajas")

    print()
    if fallos:
        print(f"{fallos} imagenes NO se descargaron. El dataset esta incompleto.",
              file=sys.stderr)
        return 1

    print(f"dataset listo en {raiz}")
    print()
    print("Para entrenar (fuera de este backend, en un entorno con GPU si es posible):")
    print("    pip install ultralytics")
    print(f'    yolo detect train data="{raiz / "data.yaml"}" model=yolo11n.pt '
          "epochs=100 imgsz=960 batch=8")
    print()
    print("Los pesos salen en runs/detect/train/weights/best.pt. Ese archivo se sube")
    print("como asset kind=weights y se registra como version del modelo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
