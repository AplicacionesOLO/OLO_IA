"""Conjunto testigo para demostrar cero pérdida de datos en el movimiento 0033.

«0 filas antes, 0 filas después» es una tautología y no demuestra nada. Este
script siembra 7 filas ENLAZADAS por las FK compuestas, con COMMIT real, y las
verifica campo a campo antes y después del movimiento de schema.

    python tools/canary.py seed --schema platform --prefix ai_
    python tools/canary.py verify --schema ai --prefix ""
    python tools/canary.py clean --schema ai --prefix ""

`verify` imprime una huella determinista de las 7 filas. Si la huella coincide
antes y después del ALTER ... SET SCHEMA, los datos y las relaciones sobrevivieron.

Sobre el `noqa: S608` de todo el archivo: el schema y el prefijo se interpolan en
el SQL a propósito, porque el cometido del script es consultar LA MISMA fila en
dos ubicaciones distintas —`platform.ai_projects` y `ai.projects`— y un
identificador no puede ser un parámetro enlazado en PostgreSQL. Los valores vienen
de la línea de comandos de quien ejecuta la migración, no de entrada de usuario, y
el script no forma parte de la aplicación. Todo lo que sí es dato va enlazado.
"""

# ruff: noqa: S608

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).parent))

from admin_sql import _connection_kwargs

# UUIDs fijos: el testigo tiene que ser localizable después del movimiento, y una
# huella determinista exige que los identificadores no cambien entre ejecuciones.
IDS = {
    "project": "c0000000-0000-4000-8000-000000000001",
    "class": "c0000000-0000-4000-8000-000000000002",
    "asset": "c0000000-0000-4000-8000-000000000003",
    "image": "c0000000-0000-4000-8000-000000000004",
    "annotation": "c0000000-0000-4000-8000-000000000005",
    "dsv": "c0000000-0000-4000-8000-000000000006",
}
SHA_TESTIGO = "ca" + "0" * 62


async def _owner_id(c: asyncpg.Connection) -> str:
    row = await c.fetchval(
        "SELECT id FROM core.users WHERE email = 'arojas@ologistics.com' "
        "AND deleted_at IS NULL"
    )
    if row is None:
        sys.exit("no existe el usuario owner: no se puede sembrar el testigo")
    return row


async def seed(c: asyncpg.Connection, s: str, p: str) -> None:
    u = await _owner_id(c)

    # `base_model` y `task` existen ANTES de 0034 (donde base_model es NOT NULL) y
    # desaparecen después. El testigo tiene que poder sembrarse a los dos lados de
    # esa frontera, así que se detecta en lugar de asumirlo. Sin esto, el script
    # solo servía una vez y en un único punto de la secuencia.
    tiene_columnas_viejas = await c.fetchval(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        " WHERE table_schema = $1 AND table_name = $2 AND column_name = 'base_model')",
        s,
        f"{p}projects",
    )

    if tiene_columnas_viejas:
        await c.execute(
            f"INSERT INTO {s}.{p}projects "
            "(id, name, slug, description, base_model, task, status, created_by) "
            "VALUES ($1, 'Testigo 0033', 'testigo-0033', 'Conjunto testigo del movimiento', "
            "        'yolov8n', 'detect', 'draft', $2)",
            IDS["project"],
            u,
        )
    else:
        await c.execute(
            f"INSERT INTO {s}.{p}projects "
            "(id, name, slug, description, status, created_by) "
            "VALUES ($1, 'Testigo 0033', 'testigo-0033', 'Conjunto testigo del movimiento', "
            "        'draft', $2)",
            IDS["project"],
            u,
        )
    await c.execute(
        f"INSERT INTO {s}.{p}classes "
        "(id, project_id, name, class_index, color, description, created_by) "
        "VALUES ($1, $2, 'pallet-testigo', 7, '#ABCDEF', 'clase del testigo', $3)",
        IDS["class"],
        IDS["project"],
        u,
    )
    await c.execute(
        f"INSERT INTO {s}.{p}assets "
        "(id, project_id, kind, bucket, object_path, original_filename, content_type, "
        " bytes, sha256, width, height, created_by) "
        "VALUES ($1, $2, 'image', 'ai-source', 'testigo/0033.jpg', 'testigo.jpg', "
        "        'image/jpeg', 4096, $3, 1280, 720, $4)",
        IDS["asset"],
        IDS["project"],
        SHA_TESTIGO,
        u,
    )
    await c.execute(
        f"INSERT INTO {s}.{p}images "
        "(id, project_id, asset_id, source, status, created_by) "
        "VALUES ($1, $2, $3, 'upload', 'validated', $4)",
        IDS["image"],
        IDS["project"],
        IDS["asset"],
        u,
    )
    await c.execute(
        f"INSERT INTO {s}.{p}annotations "
        "(id, project_id, image_id, class_id, kind, cx, cy, w, h, origin, created_by) "
        "VALUES ($1, $2, $3, $4, 'bbox', 0.25, 0.75, 0.10, 0.20, 'human', $5)",
        IDS["annotation"],
        IDS["project"],
        IDS["image"],
        IDS["class"],
        u,
    )
    await c.execute(
        f"INSERT INTO {s}.{p}dataset_versions "
        "(id, project_id, version, name, class_snapshot, image_count, train_count, "
        " val_count, test_count, split_seed, created_by) "
        "VALUES ($1, $2, 1, 'testigo', $3::jsonb, 1, 1, 0, 0, 1234, $4)",
        IDS["dsv"],
        IDS["project"],
        json.dumps([{"index": 7, "name": "pallet-testigo"}]),
        u,
    )
    await c.execute(
        f"INSERT INTO {s}.{p}dataset_items "
        "(dataset_version_id, image_id, project_id, split) "
        "VALUES ($1, $2, $3, 'train')",
        IDS["dsv"],
        IDS["image"],
        IDS["project"],
    )
    print("testigo sembrado: 7 filas enlazadas por FK compuestas")


async def verify(c: asyncpg.Connection, s: str, p: str) -> None:
    """Huella determinista de las 7 filas, con sus enlaces resueltos por JOIN.

    Los JOIN son deliberados: si una FK compuesta se hubiera roto en el
    movimiento, el JOIN no devolvería fila y la huella cambiaría. Comparar solo
    columna a columna no probaría que las relaciones sobrevivieron.
    """
    row = await c.fetchrow(
        f"""
        SELECT pr.name, pr.slug, pr.status,
               cl.name AS clase, cl.class_index, cl.color,
               a.sha256, a.bytes, a.width, a.height, a.object_path,
               im.status AS img_status, im.source,
               an.kind, an.cx, an.cy, an.w, an.h, an.origin,
               dv.version, dv.class_snapshot::text AS snap, dv.split_seed,
               di.split
          FROM {s}.{p}projects        pr
          JOIN {s}.{p}classes         cl ON cl.project_id = pr.id
          JOIN {s}.{p}assets          a  ON a.project_id  = pr.id
          JOIN {s}.{p}images          im ON im.project_id = pr.id AND im.asset_id = a.id
          JOIN {s}.{p}annotations     an ON an.image_id = im.id AND an.class_id = cl.id
          JOIN {s}.{p}dataset_versions dv ON dv.project_id = pr.id
          JOIN {s}.{p}dataset_items   di ON di.dataset_version_id = dv.id
                                        AND di.image_id = im.id
         WHERE pr.id = $1
        """,
        IDS["project"],
    )
    if row is None:
        sys.exit("FALLO: el testigo no se encuentra o alguna FK compuesta se rompio")

    datos = {k: (str(v) if v is not None else None) for k, v in dict(row).items()}
    huella = hashlib.sha256(
        json.dumps(datos, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:32]

    print(f"testigo localizado en {s}.{p}* con las 7 FK resueltas")
    print(f"  clase={datos['clase']} idx={datos['class_index']} color={datos['color']}")
    print(f"  bbox=({datos['cx']},{datos['cy']},{datos['w']},{datos['h']}) kind={datos['kind']}")
    print(f"  dataset v{datos['version']} seed={datos['split_seed']} split={datos['split']}")
    print(f"  snapshot={datos['snap']}")
    print(f"HUELLA: {huella}")


async def clean(c: asyncpg.Connection, s: str, p: str) -> None:
    # Las tablas de dataset tienen trigger de inmutabilidad que aborta el DELETE.
    # Es correcto y aquí estorba: se desactiva solo para retirar el testigo.
    await c.execute(f"ALTER TABLE {s}.{p}dataset_items    DISABLE TRIGGER trg_dsi_inmutable")
    await c.execute(f"ALTER TABLE {s}.{p}dataset_versions DISABLE TRIGGER trg_dsv_inmutable")
    proj = IDS["project"]
    try:
        # Orden inverso al de la siembra: primero las hijas.
        for tabla in ("dataset_items", "dataset_versions", "annotations",
                      "images", "assets", "classes"):
            await c.execute(f"DELETE FROM {s}.{p}{tabla} WHERE project_id = $1", proj)
        await c.execute(f"DELETE FROM {s}.{p}projects WHERE id = $1", proj)
    finally:
        await c.execute(f"ALTER TABLE {s}.{p}dataset_versions ENABLE TRIGGER trg_dsv_inmutable")
        await c.execute(f"ALTER TABLE {s}.{p}dataset_items    ENABLE TRIGGER trg_dsi_inmutable")
    print("testigo retirado; triggers de inmutabilidad reactivados")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("accion", choices=["seed", "verify", "clean"])
    ap.add_argument("--schema", required=True)
    ap.add_argument("--prefix", default="")
    args = ap.parse_args()

    conn = await asyncpg.connect(**_connection_kwargs())  # type: ignore[arg-type]
    try:
        fn = {"seed": seed, "verify": verify, "clean": clean}[args.accion]
        await fn(conn, args.schema, args.prefix)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
