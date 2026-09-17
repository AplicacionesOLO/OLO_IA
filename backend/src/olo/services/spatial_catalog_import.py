"""Servicio del importador del catálogo espacial, por API.

Hace exactamente lo que hace `tools/import_spatial_catalog.py` — mismo parser
(`spatial_catalog_parser`), mismas reglas, misma idempotencia en tres niveles —
pero disparado por un archivo subido en una petición HTTP en lugar de una ruta
de archivo en un terminal con credenciales de `postgres`.

── POR QUÉ ESTO NO CONTRADICE «no por API» ──────────────────────────────────

`spatial.py` dice que el catálogo no se escribe por API porque crear 29.310
ubicaciones una a una por HTTP no sería ni idempotente ni auditable. Este
endpoint no hace eso: sigue siendo UNA operación — un archivo, un lote, una
transacción — con el mismo `sha256`, el mismo `spatial.import_batches` y el
mismo `ON CONFLICT` por clave natural que el script. Lo único que cambia es
quién puede dispararla y con qué credenciales: `olo_app` con RLS, no
`postgres` sin él. El anti-patrón que el comentario original rechaza —un POST
por ubicación— sigue sin existir.

── IDEMPOTENCIA, en los mismos tres niveles que el script ──────────────────

  1. `sha256` del archivo en `import_batches`. Reimportar el mismo archivo se
     detecta antes de tocar una fila y responde `skipped_duplicate`, 200 y no
     un error: para quien sube el archivo dos veces por accidente eso es
     exactamente lo que esperaba que pasara.
  2. `ON CONFLICT` sobre la clave natural de cada entidad.
  3. El lote entero vive en la transacción de la petición: si algo falla a
     mitad, `tenant_session()` la revierte completa.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from io import BytesIO
from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.repositories.spatial_catalog_import import SpatialCatalogImportRepository
from olo.services.spatial_catalog_parser import (
    ESTADO_WMS,
    TECHO_PESO_KG,
    CabecerasInesperadasError,
    agregar,
    leer_catalogo,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

# ~25 MB: el catalogo real (29.310 filas, 20 columnas) pesa unos 3-4 MB como
# xlsx. El limite no es una suposicion sobre el tamano del almacen mas grande,
# es una cota de sanidad para no leer en memoria un archivo que no es esto.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Mismo tamano de lote que el script de terminal: 15 viajes de red para 29.310
# filas en lugar de 29.310.
LOTE_UBICACIONES = 2000


def _resumir_rechazos(rechazos: list[dict[str, Any]]) -> dict[str, Any]:
    conteo = Counter(r["motivo"] for r in rechazos)
    return {
        "by_reason": dict(conteo.most_common()),
        # Solo una muestra: con miles de rechazos, la respuesta HTTP no es el
        # sitio para devolverlos todos. `spatial.import_row_errors` los tiene
        # todos si hiciera falta auditarlos uno a uno.
        "sample": [
            {"row_number": r["fila"], "reason": r["motivo"], "field": r["campo"] or None}
            for r in rechazos[:20]
        ],
    }


class SpatialCatalogImportService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._session = session
        self._ctx = ctx
        self._repo = SpatialCatalogImportRepository(session)

    async def importar(
        self,
        warehouse_id: UUID,
        *,
        source_name: str,
        file_bytes: bytes,
        dry_run: bool,
        force: bool,
    ) -> dict[str, Any]:
        if len(file_bytes) > MAX_UPLOAD_BYTES:
            raise BusinessRuleError(
                f"El archivo pesa {len(file_bytes) / 1_048_576:.1f} MB; "
                f"el maximo es {MAX_UPLOAD_BYTES // 1_048_576} MB."
            )

        # 404 tambien si es de otro tenant: RLS ya filtra la fila, asi que
        # confirmar «no accesible» con un 403 seria una fuga por canal lateral.
        wh = await self._repo.warehouse_by_id(warehouse_id)
        if wh is None:
            raise NotFoundError(f"No existe el almacen {warehouse_id}")
        tenant_id, wid = UUID(str(wh["tenant_id"])), UUID(str(wh["id"]))

        sha = hashlib.sha256(file_bytes).hexdigest()

        try:
            filas, rechazos = leer_catalogo(BytesIO(file_bytes))
        except CabecerasInesperadasError as exc:
            raise BusinessRuleError(str(exc)) from exc

        refs, bays = agregar(filas)
        resumen = {
            "file_sha256": sha,
            "rows_read": len(filas),
            "rows_rejected": len(rechazos),
            "racks": len(refs),
            "bays": len(bays),
            "locations": len(filas),
            "rejections": _resumir_rechazos(rechazos),
        }

        if dry_run:
            return {"status": "dry_run", **resumen}

        # El techo del importador y el del motor tienen que ser EL MISMO
        # numero: si divergieron, mejor abortar aqui que a mitad del lote.
        techo_bd = await self._repo.capacity_ceiling("weight_kg")
        if techo_bd != TECHO_PESO_KG:
            raise BusinessRuleError(
                f"El techo de capacidad del importador ({TECHO_PESO_KG}) no "
                f"coincide con el del motor ({techo_bd}). Contacte a soporte "
                "antes de reintentar: importar asi anularia o aceptaria "
                "capacidades incorrectamente."
            )

        ya = await self._repo.already_completed(tenant_id, wid, sha)
        if ya and not force:
            return {"status": "skipped_duplicate", **resumen}
        if ya:
            await self._repo.retire_previous_completed(tenant_id, wid, sha)

        batch_id = await self._repo.create_batch(
            tenant_id=tenant_id,
            warehouse_id=wid,
            source_name=source_name,
            sha256=sha,
            rows_read=len(filas) + len(rechazos),
            rows_rejected=len(rechazos),
        )
        await self._repo.insert_rejections(batch_id, tenant_id, rechazos)

        site_id = await self._repo.upsert_site(
            tenant_id, wid, json.dumps({"created_by": "spatial_catalog_import_api"})
        )

        # ── 347 nodos principales ────────────────────────────────────────────
        orden = sorted(refs.items())
        await self._repo.upsert_rack_nodes(
            tenant_id=tenant_id,
            warehouse_id=wid,
            site_id=site_id,
            codes=[n for n, _ in orden],
            externos=[i["externo"] for _, i in orden],
            indices=[int(m.group(1)) if (m := re.search(r"(\d+)", n)) else None for n, _ in orden],
            preambulos=[i["preambulo"] for _, i in orden],
            storage_ids=[i["storage_id"] for _, i in orden],
            tipos_wms=[next(iter(sorted(i["tipos"])), None) for _, i in orden],
            raw_sources=[
                json.dumps(
                    {
                        "source": "ReporteUbicaciones",
                        "zonas": sorted(i["zonas"]),
                        "tipos_wms": sorted(i["tipos"]),
                        "columnas": len(i["cols"]),
                    }
                )
                for _, i in orden
            ],
        )
        mapa_ref = await self._repo.map_rack_nodes(wid)

        # ── 2.701 cuerpos ────────────────────────────────────────────────────
        pares = sorted(bays)
        await self._repo.upsert_bay_nodes(
            tenant_id=tenant_id,
            warehouse_id=wid,
            site_id=site_id,
            refs=[r for r, _ in pares],
            cols=[c for _, c in pares],
        )
        mapa_bay = await self._repo.map_bay_nodes(wid)

        # ── 29.310 ubicaciones, en lotes ─────────────────────────────────────
        insertadas = 0
        for i in range(0, len(filas), LOTE_UBICACIONES):
            t = filas[i : i + LOTE_UBICACIONES]
            await self._repo.upsert_locations_batch(
                tenant_id=tenant_id,
                warehouse_id=wid,
                node_ids=[mapa_bay[(mapa_ref[f["ref_norm"]], f["col"])] for f in t],
                codes=[f["code"] for f in t],
                external_codes=[f["external_code"] for f in t],
                external_location_ids=[f["external_location_id"] for f in t],
                formas=[f["forma"] for f in t],
                cols=[f["col"] for f in t],
                nivs=[f["niv"] for f in t],
                poss=[f["pos"] for f in t],
                lxs=[f["lx"] for f in t],
                lys=[f["ly"] for f in t],
                lzs=[f["lz"] for f in t],
                pesos=[f["peso_max"] for f in t],
                estados=[ESTADO_WMS.get(f["estado_wms"] or "", "available") for f in t],
                situaciones=[f["situacion"] for f in t],
                raw_sources=[
                    json.dumps(
                        {
                            k: v
                            for k, v in (
                                ("tipo_wms", f["tipo_wms"]),
                                ("estado_wms", f["estado_wms"]),
                                ("zona", f["zona"]),
                                ("preambulo", f["preambulo"]),
                                # Solo aparece cuando SE DESCARTO una capacidad:
                                # su presencia es la senal, igual que en 0058.
                                ("peso_max_crudo", f["peso_max_crudo"]),
                                (
                                    "capacidad_anulada_por",
                                    "implausible_importador" if f["peso_max_crudo"] else None,
                                ),
                            )
                            if v is not None
                        }
                    )
                    for f in t
                ],
            )
            insertadas += len(t)

        await self._repo.complete_batch(
            batch_id,
            nodes_created=len(mapa_ref),
            bays_created=len(mapa_bay),
            locations_created=insertadas,
        )

        # ── Verificacion DENTRO de la misma transaccion ─────────────────────
        verif = await self._repo.verify_counts(wid)
        if verif["n_world"]:
            raise RuntimeError("El importador no debe generar world_*")
        if verif["n_aisle"]:
            raise RuntimeError("El importador no debe inventar pasillos")

        return {
            "status": "completed",
            **resumen,
            "racks_created": len(mapa_ref),
            "bays_created": len(mapa_bay),
            "locations_created": insertadas,
        }

    async def historial(self, warehouse_id: UUID, *, limit: int = 20) -> list[dict[str, Any]]:
        wh = await self._repo.warehouse_by_id(warehouse_id)
        if wh is None:
            raise NotFoundError(f"No existe el almacen {warehouse_id}")
        return await self._repo.list_batches(warehouse_id, limit)
