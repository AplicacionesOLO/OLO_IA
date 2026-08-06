"""Repositorio de trabajos de inferencia y detecciones (0069).

Como el resto de repositorios, NO añade `WHERE tenant_id = ...`: lo hace RLS. Sí
pasa `tenant_id` en los INSERT porque la columna es `NOT NULL` y la policy lo
comprueba con `WITH CHECK`.

── EL ESTADO NO SE ESCRIBE A MANO ───────────────────────────────────────────

`update_status` es la ÚNICA forma de mover un trabajo, y no comprueba la transición:
la comprueba el disparador de 0069, que tiene la misma tabla que `stateMachine.ts`.
Un `UPDATE ... SET status = 'completed'` desde `queued` levanta una excepción de la
base, no un estado imposible en la pantalla.

Tampoco escribe el historial: lo escribe el mismo disparador. Si dependiera de que
este archivo se acuerde de insertar la fila, el historial tendría huecos justo en
los caminos menos recorridos —los fallos—.

── LAS DETECCIONES ENTRAN EN UNA SENTENCIA ──────────────────────────────────

Un vídeo de 5 minutos a 5 fps con 20 detecciones por fotograma son 30.000 filas.
Insertarlas de una en una serían 30.000 idas y vueltas al pooler: con 260 ms de
latencia medidos, dos horas. Con `unnest`, una sentencia.

── POR QUÉ LAS LECTURAS DE DETECCIONES SIEMPRE LLEVAN VENTANA ───────────────

La tabla está particionada por mes sobre `observed_at`. Una consulta sin acotar el
tiempo tiene que abrir las 25 particiones; con la ventana, PostgreSQL descarta las
que no tocan. Por eso `list_detections` filtra por `job_id` —que acota al vídeo— y
acepta rango: no es una comodidad de la API, es lo que hace que el particionado
sirva para algo.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

# `UUID` en tiempo de EJECUCIÓN y no en el bloque de abajo: `ultimo_corte_wms` y
# `crear_scan` lo CONSTRUYEN a partir de lo que devuelve la base, no solo lo anotan.
# Dejarlo en `TYPE_CHECKING` daría `NameError` al llamarlos.
from uuid import UUID

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

_MEDIA_COLS = (
    "id, warehouse_id, kind, original_filename, content_type, bytes, sha256, "
    "bucket, object_path, width, height, duration_ms, total_frames, source, "
    "created_at"
)

# De la vista, que ya trae el medio incorporado. La pantalla necesita las dos cosas
# en la misma respuesta: un listado que muestre el nombre del archivo y pida el
# medio aparte haría una petición por fila.
_JOB_COLS = (
    "id, warehouse_id, name, status, pipeline, model_version_id, model_label, "
    "confidence_threshold, frame_sampling_rate, save_detected_frames, notes, "
    "frames_processed, frames_total, detection_count, elapsed_ms, error_message, "
    "queued_at, started_at, completed_at, created_at, "
    "media_id, media_kind, media_filename, media_content_type, media_bytes, "
    "media_sha256, media_width, media_height, media_duration_ms, "
    "media_total_frames, media_source, media_stream_url, media_available, event_count"
)

_DET_COLS = (
    "id, job_id, observed_at, ingested_at, frame_number, frame_ms, frame_ref, "
    "class_name, ai_class_id, class_color, confidence, "
    "bbox_x, bbox_y, bbox_width, bbox_height, bbox_format, "
    "text_value, state, rack_node_id, review_status, reviewed_at, review_comment, "
    "supersedes_id, is_manual"
)

_EVENT_COLS = "id, from_status, to_status, occurred_at, reason"


class PerceptionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Medios ─────────────────────────────────────────────────────────────
    async def upsert_media(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        kind: str,
        original_filename: str,
        content_type: str,
        byte_count: int,
        sha256: str,
        width: int | None,
        height: int | None,
        duration_ms: int | None,
        total_frames: int | None,
        source: str,
        bucket: str | None = None,
        object_path: str | None = None,
    ) -> dict[str, Any]:
        """Registra el medio, o devuelve el que ya existe con ese hash.

        `ON CONFLICT` sobre `(tenant_id, warehouse_id, sha256)`: subir el mismo
        vídeo dos veces es lo que pasa cuando la conexión se corta, y crear una
        segunda fila dejaría dos medios idénticos con trabajos repartidos entre los
        dos. El nombre del archivo SÍ se actualiza —alguien puede renombrarlo— pero
        los bytes son los mismos, así que el hash manda.

        `bucket` y `object_path` llegan desde 0076, cuando los bytes SÍ se subieron.
        Siguen siendo opcionales: un medio registrado solo por metadatos es un estado
        legítimo —el que había antes de que existiera la subida— y el worker lo
        distingue porque no puede descargarlo.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO perception.media "  # noqa: S608
                    "(tenant_id, warehouse_id, kind, original_filename, content_type, "
                    " bytes, sha256, width, height, duration_ms, total_frames, source, "
                    " bucket, object_path, created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :kind, :fname, "
                    "        :ctype, :bytes, :sha, :w, :h, :dur, :frames, :src, "
                    "        :bucket, :path, "
                    "        core.current_user_id(), core.current_user_id()) "
                    "ON CONFLICT (tenant_id, warehouse_id, sha256) DO UPDATE SET "
                    "  original_filename = EXCLUDED.original_filename, "
                    "  deleted_at = NULL, "
                    # COALESCE y no EXCLUDED: si la fila YA tenía bytes, se conservan
                    # los suyos. Mismo `sha256` significa mismos bytes, así que el
                    # objeto viejo vale igual, y sobrescribir la ruta dejaría el
                    # anterior huérfano en el bucket ocupando espacio sin referencia.
                    #
                    # Efecto asumido: al resubir un vídeo ya conocido, el objeto recién
                    # subido queda sin referenciar. Es preferible a perder de vista el
                    # que ya funcionaba.
                    "  bucket = COALESCE(perception.media.bucket, EXCLUDED.bucket), "
                    "  object_path = COALESCE(perception.media.object_path, "
                    "                         EXCLUDED.object_path), "
                    "  updated_by = core.current_user_id() "
                    f"RETURNING {_MEDIA_COLS}"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "kind": kind,
                    "fname": original_filename,
                    "ctype": content_type,
                    "bytes": byte_count,
                    "sha": sha256,
                    "w": width,
                    "h": height,
                    "dur": duration_ms,
                    "frames": total_frames,
                    "src": source,
                    "bucket": bucket,
                    "path": object_path,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def media_de_trabajo(self, job_id: UUID) -> dict[str, Any] | None:
        """El medio de un trabajo, con dónde están sus bytes.

        Lo pide el worker para descargar el vídeo. Se consulta por el TRABAJO y no por
        el medio: el worker conoce el trabajo que le toca, y hacerle resolver el
        `media_id` primero sería una ida y vuelta más para llegar al mismo sitio.
        """
        fila = (
            await self._session.execute(
                text(
                    f"SELECT m.{', m.'.join(_MEDIA_COLS.split(', '))} "  # noqa: S608
                    "  FROM perception.media m "
                    "  JOIN perception.inference_jobs j ON j.media_id = m.id "
                    " WHERE j.id = CAST(:jid AS uuid)"
                ),
                {"jid": str(job_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def upsert_stream(
        self, *, tenant_id: UUID, warehouse_id: UUID, stream_url: str, nombre: str
    ) -> dict[str, Any]:
        """Registra el directo, o devuelve el que ya hay sobre esa URL.

        `ON CONFLICT` sobre el indice parcial `uq_media_stream_vivo` de 0078: dos
        sesiones simultaneas sobre la MISMA camara serian dos workers leyendo el mismo
        stream y duplicando cada deteccion.

        Sin `sha256` y con `bytes = 0`: un directo no tiene contenido que hashear ni
        tamano que medir. El CHECK `chk_media_identidad` lo ata al tipo, asi que esos
        valores no se pueden confundir con un archivo corrupto.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO perception.media "  # noqa: S608
                    "  (tenant_id, warehouse_id, kind, original_filename, content_type, "
                    "   bytes, sha256, stream_url, source, created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), 'stream', :nombre, "
                    "        'video/x-flv', 0, NULL, :url, 'uploaded-file', "
                    "        core.current_user_id(), core.current_user_id()) "
                    "ON CONFLICT (tenant_id, warehouse_id, stream_url) "
                    "  WHERE kind = 'stream' AND deleted_at IS NULL "
                    "DO UPDATE SET original_filename = EXCLUDED.original_filename, "
                    "              updated_by = core.current_user_id() "
                    f"RETURNING {_MEDIA_COLS}, stream_url"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "url": stream_url,
                    "nombre": nombre[:500],
                },
            )
        ).mappings().one()
        return dict(fila)

    async def directo_activo(self, media_id: UUID) -> dict[str, Any] | None:
        """Un trabajo VIVO sobre ese medio, si lo hay.

        Vivo = `queued` o `running`. El indice unico de 0078 protege el MEDIO, no el
        trabajo: dos sesiones sobre la misma camara comparten fila de medio y crean dos
        trabajos, y entonces dos workers leen el mismo stream y duplican cada deteccion.

        Esto es lo que de verdad impide eso. Lo pillo la prueba: el endpoint decia
        responder 409 y aceptaba la segunda sesion.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, name, status FROM perception.inference_jobs "
                    " WHERE media_id = CAST(:mid AS uuid) "
                    "   AND status IN ('queued', 'running') "
                    " ORDER BY created_at DESC LIMIT 1"
                ),
                {"mid": str(media_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def bump_frames(self, job_id: UUID, *, procesados: int, detecciones: int) -> int:
        """Suma el progreso de un directo sin tocar su estado.

        SUMA en vez de fijar: el worker manda lo del ultimo lote, no el acumulado, asi
        que fijarlo perderia todo lo anterior cada vez. Y no pasa por `update_status`
        porque un directo NO cambia de estado al progresar: sigue `running` hasta que
        alguien lo para.
        """
        r: Any = await self._session.execute(
            text(
                "UPDATE perception.inference_jobs "
                "   SET frames_processed = frames_processed + :fr, "
                "       detection_count = detection_count + :det, "
                "       updated_by = core.current_user_id() "
                " WHERE id = CAST(:jid AS uuid) AND status = 'running'"
            ),
            {"jid": str(job_id), "fr": procesados, "det": detecciones},
        )
        return int(r.rowcount or 0)

    # ── Trabajos ───────────────────────────────────────────────────────────
    async def create_job(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        media_id: UUID,
        name: str,
        pipeline: str,
        model_version_id: UUID | None,
        model_label: str | None,
        confidence_threshold: float,
        frame_sampling_rate: float | None,
        save_detected_frames: bool,
        notes: str | None,
        #  = directo: no se sabe cuantos fotogramas son. Ver 0078.
        frames_total: int | None,
    ) -> dict[str, Any]:
        """Crea el trabajo en `draft`.

        Nace en `draft` y llega a su estado real con `update_status`, uno a uno. Es
        más largo que insertar `status = 'queued'` de entrada, y es lo que hace que
        el historial explique el estado: un trabajo que aparece en la cola sin haber
        pasado por `uploaded` tiene un historial que no cuadra con su fila.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO perception.inference_jobs "
                    "(tenant_id, warehouse_id, media_id, name, status, pipeline, "
                    " model_version_id, model_label, confidence_threshold, "
                    " frame_sampling_rate, save_detected_frames, notes, frames_total, "
                    " created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:mid AS uuid), "
                    "        :name, 'draft', :pipe, CAST(:mv AS uuid), :label, :umbral, "
                    "        :fps, :guardar, :notas, :frames, "
                    "        core.current_user_id(), core.current_user_id()) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "mid": str(media_id),
                    "name": name,
                    "pipe": pipeline,
                    "mv": str(model_version_id) if model_version_id else None,
                    "label": model_label,
                    "umbral": confidence_threshold,
                    "fps": frame_sampling_rate,
                    "guardar": save_detected_frames,
                    "notas": notes,
                    "frames": frames_total,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def update_status(
        self,
        *,
        job_id: UUID,
        to_status: str,
        error_message: str | None = None,
        frames_processed: int | None = None,
        detection_count: int | None = None,
        elapsed_ms: int | None = None,
    ) -> dict[str, Any] | None:
        """Mueve el estado. La transición la valida el disparador de 0069.

        Las marcas de tiempo se ponen aquí y no en el disparador porque dependen de
        a DÓNDE va: `queued_at` al entrar en la cola, `started_at` al empezar a
        correr, `completed_at` en los tres estados terminales. Y `error_message` se
        LIMPIA cuando el destino no es `failed`: el CHECK de 0069 lo exige, y sin
        eso un reintento arrastraría el motivo del fallo anterior.
        """
        # `:to` va CASTEADO en cada aparición, y no es decoración.
        #
        # Sin el cast, PostgreSQL deduce un tipo distinto en cada sitio donde
        # aparece el mismo parámetro: `varchar` al asignarlo a la columna y `text`
        # al compararlo con un literal. El servidor rechaza la sentencia entera con
        # `AmbiguousParameterError: inconsistent types deduced for parameter $1 ·
        # text versus character varying`, y como la sentencia ni se prepara, el
        # trabajo se queda en `draft` con un 500 opaco delante de quien lo creó.
        fila = (
            await self._session.execute(
                text(
                    "UPDATE perception.inference_jobs SET "
                    "  status = CAST(:to AS varchar), "
                    "  error_message = CASE WHEN CAST(:to AS varchar) = 'failed' "
                    "                       THEN :err ELSE NULL END, "
                    "  frames_processed = COALESCE(:procesados, frames_processed), "
                    "  detection_count = COALESCE(:detecciones, detection_count), "
                    "  elapsed_ms = COALESCE(:elapsed, elapsed_ms), "
                    "  queued_at = CASE WHEN CAST(:to AS varchar) = 'queued' "
                    "                   THEN now() ELSE queued_at END, "
                    # `started_at` se LIMPIA al volver a la cola, y sin esto ningún
                    # reintento funciona nunca.
                    #
                    # Medido: un trabajo que llegó a `running` y falló guarda
                    # `started_at = T2`. Al reencolarlo, `queued_at` pasa a ser `now()`
                    # = T3 > T2, y el CHECK `chk_job_orden_tiempos` de 0069 —que exige
                    # `started_at >= queued_at`— rechaza la fila. El 422 dice
                    # «CONSTRAINT_VIOLATION» sin nombrar la columna, y el trigger de
                    # transiciones SÍ permite `failed -> queued`, así que todo apunta a
                    # que el reintento debería ir.
                    #
                    # Y es lo correcto semánticamente: `started_at` es cuándo empezó a
                    # correr ESTE intento. Un trabajo de vuelta en la cola todavía no ha
                    # empezado, así que arrastrar la hora del intento anterior haría que
                    # la pantalla dijera «lleva 3 días corriendo» de algo que espera.
                    "  started_at = CASE "
                    "      WHEN CAST(:to AS varchar) = 'running' THEN now() "
                    "      WHEN CAST(:to AS varchar) = 'queued'  THEN NULL "
                    "      ELSE started_at END, "
                    "  completed_at = CASE "
                    "      WHEN CAST(:to AS varchar) IN ('completed', 'failed', 'cancelled') "
                    "      THEN now() ELSE NULL END, "
                    "  updated_by = core.current_user_id() "
                    "WHERE id = CAST(:jid AS uuid) "
                    "RETURNING id, status"
                ),
                {
                    "jid": str(job_id),
                    "to": to_status,
                    "err": error_message,
                    "procesados": frames_processed,
                    "detecciones": detection_count,
                    "elapsed": elapsed_ms,
                },
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def get_job(self, job_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_JOB_COLS} FROM perception.v_inference_jobs "  # noqa: S608
                    "WHERE id = CAST(:jid AS uuid)"
                ),
                {"jid": str(job_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def list_jobs(
        self,
        *,
        warehouse_id: UUID | None,
        status: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Los trabajos, lo más reciente primero.

        `warehouse_id` opcional: la pantalla de percepción es del tenant, no de un
        almacén —un operador con varios almacenes quiere ver sus análisis juntos—.
        RLS ya acota a los almacenes que puede ver, así que «todos» significa
        «todos los suyos» y no «todos los del sistema».
        """
        clausulas = []
        params: dict[str, Any] = {"limite": limit}
        if warehouse_id is not None:
            clausulas.append("warehouse_id = CAST(:wh AS uuid)")
            params["wh"] = str(warehouse_id)
        if status is not None:
            clausulas.append("status = :estado")
            params["estado"] = status
        donde = f"WHERE {' AND '.join(clausulas)} " if clausulas else ""

        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_JOB_COLS} FROM perception.v_inference_jobs "  # noqa: S608
                    f"{donde}"
                    "ORDER BY created_at DESC LIMIT :limite"
                ),
                params,
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def list_events(self, job_id: UUID) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_EVENT_COLS} FROM perception.job_events "  # noqa: S608
                    "WHERE job_id = CAST(:jid AS uuid) ORDER BY occurred_at, id"
                ),
                {"jid": str(job_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ── Detecciones ────────────────────────────────────────────────────────
    async def insert_detections(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        job_id: UUID,
        items: Sequence[dict[str, Any]],
    ) -> int:
        """Inserta el lote en UNA sentencia y devuelve cuántas entraron.

        Sin `ON CONFLICT`: a diferencia de las observaciones de 0067, dos
        detecciones del mismo fotograma con el mismo recuadro SON dos detecciones
        —dos objetos solapados existen—, así que no hay clave natural que deduplicar.
        La idempotencia de la ingesta es del TRABAJO: se reintenta reprocesando, y
        para eso está `delete_detections`.
        """
        if not items:
            return 0
        res = await self._session.execute(
            text(
                "INSERT INTO perception.detections "
                "(tenant_id, warehouse_id, job_id, observed_at, frame_number, frame_ms, "
                " frame_ref, class_name, class_color, confidence, "
                " bbox_x, bbox_y, bbox_width, bbox_height, bbox_format, "
                " text_value, is_manual, created_by) "
                "SELECT CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:jid AS uuid), "
                "       t.observed_at, t.frame_number, t.frame_ms, t.frame_ref, "
                "       t.class_name, t.class_color, t.confidence, "
                "       t.bbox_x, t.bbox_y, t.bbox_w, t.bbox_h, t.bbox_format, "
                "       t.text_value, t.is_manual, core.current_user_id() "
                "FROM unnest("
                "       CAST(:momentos AS timestamptz[]), "
                "       CAST(:frames AS integer[]), "
                "       CAST(:frame_ms AS integer[]), "
                "       CAST(:refs AS text[]), "
                "       CAST(:clases AS varchar[]), "
                "       CAST(:colores AS char(7)[]), "
                "       CAST(:confianzas AS double precision[]), "
                "       CAST(:xs AS double precision[]), "
                "       CAST(:ys AS double precision[]), "
                "       CAST(:ws AS double precision[]), "
                "       CAST(:hs AS double precision[]), "
                "       CAST(:formatos AS varchar[]), "
                "       CAST(:textos AS varchar[]), "
                "       CAST(:manuales AS boolean[])"
                "     ) AS t(observed_at, frame_number, frame_ms, frame_ref, class_name, "
                "            class_color, confidence, bbox_x, bbox_y, bbox_w, bbox_h, "
                "            bbox_format, text_value, is_manual) "
                "RETURNING id"
            ),
            {
                "tid": str(tenant_id),
                "wh": str(warehouse_id),
                "jid": str(job_id),
                "momentos": [i["observed_at"] for i in items],
                "frames": [i.get("frame_number", 0) for i in items],
                "frame_ms": [i.get("frame_ms") for i in items],
                "refs": [i.get("frame_ref") for i in items],
                "clases": [i["class_name"] for i in items],
                "colores": [i.get("class_color") for i in items],
                "confianzas": [i["confidence"] for i in items],
                "xs": [i["bbox_x"] for i in items],
                "ys": [i["bbox_y"] for i in items],
                "ws": [i["bbox_width"] for i in items],
                "hs": [i["bbox_height"] for i in items],
                "formatos": [i.get("bbox_format", "normalized") for i in items],
                "textos": [i.get("text_value") for i in items],
                "manuales": [i.get("is_manual", False) for i in items],
            },
        )
        return len(res.fetchall())

    async def delete_detections(self, job_id: UUID) -> int:
        """Borra las detecciones de un trabajo. Es lo que permite reprocesar.

        NO borra las observaciones ya promovidas a `spatial.rack_observations`: esas
        son un hecho de 0067 y sobreviven. Si el reproceso produce las mismas, la
        unicidad de 0067 las absorbe sin duplicar.
        """
        res = await self._session.execute(
            text("DELETE FROM perception.detections WHERE job_id = CAST(:jid AS uuid)"),
            {"jid": str(job_id)},
        )
        return res.rowcount or 0

    async def list_detections(
        self,
        *,
        job_id: UUID,
        class_name: str | None = None,
        min_confidence: float | None = None,
        review_status: str | None = None,
        state: str | None = None,
        frame_start: int | None = None,
        frame_end: int | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """Página de detecciones y TOTAL de las que cumplen el filtro.

        El total sale de la misma consulta con `count(*) OVER ()`: pedirlo aparte
        serían dos viajes al pooler para responder una pantalla, y con 260 ms
        medidos eso es medio segundo de reloj que se nota al paginar.
        """
        clausulas = ["job_id = CAST(:jid AS uuid)"]
        params: dict[str, Any] = {"jid": str(job_id), "off": offset, "lim": limit}
        if class_name is not None:
            clausulas.append("class_name = :clase")
            params["clase"] = class_name
        if min_confidence is not None:
            clausulas.append("confidence >= :minconf")
            params["minconf"] = min_confidence
        if review_status is not None:
            clausulas.append("review_status = :revision")
            params["revision"] = review_status
        if state is not None:
            clausulas.append("state = :estado")
            params["estado"] = state
        if frame_start is not None:
            clausulas.append("frame_number >= :f0")
            params["f0"] = frame_start
        if frame_end is not None:
            clausulas.append("frame_number <= :f1")
            params["f1"] = frame_end

        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_DET_COLS}, count(*) OVER () AS total "  # noqa: S608
                    "FROM perception.detections "
                    f"WHERE {' AND '.join(clausulas)} "
                    "ORDER BY frame_number, observed_at, id "
                    "OFFSET :off LIMIT :lim"
                ),
                params,
            )
        ).mappings().all()
        if not filas:
            return [], 0
        total = int(filas[0]["total"])
        return [{k: v for k, v in dict(f).items() if k != "total"} for f in filas], total

    async def frame_detections(
        self, *, job_id: UUID, frame_number: int
    ) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_DET_COLS} FROM perception.detections "  # noqa: S608
                    "WHERE job_id = CAST(:jid AS uuid) AND frame_number = :frame "
                    "ORDER BY confidence DESC, id"
                ),
                {"jid": str(job_id), "frame": frame_number},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def class_counts(self, job_id: UUID) -> list[dict[str, Any]]:
        """Cuántas detecciones por clase. Es el resumen de un trabajo."""
        filas = (
            await self._session.execute(
                text(
                    "SELECT class_name, count(*) AS n, "
                    "       avg(confidence) AS confianza_media, "
                    "       sum(CASE WHEN state = 'matched' THEN 1 ELSE 0 END) AS casadas "
                    "FROM perception.detections "
                    "WHERE job_id = CAST(:jid AS uuid) "
                    "GROUP BY class_name ORDER BY n DESC"
                ),
                {"jid": str(job_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ── Revisión ───────────────────────────────────────────────────────────
    async def mark_review(
        self,
        *,
        detection_id: UUID,
        observed_at: datetime,
        review_status: str,
        comment: str | None,
        new_state: str | None = None,
    ) -> bool:
        """Marca la revisión de UNA detección.

        Lleva `observed_at` porque la clave es `(observed_at, id)`: sin él,
        PostgreSQL tendría que buscar el id en las 25 particiones. No es burocracia
        del esquema —es lo que evita que revisar una detección recorra dos años de
        histórico—.

        `new_state` permite pasarla a `discarded` en el mismo UPDATE. Un falso
        positivo revisado es a la vez «alguien lo miró» y «no vale», y separarlo en
        dos sentencias dejaría un hueco en el que está revisado y aún cuenta.
        """
        res = await self._session.execute(
            text(
                "UPDATE perception.detections SET "
                "  review_status = :revision, "
                "  review_comment = :comentario, "
                "  reviewed_at = now(), "
                "  reviewed_by = core.current_user_id(), "
                "  state = COALESCE(:estado, state) "
                "WHERE id = CAST(:did AS uuid) AND observed_at = :momento"
            ),
            {
                "did": str(detection_id),
                "momento": observed_at,
                "revision": review_status,
                "comentario": comment,
                "estado": new_state,
            },
        )
        return (res.rowcount or 0) > 0

    # ── El puente con 0067 ─────────────────────────────────────────────────
    async def resolve_rack_codes(
        self, *, warehouse_id: UUID, codes: Sequence[str]
    ) -> dict[str, str]:
        """Códigos de rack → uuid del nodo, para los que existen.

        Una sola consulta con `= ANY`: resolver 300 códigos leídos uno a uno serían
        300 viajes. Los que no aparecen en el resultado son los que el catálogo no
        conoce, y esa ausencia es el dato —la detección se queda `unmatched`—.

        El `node_type = 'rack'` no sobra: un código puede coincidir con el de un
        cuerpo o una ubicación, y promover eso a «vi el rack X» sería resolver a un
        nodo que no es un rack.
        """
        if not codes:
            return {}
        filas = (
            await self._session.execute(
                text(
                    "SELECT node_code, id FROM spatial.nodes "
                    "WHERE warehouse_id = CAST(:wh AS uuid) "
                    "  AND node_type = 'rack' "
                    "  AND deleted_at IS NULL "
                    "  AND node_code = ANY(CAST(:codigos AS text[]))"
                ),
                {"wh": str(warehouse_id), "codigos": list(set(codes))},
            )
        ).mappings().all()
        return {f["node_code"]: str(f["id"]) for f in filas}

    async def mark_matched(
        self,
        *,
        job_id: UUID,
        pares: Sequence[tuple[UUID, Any, str]],
    ) -> int:
        """Marca como `matched` las detecciones que se resolvieron a un rack.

        `pares` es (id, observed_at, rack_node_id). Se actualiza en una sentencia con
        `unnest` y un JOIN sobre la clave completa: el CHECK de 0069 exige que
        `matched` y `rack_node_id` vayan juntos, así que las dos columnas se escriben
        a la vez o ninguna.
        """
        if not pares:
            return 0
        res = await self._session.execute(
            text(
                "UPDATE perception.detections d SET "
                "  state = 'matched', "
                "  rack_node_id = CAST(t.rack AS uuid) "
                "FROM unnest("
                "      CAST(:ids AS text[]), "
                "      CAST(:momentos AS timestamptz[]), "
                "      CAST(:racks AS text[])"
                "    ) AS t(id, momento, rack) "
                "WHERE d.id = CAST(t.id AS uuid) "
                "  AND d.observed_at = t.momento "
                "  AND d.job_id = CAST(:jid AS uuid)"
            ),
            {
                "jid": str(job_id),
                "ids": [str(p[0]) for p in pares],
                "momentos": [p[1] for p in pares],
                "racks": [str(p[2]) for p in pares],
            },
        )
        return res.rowcount or 0

    async def unmatched_texts(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    "SELECT text_value, lecturas, confianza_max, primera, ultima, trabajos "
                    "FROM perception.v_unmatched_texts "
                    "WHERE warehouse_id = CAST(:wh AS uuid) "
                    "ORDER BY lecturas DESC, text_value"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ── Modelos publicados ─────────────────────────────────────────────────
    async def published_models(self) -> list[dict[str, Any]]:
        """Las versiones de modelo PUBLICADAS, que es lo único que un tenant ve.

        Va contra `perception.v_published_models` (0070) y NO contra `ai` directo.
        La diferencia no es de estilo: `ai` es de régimen platform owner, y se midió
        que un `olo_app` con contexto de tenant ve CERO filas de las tres que hay.
        Consultar `ai.models` desde aquí habría devuelto lista vacía para siempre y
        la pantalla habría dicho «no hay ningún modelo publicado» con modelos
        publicados en la base.

        La vista atraviesa RLS a propósito y está acotada a `status = 'published'`.
        Ver la cabecera de 0070: el catálogo de la plataforma no tiene `tenant_id`,
        no es de nadie, y publicar es el acto explícito por el que se declara
        utilizable.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT model_version_id, model_id, version, origin, published_at, "
                    "       name, slug, task, input_type, architecture_code, "
                    "       architecture_name, framework_code, classes "
                    "FROM perception.v_published_models "
                    "ORDER BY name, version DESC"
                )
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    # ══════════════════════════════════════════════════════════════════════
    # EL PUENTE AL WMS (0064)
    #
    # `inventory.readings` no tenia ni una fila ni un escritor, y sin ellas
    # `v_reconciliation` —que es donde se compara lo observado con lo que el WMS
    # declara— no tenia nada que comparar. Esto es ese escritor.
    # ══════════════════════════════════════════════════════════════════════

    async def ultimo_corte_wms(self, warehouse_id: UUID) -> UUID | None:
        """El corte del WMS mas reciente de ese almacen, o `None`.

        Sin corte, una lectura se puede guardar pero NO se puede reconciliar: no hay
        «esperado» con el que contrastar. La columna es nullable por eso, y el servicio
        lo dice en la respuesta en vez de fallar.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT id FROM inventory.wms_snapshots "
                    " WHERE warehouse_id = CAST(:wh AS uuid) AND deleted_at IS NULL "
                    " ORDER BY taken_at DESC, received_at DESC LIMIT 1"
                ),
                {"wh": str(warehouse_id)},
            )
        ).first()
        return None if fila is None else UUID(str(fila[0]))

    async def crear_scan(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        wms_snapshot_id: UUID | None,
        model_version_id: UUID | None,
        source: str,
        notes: str | None,
    ) -> UUID:
        """Un recorrido. Nace `running` y se cierra al terminar de insertar lecturas."""
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO inventory.scans "
                    "  (tenant_id, warehouse_id, wms_snapshot_id, model_version_id, "
                    "   source, status, notes, created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), "
                    "        CAST(:snap AS uuid), CAST(:mv AS uuid), "
                    "        CAST(:src AS varchar), 'running', :notas, "
                    "        core.current_user_id(), core.current_user_id()) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "snap": str(wms_snapshot_id) if wms_snapshot_id else None,
                    "mv": str(model_version_id) if model_version_id else None,
                    "src": source,
                    "notas": notes,
                },
            )
        ).one()
        return UUID(str(fila[0]))

    async def cerrar_scan(self, scan_id: UUID, *, estado: str) -> int:
        r: Any = await self._session.execute(
            text(
                "UPDATE inventory.scans "
                "   SET status = CAST(:est AS varchar), finished_at = now(), "
                "       updated_by = core.current_user_id(), version = version + 1 "
                " WHERE id = CAST(:sid AS uuid)"
            ),
            {"sid": str(scan_id), "est": estado},
        )
        return int(r.rowcount or 0)

    async def insertar_lecturas(
        self,
        *,
        tenant_id: UUID,
        warehouse_id: UUID,
        scan_id: UUID,
        filas: list[dict[str, Any]],
    ) -> int:
        """Las lecturas, en UNA sentencia con `unnest`.

        Un vuelo produce cientos de lecturas y con 260 ms de latencia al pooler, una
        sentencia por fila serian minutos de espera. Mismo motivo que el `unnest` de las
        detecciones en 0069.

        El `location_id` se resuelve AQUI, casando el codigo observado con el catalogo
        del almacen. Un codigo que no existe deja `location_id` a NULL —no se aproxima—
        y `v_reconciliation` lo clasifica como `location_qr_unreadable`: visible y sin
        afirmar nada sobre ningun hueco.
        """
        if not filas:
            return 0
        r: Any = await self._session.execute(
            text(
                "INSERT INTO inventory.readings "
                "  (tenant_id, scan_id, warehouse_id, location_id, location_qr, "
                "   location_code_observed, location_confidence, content, "
                "   content_confidence, pallet_qr, pallet_code_observed, "
                "   pallet_confidence, bbox, observed_at) "
                "SELECT CAST(:tid AS uuid), CAST(:sid AS uuid), CAST(:wh AS uuid), "
                "       l.id, "
                "       d.location_qr, d.location_code_observed, d.location_confidence, "
                "       d.content, d.content_confidence, "
                "       d.pallet_qr, d.pallet_code_observed, d.pallet_confidence, "
                "       d.bbox, d.observed_at "
                "  FROM unnest("
                "         CAST(:codigos AS varchar[]), CAST(:lqr AS varchar[]), "
                "         CAST(:lconf AS real[]), CAST(:cont AS varchar[]), "
                "         CAST(:cconf AS real[]), CAST(:pqr AS varchar[]), "
                "         CAST(:pcod AS varchar[]), CAST(:pconf AS real[]), "
                "         CAST(:bboxes AS jsonb[]), CAST(:obs AS timestamptz[])"
                "       ) AS d(location_code_observed, location_qr, location_confidence, "
                "              content, content_confidence, pallet_qr, "
                "              pallet_code_observed, pallet_confidence, bbox, observed_at) "
                "  LEFT JOIN spatial.locations l "
                "         ON l.warehouse_id = CAST(:wh AS uuid) "
                "        AND upper(l.code) = upper(d.location_code_observed)"
            ),
            {
                "tid": str(tenant_id),
                "sid": str(scan_id),
                "wh": str(warehouse_id),
                "codigos": [f["location_code_observed"] for f in filas],
                "lqr": [f["location_qr"] for f in filas],
                "lconf": [f["location_confidence"] for f in filas],
                "cont": [f["content"] for f in filas],
                "cconf": [f["content_confidence"] for f in filas],
                "pqr": [f["pallet_qr"] for f in filas],
                "pcod": [f["pallet_code_observed"] for f in filas],
                "pconf": [f["pallet_confidence"] for f in filas],
                "bboxes": [
                    json.dumps(f["bbox"]) if f.get("bbox") else None for f in filas
                ],
                "obs": [f["observed_at"] for f in filas],
            },
        )
        return int(r.rowcount or 0)

    async def reconciliacion(
        self, scan_id: UUID, limite: int = 500
    ) -> list[dict[str, Any]]:
        """El resultado: lo observado contra lo que el WMS declara.

        Va contra `inventory.v_reconciliation` (0064), que tiene `security_invoker`, asi
        que RLS filtra por almacen igual que en todo lo demas.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT location_code, location_qr, content, pallet_qr, "
                    "       pallet_code_observed, expected_rows, expected_pallet, "
                    "       wms_expects_pallet, status, observed_at "
                    "  FROM inventory.v_reconciliation "
                    " WHERE scan_id = CAST(:sid AS uuid) "
                    " ORDER BY location_code NULLS LAST "
                    " LIMIT :lim"
                ),
                {"sid": str(scan_id), "lim": limite},
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def resumen_reconciliacion(self, scan_id: UUID) -> list[dict[str, Any]]:
        """Cuantas lecturas hay de cada clase de discrepancia.

        Es la cifra que se ensena primero: «12 huecos donde el WMS espera pallet y no
        hay nada» dice mas que 500 filas.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT status, count(*) AS cuantas "
                    "  FROM inventory.v_reconciliation "
                    " WHERE scan_id = CAST(:sid AS uuid) "
                    " GROUP BY status ORDER BY 2 DESC"
                ),
                {"sid": str(scan_id)},
            )
        ).mappings()
        return [dict(f) for f in filas]
