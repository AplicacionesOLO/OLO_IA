"""Congelar una versión de dataset y exportarla en formato YOLO.

─────────────────────────────────────────────────────────────────────────────
EL PUNTO MAS DELICADO: class_index NO ES EL INDICE QUE VE YOLO

El proyecto numera sus clases con `class_index`, que es INMUTABLE y **no se
reutiliza**: si se retira la clase 1 de cinco, quedan 0, 2, 3, 4.

YOLO no admite huecos. `data.yaml` declara `names` como un mapa índice→nombre y el
framework asume `nc = len(names)` con índices contiguos `0..N-1`. Exportar los
`class_index` tal cual con un hueco produce uno de estos dos resultados, los dos
silenciosos:

  · el framework interpreta `nc = 5` con la clase 1 vacía y entrena una salida que
    nunca se activa, degradando las demás;
  · o reindexa por su cuenta y entonces la clase 2 del proyecto se convierte en la 1
    del modelo, de modo que el modelo entrenado devuelve la etiqueta EQUIVOCADA sin
    error alguno.

Así que el export REMAPEA: ordena el snapshot por `class_index` y usa la POSICIÓN
como índice de entrenamiento. Y devuelve el mapa `class_index → training_index` en la
respuesta, porque es lo que hará falta para interpretar los pesos después.

─────────────────────────────────────────────────────────────────────────────
EL EXPORT ES UN MANIFIESTO, NO UN ZIP

Los binarios viven en Storage y **no pasan por el backend** — es la misma decisión
que en la subida, y por el mismo motivo: un ZIP de 5.000 fotos serían gigabytes
atravesando la API y un tiempo de respuesta que ningún proxy aguanta.

El manifiesto trae `data.yaml`, el contenido de cada `.txt` de etiquetas y una URL
firmada por imagen. Un script corto lo materializa en disco. Las URLs caducan en
15 minutos: para 17 imágenes es de sobra, para 5.000 el script tiene que empezar
pronto — y eso es preferible a un enlace eterno a material de entrenamiento.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.domain.ai.dataset import (
    ClaseCongelada,
    contar,
    repartir,
    validar_congelable,
)
from olo.domain.warehouse import DomainRuleError
from olo.repositories.ai.dataset import DatasetVersionRepository
from olo.repositories.ai.klass import ClassRepository
from olo.repositories.ai.project import ProjectRepository

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings
    from olo.domain.ai.dataset import DatasetVersion


class AiDatasetService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = DatasetVersionRepository(session)
        self._clases = ClassRepository(session)
        self._proyectos = ProjectRepository(session)

    # ── Lectura ───────────────────────────────────────────────────────────────
    async def list_versions(self, project_id: UUID) -> Sequence[DatasetVersion]:
        if not await self._proyectos.exists(project_id):
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))
        return await self._repo.list_for_project(project_id)

    async def preview(self, project_id: UUID) -> dict[str, Any]:
        """Qué entraría si se congelara ahora. NO escribe nada.

        Existe para que el operador vea el reparto ANTES de crear algo inmutable. Sin
        esto, la única forma de saber cuántas imágenes hay listas sería congelar una
        versión que luego no se puede borrar.
        """
        if not await self._proyectos.exists(project_id):
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))

        candidatas = await self._repo.candidatas(project_id)
        activas = [c for c in await self._clases.list_for_project(project_id) if c.usable]

        aptas = [c for c in candidatas if c.status in {"annotated", "validated"}]
        con_cajas = sum(1 for c in aptas if c.annotation_count > 0)

        return {
            "total_images": len(candidatas),
            "eligible": len(aptas),
            "with_annotations": con_cajas,
            "annotations": sum(c.annotation_count for c in aptas),
            "by_status": {
                estado: sum(1 for c in candidatas if c.status == estado)
                for estado in sorted({c.status for c in candidatas})
            },
            "active_classes": len(activas),
            "next_version": await self._repo.siguiente_version(project_id),
            # Si esto es `false`, congelar fallará. Se dice antes para que el botón
            # pueda estar deshabilitado con su motivo, en lugar de dar un 422.
            "can_freeze": bool(activas) and con_cajas > 0,
        }

    # ── Escritura ─────────────────────────────────────────────────────────────
    async def freeze(
        self,
        project_id: UUID,
        *,
        name: str | None,
        notes: str | None,
        seed: int,
        proporciones: tuple[float, float, float],
        created_by: UUID,
    ) -> DatasetVersion:
        if not await self._proyectos.exists(project_id):
            raise NotFoundError("Proyecto no encontrado", resource_id=str(project_id))

        # El lock ANTES de leer el número de versión, en la misma transacción que el
        # INSERT: dos congelados simultáneos leerían el mismo máximo y uno violaría
        # `uq_dsv_version`.
        await self._repo.lock_project(project_id)

        candidatas = await self._repo.candidatas(project_id)
        clases = [
            ClaseCongelada(index=c.class_index, name=c.name)
            for c in await self._clases.list_for_project(project_id)
            if c.usable
        ]

        try:
            aptas = validar_congelable(candidatas, clases)
            reparto = repartir(
                [c.id for c in aptas], seed=seed, proporciones=proporciones
            )
        except DomainRuleError as exc:
            raise BusinessRuleError(str(exc)) from exc

        return await self._repo.freeze(
            project_id,
            version=await self._repo.siguiente_version(project_id),
            name=name,
            notes=notes,
            # Ordenado por índice: es el orden que define el remapeo del export, y
            # guardarlo ya ordenado evita que dos lecturas den mapas distintos.
            class_snapshot=sorted(clases, key=lambda c: c.index),
            reparto=reparto,
            counts=contar(reparto),
            split_seed=seed,
            created_by=created_by,
        )

    # ── Exportación ───────────────────────────────────────────────────────────
    async def export_yolo(
        self, project_id: UUID, version_id: UUID, *, settings: Settings, ttl: int
    ) -> dict[str, Any]:
        """Manifiesto listo para materializar en disco y entrenar.

        Ver la cabecera del módulo para las dos decisiones: el remapeo a índices
        contiguos y por qué esto es un manifiesto y no un ZIP.
        """
        versiones = await self._repo.list_for_project(project_id)
        version = next((v for v in versiones if v.id == version_id), None)
        if version is None:
            raise NotFoundError(
                "Versión de dataset no encontrada", resource_id=str(version_id)
            )

        # EL REMAPEO. Posición en el snapshot ordenado = índice de entrenamiento.
        orden = sorted(version.class_snapshot, key=lambda c: c.index)
        a_training = {c.index: i for i, c in enumerate(orden)}

        filas = await self._repo.export_rows(version_id)

        # Una entrada por imagen; las cajas se acumulan. Las imágenes sin cajas
        # aparecen con `label` vacío, que es lo que YOLO espera de un negativo.
        por_imagen: dict[str, dict[str, Any]] = {}
        for f in filas:
            clave = str(f["image_id"])
            entrada = por_imagen.setdefault(
                clave,
                {
                    "image_id": clave,
                    "asset_id": str(f["asset_id"]),
                    "split": f["split"],
                    "filename": _nombre(f),
                    "object_path": f["object_path"],
                    "boxes": [],
                },
            )
            if f["cx"] is None:
                continue
            ti = a_training.get(int(f["class_index"]))
            if ti is None:
                # La clase existe pero NO estaba en el snapshot: se creó después de
                # congelar. Se omite en lugar de inventarle un índice, porque
                # asignarle uno cambiaría el significado de los pesos.
                continue
            entrada["boxes"].append(
                f"{ti} {float(f['cx']):.6f} {float(f['cy']):.6f} "
                f"{float(f['w']):.6f} {float(f['h']):.6f}"
            )

        items = []
        for e in por_imagen.values():
            items.append(
                {
                    "image_id": e["image_id"],
                    "asset_id": e["asset_id"],
                    "split": e["split"],
                    "filename": e["filename"],
                    "label": "\n".join(e["boxes"]),
                    "box_count": len(e["boxes"]),
                    "object_path": e["object_path"],
                }
            )

        nombres = "\n".join(f"  {i}: {c.name}" for i, c in enumerate(orden))
        data_yaml = (
            "# Generado por OLO_IA. NO editar a mano: el mapa de clases procede de\n"
            f"# la version {version.version} del dataset, que es inmutable.\n"
            "path: .\n"
            "train: images/train\n"
            "val: images/val\n"
            + ("test: images/test\n" if version.test_count > 0 else "")
            + f"nc: {len(orden)}\n"
            "names:\n" + nombres + "\n"
        )

        return {
            "version": version.version,
            "version_id": str(version.id),
            "image_count": version.image_count,
            "train_count": version.train_count,
            "val_count": version.val_count,
            "test_count": version.test_count,
            "split_seed": version.split_seed,
            "data_yaml": data_yaml,
            # El mapa se devuelve explícito: sin él no se puede interpretar un modelo
            # entrenado con este export si el proyecto tiene huecos en `class_index`.
            "class_map": [
                {"training_index": i, "class_index": c.index, "name": c.name}
                for i, c in enumerate(orden)
            ],
            "items": items,
            "signed_url_ttl": ttl,
            "bucket": settings.ai_assets_bucket
            if hasattr(settings, "ai_assets_bucket")
            else "ai-assets",
        }


def _nombre(fila: Any) -> str:
    """Nombre de archivo para el disco.

    Se usa el `object_path` y no el `original_filename`: dos fotos distintas pueden
    llamarse `IMG_0042.jpeg` y al materializar el dataset una sobrescribiría a la
    otra, dejando una imagen con las etiquetas de la otra. La ruta de Storage es
    única por construcción.
    """
    ruta = str(fila["object_path"] or "")
    base = ruta.rsplit("/", 1)[-1] if ruta else str(fila["image_id"])
    return base or str(fila["image_id"])
