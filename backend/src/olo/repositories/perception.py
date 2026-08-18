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

#  El vocabulario de «que es un codigo» vive en el dominio: el worker lo usa para decidir
#  y esta consulta para diagnosticar el mismo analisis. Dos copias medirian distinto.
from olo.domain.perception.resolucion import CLASES_DE_CODIGO

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
    "media_total_frames, media_source, media_stream_url, media_available, event_count, "
    "media_has_preview, "
    "archived_at"
)

_DET_COLS = (
    "id, job_id, observed_at, ingested_at, frame_number, frame_ms, frame_ref, "
    "class_name, ai_class_id, class_color, confidence, "
    "bbox_x, bbox_y, bbox_width, bbox_height, bbox_format, "
    "text_value, crop_path, state, rack_node_id, review_status, reviewed_at, review_comment, "
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
                    # El `WHERE` del ON CONFLICT tiene que COINCIDIR con el del
                    # índice, y 0078 lo hizo PARCIAL —`WHERE sha256 IS NOT NULL`—
                    # para que dos directos no colisionaran entre sí. Sin
                    # repetirlo aquí, PostgreSQL no encuentra ningún índice que
                    # case y responde «there is no unique or exclusion constraint
                    # matching the ON CONFLICT specification»: un 500 que rompió la
                    # subida de ARCHIVOS al añadir los directos.
                    "ON CONFLICT (tenant_id, warehouse_id, sha256) "
                    "  WHERE sha256 IS NOT NULL DO UPDATE SET "
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

        ── EL TOPE NO ES UN DETALLE: SIN EL, EL ANALISIS SE CAE ──────────────────

        `chk_job_frames` (0069) exige `frames_processed <= frames_total`, y los dos numeros
        vienen de sitios distintos: `frames_total` lo ESTIMA el backend al crear el trabajo
        —duracion por muestreo— y el worker cuenta los fotogramas que de verdad decodifica.
        Nunca coinciden exactamente: el redondeo del paso de muestreo sobra o falta uno.

        Medido en `dataset7`: llego a 147 de 147 y el siguiente aviso intento poner 148. La
        base lo rechazo con un 422 y el worker, que estaba a punto de terminar bien, marco el
        trabajo como FALLIDO. Un contador de progreso tumbo un analisis de 455 detecciones.

        `LEAST` lo acota. Que el progreso se quede clavado en el total un instante antes de
        terminar es cosmetico; perder el analisis no lo es. Y `mark_completed` fija el valor
        exacto al cerrar, asi que el numero final sigue siendo correcto.
        """
        r: Any = await self._session.execute(
            text(
                "UPDATE perception.inference_jobs "
                "   SET frames_processed = CASE "
                "         WHEN frames_total IS NULL THEN frames_processed + :fr "
                "         ELSE LEAST(frames_total, frames_processed + :fr) END, "
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
                    # ── VOLVER A LA COLA PONE LOS CONTADORES A CERO ─────────────
                    #
                    # Sin esto, un reintento arranca con la barra al 100 %. Medido en
                    # `dataset7`: fallo con 147 de 147, se reencolo, y mientras analizaba
                    # el fotograma 6 de 148 la pantalla seguia diciendo 147 de 147 — el
                    # contador acumula y nadie lo habia reiniciado.
                    #
                    # Y no es solo cosmetico: con el tope de `bump_frames` el contador se
                    # queda clavado ahi, asi que el avance del reintento NO SE VE en
                    # absoluto. Toda la narracion de «Analizando: N de M» que existe para
                    # que nadie dude de si el sistema esta trabajando queda inservible en
                    # el caso en que mas falta hace: cuando algo ya fallo una vez.
                    #
                    # Las detecciones tambien: el worker manda su primer lote con
                    # `replace`, que borra las de la pasada anterior, asi que dejar el
                    # recuento viejo lo dejaria descuadrado hasta ese momento.
                    "  frames_processed = CASE WHEN CAST(:to AS varchar) = 'queued' "
                    "                          THEN 0 "
                    "                          ELSE COALESCE(:procesados, frames_processed) END, "
                    "  detection_count = CASE WHEN CAST(:to AS varchar) = 'queued' "
                    "                         THEN 0 "
                    "                         ELSE COALESCE(:detecciones, detection_count) END, "
                    "  elapsed_ms = CASE WHEN CAST(:to AS varchar) = 'queued' "
                    "                    THEN 0 ELSE COALESCE(:elapsed, elapsed_ms) END, "
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
        incluir_archivadas: bool = False,
    ) -> list[dict[str, Any]]:
        """Los trabajos, lo más reciente primero.

        Las ARCHIVADAS quedan fuera por defecto: se archivan justamente para sacarlas
        de la vista, y una lista que las siguiera mostrando no serviría de nada. No se
        pierden — `incluir_archivadas` las trae y la pantalla dice cuántas hay.

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
        if not incluir_archivadas:
            clausulas.append("archived_at IS NULL")
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
                " text_value, crop_path, is_manual, created_by) "
                "SELECT CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:jid AS uuid), "
                "       t.observed_at, t.frame_number, t.frame_ms, t.frame_ref, "
                "       t.class_name, t.class_color, t.confidence, "
                "       t.bbox_x, t.bbox_y, t.bbox_w, t.bbox_h, t.bbox_format, "
                "       t.text_value, t.crop_path, t.is_manual, core.current_user_id() "
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
                "       CAST(:recortes AS text[]), "
                "       CAST(:manuales AS boolean[])"
                "     ) AS t(observed_at, frame_number, frame_ms, frame_ref, class_name, "
                "            class_color, confidence, bbox_x, bbox_y, bbox_w, bbox_h, "
                "            bbox_format, text_value, crop_path, is_manual) "
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
                #  El recorte del fotograma (0091). `None` cuando el worker no lo
                #  guardo: analisis viejos, o la casilla desactivada.
                "recortes": [i.get("crop_path") for i in items],
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

    async def resolve_location_codes(
        self, *, warehouse_id: UUID, codes: Sequence[str]
    ) -> dict[str, dict[str, str]]:
        """Códigos de HUECO completos → el hueco y su rack, para los que existen.

        ── POR QUE ESTO HACIA FALTA ──────────────────────────────────────────────

        `resolve_rack_codes` solo casa códigos de RACK —`RCL47`—, así que una lectura
        completa como `RCL47-C018-N01-2` nunca resolvía y la pantalla decía «sin detectar»
        aunque el código estuviera leído y fuera correcto. Y lo era: los 29.310 huecos del
        catálogo llevan su `full_code` de cuatro niveles, así que la lectura de un QR de
        ubicación apunta a un hueco concreto sin ambigüedad.

        Se devuelven las DOS cosas —el hueco y su rack— porque cada una sirve para algo
        distinto: la observación espacial se ata al rack, que es lo que el modelo de 0067
        admite, y el id del hueco es lo que permite a la pantalla abrir el alzado en esa
        celda exacta.

        Una sola consulta con `= ANY`, como en `resolve_rack_codes`: resolver 300 lecturas
        de una en una serían 300 viajes a la base.
        """
        if not codes:
            return {}
        filas = (
            await self._session.execute(
                text(
                    "SELECT full_code, location_id, rack_id "
                    "  FROM spatial.rack_front_view "
                    " WHERE warehouse_id = CAST(:wh AS uuid) "
                    "   AND full_code = ANY(CAST(:codigos AS text[]))"
                ),
                {"wh": str(warehouse_id), "codigos": list(set(codes))},
            )
        ).mappings().all()
        return {
            f["full_code"]: {
                "location_id": str(f["location_id"]),
                "rack_id": str(f["rack_id"]),
            }
            for f in filas
        }

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
                    "SELECT model_version_id, model_id, version, origin, "
                    "       published_at, name, slug, task, input_type, "
                    "       architecture_code, architecture_name, framework_code, "
                    "       classes, "
                    #  Los PESOS. Sin ellos el worker no puede usar el modelo
                    #  entrenado: cae al RF-DETR preentrenado de COCO y avisa de que
                    #  «lo que salga NO es del modelo del proyecto». Medido en el
                    #  primer arranque real del worker — analizó con un detector
                    #  genérico que no conoce lo que hay en un almacén.
                    #
                    #  La vista los expone desde 0070; esta consulta simplemente no los
                    #  pedía. Publicar `object_path` no abre nada: el bucket
                    #  `ai-assets` exige platform owner en sus cuatro políticas (0045),
                    #  así que la ruta sin firma no sirve para descargar.
                    "       weights_asset_id, weights_object_path, "
                    #  El PROYECTO de IA al que pertenece. Hace falta para
                    #  mandar fotogramas de una inspeccion a su dataset: las
                    #  imagenes se cuelgan de un proyecto, y sin esto la
                    #  pantalla de Vision no sabe de cual.
                    "       project_id AS ai_project_id "
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
                "   pallet_confidence, bbox, observed_at, frame_ms, "
                #  Los tres recortes (0091): la prueba de cada eje, con la ruta de la
                #  deteccion que decidio. Ver `Lectura` en el dominio.
                "   crop_location_path, crop_content_path, crop_pallet_path) "
                "SELECT CAST(:tid AS uuid), CAST(:sid AS uuid), CAST(:wh AS uuid), "
                "       l.id, "
                "       d.location_qr, d.location_code_observed, d.location_confidence, "
                "       d.content, d.content_confidence, "
                "       d.pallet_qr, d.pallet_code_observed, d.pallet_confidence, "
                "       d.bbox, d.observed_at, d.frame_ms, "
                "       d.crop_loc, d.crop_cont, d.crop_pal "
                "  FROM unnest("
                "         CAST(:codigos AS varchar[]), CAST(:lqr AS varchar[]), "
                "         CAST(:lconf AS real[]), CAST(:cont AS varchar[]), "
                "         CAST(:cconf AS real[]), CAST(:pqr AS varchar[]), "
                "         CAST(:pcod AS varchar[]), CAST(:pconf AS real[]), "
                "         CAST(:bboxes AS jsonb[]), CAST(:obs AS timestamptz[]), "
                "         CAST(:fms AS integer[]), CAST(:crop_loc AS text[]), "
                "         CAST(:crop_cont AS text[]), CAST(:crop_pal AS text[])"
                "       ) AS d(location_code_observed, location_qr, location_confidence, "
                "              content, content_confidence, pallet_qr, "
                "              pallet_code_observed, pallet_confidence, bbox, observed_at, "
                "              frame_ms, crop_loc, crop_cont, crop_pal) "
                "  LEFT JOIN spatial.locations l "
                "         ON l.warehouse_id = CAST(:wh AS uuid) "
                "        AND upper(l.code) = upper(d.location_code_observed)"
            ),
            {
                "tid": str(tenant_id),
                "sid": str(scan_id),
                "wh": str(warehouse_id),
                "fms": [f.get("frame_ms") for f in filas],
                "crop_loc": [f.get("crop_location_path") for f in filas],
                "crop_cont": [f.get("crop_content_path") for f in filas],
                "crop_pal": [f.get("crop_pallet_path") for f in filas],
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
                    #  `location_id` viaja aunque el contrato de la pantalla no lo pinte:
                    #  es lo que permite abrir una incidencia atada al hueco de verdad y no
                    #  solo a un codigo escrito. Un codigo se puede leer mal; el id no.
                    "SELECT location_id, location_code, location_qr, content, pallet_qr, "
                    "       pallet_code_observed, expected_rows, expected_pallet, "
                    #  La LISTA, no solo el unico. `expected_pallet` se rellena unicamente
                    #  cuando el WMS declara UNA linea; con dos o mas venia a NULL y la
                    #  pantalla decia «2 linea(s)» sin nombrar ninguna. Eso deja al operador
                    #  sin lo unico que necesita para resolver: contra que codigos comparar el
                    #  que tiene delante. Medido en `RCL47-C018-N01-2`, que declara dos.
                    "       COALESCE(expected_pallets, '{}') AS expected_pallets, "
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

    async def scan(self, scan_id: UUID) -> dict[str, Any] | None:
        """Los datos del recorrido: de que almacen es y contra que corte se comparo.

        Hace falta para abrir incidencias desde una reconciliacion: la incidencia se cuelga
        del almacen y guarda de que corte del WMS salio la discrepancia. Sin eso, una
        incidencia de hace un mes no se puede leer —«el WMS decia otra cosa» depende de QUE
        foto del WMS se estaba mirando—.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, warehouse_id, wms_snapshot_id, started_at, notes "
                    "  FROM inventory.scans WHERE id = CAST(:sid AS uuid) "
                    "   AND deleted_at IS NULL"
                ),
                {"sid": str(scan_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

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

    # ══════════════════════════════════════════════════════════════════════
    # BORRAR Y ARCHIVAR
    #
    # Son dos operaciones distintas y la diferencia importa: borrar libera Storage
    # —el motivo de que esto exista— y archivar conserva lo que cuelga de la
    # inspección. Cuál toca lo decide `enlaces`, no quien pulsa el botón.
    # ══════════════════════════════════════════════════════════════════════
    async def enlaces(self, job_id: UUID) -> dict[str, int]:
        """Qué cuelga de esta inspección: incidencias, promovidas y revisadas.

        Sale de `perception.enlaces_de_trabajo` (0087) y no de tres consultas aquí:
        así la regla vive en un solo sitio y RLS se aplica igual, sin que este archivo
        tenga que acordarse de filtrar por almacén.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT incidencias, promovidas, revisadas "
                    "  FROM perception.enlaces_de_trabajo(CAST(:jid AS uuid))"
                ),
                {"jid": str(job_id)},
            )
        ).mappings().one()
        return {k: int(v) for k, v in dict(fila).items()}

    async def archivar(self, job_id: UUID, *, actor: UUID | None) -> int:
        """Marca la inspección como archivada. Idempotente.

        `archived_at IS NULL` en el WHERE: archivar dos veces no debe mover la fecha,
        o el registro diría que se archivó cuando en realidad solo se volvió a pulsar.
        """
        res = await self._session.execute(
            text(
                "UPDATE perception.inference_jobs "
                "   SET archived_at = now(), archived_by = CAST(:by AS uuid) "
                " WHERE id = CAST(:jid AS uuid) AND archived_at IS NULL"
            ),
            {"jid": str(job_id), "by": str(actor) if actor else None},
        )
        return res.rowcount or 0

    async def desarchivar(self, job_id: UUID) -> int:
        res = await self._session.execute(
            text(
                "UPDATE perception.inference_jobs "
                "   SET archived_at = NULL, archived_by = NULL "
                " WHERE id = CAST(:jid AS uuid) AND archived_at IS NOT NULL"
            ),
            {"jid": str(job_id)},
        )
        return res.rowcount or 0

    async def fijar_total_de_fotogramas(
        self, media_id: UUID, total: int, *, ancho: int | None = None, alto: int | None = None
    ) -> int:
        """Guarda el recuento REAL de fotogramas del medio. Devuelve las filas tocadas.

        ── POR QUE NO LO SABIA NADIE HASTA AHORA ─────────────────────────────────

        Al subir un video el navegador conoce su duracion y sus medidas, pero NO cuantos
        fotogramas tiene: no hay API que lo diga. Asi que `total_frames` quedaba nulo, y
        con el nulo se perdia la cadencia real del material.

        Eso se notaba al mandar fotogramas a anotar: sin fotogramas por segundo, el numero
        de fotograma habia que derivarlo a 25 fps por convencion, y para un video de 59,7
        fps decia 151 donde el fotograma de verdad era el 360.

        El worker si lo sabe —los recorre todos para analizarlos—, y este es el unico sitio
        del sistema donde el dato existe de primera mano.

        ── SOLO SE ESCRIBE SI FALTABA O SI CAMBIA ────────────────────────────────

        El `WHERE` con el `IS DISTINCT FROM` no es un adorno: sin el, cada analisis del
        mismo video escribiria la misma cifra otra vez y dejaria una entrada de auditoria
        por analisis diciendo que nada cambio. `perception.media` esta vigilada desde 0088.
        """
        stmt = text(
            "UPDATE perception.media "
            "   SET total_frames = :total, "
            #  Las medidas SOLO rellenan huecos: `COALESCE` deja intacto lo que el
            #  navegador anoto bien. El worker es la fuente de ultimo recurso, no la
            #  autoridad — y pisar un dato correcto con otro correcto solo genera una
            #  entrada de auditoria por analisis.
            "       width  = COALESCE(width,  :ancho), "
            "       height = COALESCE(height, :alto), "
            "       updated_at = now() "
            " WHERE id = CAST(:mid AS uuid) "
            "   AND deleted_at IS NULL "
            "   AND (total_frames IS DISTINCT FROM :total "
            "        OR (width IS NULL AND CAST(:ancho AS int) IS NOT NULL) "
            "        OR (height IS NULL AND CAST(:alto AS int) IS NOT NULL))"
        )
        res = await self._session.execute(
            stmt, {"mid": str(media_id), "total": total, "ancho": ancho, "alto": alto}
        )
        return res.rowcount or 0

    async def fijar_total_del_trabajo(self, job_id: UUID, total: int) -> int:
        """Corrige cuantos fotogramas va a analizar ESTE trabajo. Devuelve filas tocadas.

        ── DE DONDE VIENE ESTO: UN TRABAJO QUE DECIA «1 DE 1» ────────────────────

        `frames_total` lo estima el backend al crear el trabajo con la duracion que le
        mando el navegador. Cuando el navegador NO puede decodificar el video —H.265, por
        ejemplo— devuelve ceros, la duracion y el recuento quedan nulos y la estimacion
        cae a 1: un video de 634 fotogramas queda anunciado como si tuviera uno.

        Y entonces `bump_frames` acota con `LEAST(frames_total, ...)`, asi que el progreso
        se clava en 1. Medido en `DJI_20260308105811_0008_D`: el trabajo decia «1 de 1» y a
        la vez habia guardado 545 detecciones repartidas en 203 fotogramas distintos. El
        analisis estaba bien; el contador mentia, y quien lo miraba no tenia forma de saber
        cual de las dos cosas creer.

        El worker si lo sabe —acaba de decodificar el video entero para muestrearlo— y lo
        manda junto al recuento del medio. Este metodo es donde ese dato aterriza.

        ── EL `GREATEST` PROTEGE EL CHECK ────────────────────────────────────────

        `chk_job_frames` (0069) exige `frames_processed <= frames_total`. Si un reanalisis
        mandara un total menor que lo ya procesado, la escritura violaria el CHECK y
        tumbaria un analisis por un contador — el fallo que `bump_frames` documenta—. Con
        `GREATEST` el total nunca baja por debajo de lo hecho.

        Solo mientras el trabajo esta en marcha: reescribir el total de uno terminado
        cambiaria un resultado cerrado.
        """
        r: Any = await self._session.execute(
            text(
                "UPDATE perception.inference_jobs "
                "   SET frames_total = GREATEST(:total, frames_processed), "
                "       updated_by = core.current_user_id() "
                " WHERE id = CAST(:jid AS uuid) "
                "   AND status IN ('queued', 'running') "
                "   AND frames_total IS DISTINCT FROM GREATEST(:total, frames_processed)"
            ),
            {"jid": str(job_id), "total": total},
        )
        return int(r.rowcount or 0)

    async def resumen_de_etiquetas(self, job_id: UUID) -> dict[str, Any]:
        """Cuantas etiquetas de codigo dio un trabajo, cuantas se leyeron y cuanto miden.

        ── EN PIXELES, QUE ES LO UNICO QUE EXPLICA ALGO ──────────────────────────

        Las cajas se guardan normalizadas —0 a 1 sobre el fotograma— para que sobrevivan a
        un reescalado del video. Pero un 0,052 no dice nada a nadie: multiplicado por los
        3.840 px del fotograma son 199, y 199 es el numero que explica por que ese
        analisis no leyo ni un codigo.

        Por eso la conversion se hace aqui, contra `media.width`. Si el ancho no se sabe
        —el navegador no pudo decodificar y el worker aun no lo anoto— se devuelve la
        mediana en nulo en vez de inventar un ancho por convencion: un diagnostico sobre
        un ancho supuesto es peor que no dar diagnostico.

        ── Y LA MEDIANA, NO LA MEDIA ────────────────────────────────────────────

        Un pallet en primer plano deja una etiqueta enorme; con la media, dos de esas
        describen un material mejor del que es y el aviso no sale.
        """
        stmt = text(
            "SELECT count(*)::int AS etiquetas, "
            "       count(*) FILTER (WHERE d.text_value IS NOT NULL "
            "                          AND d.text_value <> '')::int AS leidas, "
            "       percentile_cont(0.5) WITHIN GROUP "
            "           (ORDER BY d.bbox_width * m.width) AS ancho_mediano "
            "  FROM perception.detections d "
            "  JOIN perception.inference_jobs j ON j.id = d.job_id "
            "  JOIN perception.media m ON m.id = j.media_id "
            " WHERE d.job_id = CAST(:jid AS uuid) "
            #  El CAST no es adorno: sin el, asyncpg no sabe de que tipo es el array y la
            #  comparacion no casa con NINGUNA fila. Medido: 0 donde hay 162, y sin error.
            "   AND d.class_name = ANY(CAST(:clases AS text[]))"
        )
        fila = (
            await self._session.execute(
                stmt, {"jid": str(job_id), "clases": list(CLASES_DE_CODIGO)}
            )
        ).mappings().first()
        return dict(fila) if fila else {"etiquetas": 0, "leidas": 0, "ancho_mediano": None}

    async def fijar_copia_para_ver(self, media_id: UUID, ruta: str) -> int:
        """Anota donde quedo la copia ligera. Devuelve las filas tocadas.

        `IS DISTINCT FROM` por lo mismo que el recuento de fotogramas: la ruta es
        determinista, asi que reanalizar el mismo video escribiria la misma cadena otra
        vez y dejaria una entrada de auditoria por analisis diciendo que nada cambio.
        `perception.media` esta vigilada desde 0088.
        """
        r: Any = await self._session.execute(
            text(
                "UPDATE perception.media "
                "   SET preview_path = :ruta, updated_at = now() "
                " WHERE id = CAST(:mid AS uuid) "
                "   AND deleted_at IS NULL "
                "   AND preview_path IS DISTINCT FROM :ruta"
            ),
            {"mid": str(media_id), "ruta": ruta},
        )
        return int(r.rowcount or 0)

    async def copia_para_ver(self, job_id: UUID) -> tuple[str, str] | None:
        """`(bucket, ruta)` de la copia ligera de un trabajo, o `None` si no hay."""
        fila = (
            await self._session.execute(
                text(
                    "SELECT m.bucket, m.preview_path "
                    "  FROM perception.inference_jobs j "
                    "  JOIN perception.media m ON m.id = j.media_id "
                    " WHERE j.id = CAST(:jid AS uuid) AND m.preview_path IS NOT NULL"
                ),
                {"jid": str(job_id)},
            )
        ).first()
        return (str(fila[0]), str(fila[1])) if fila else None

    async def otros_trabajos_del_medio(self, media_id: UUID, excepto: UUID) -> int:
        """Cuántas OTRAS inspecciones usan este mismo medio.

        ── POR QUE ESTO EXISTE ───────────────────────────────────────────────────

        `uq_media_hash` deduplica por `(tenant, almacén, sha256)`: subir dos veces el
        mismo archivo REUTILIZA la fila de medio. O sea que un medio puede respaldar
        varias inspecciones, y borrar su objeto de Storage dejaría a las otras sin
        bytes — sin que nadie lo notara hasta intentar reproducirlas.

        Hoy no hay ninguna compartida —se comprobó— pero el camino existe, y este
        recuento es lo que decide si el objeto se borra o solo se suelta la inspección.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*) AS n FROM perception.inference_jobs "
                    " WHERE media_id = CAST(:mid AS uuid) AND id <> CAST(:jid AS uuid)"
                ),
                {"mid": str(media_id), "jid": str(excepto)},
            )
        ).mappings().one()
        return int(fila["n"])

    async def borrar_trabajo(self, job_id: UUID) -> int:
        """Borra la inspección. Sus detecciones y eventos se van en cascada.

        El MEDIO no se toca aquí: puede estar compartido, y quién lo borra lo decide
        el servicio con `otros_trabajos_del_medio`.
        """
        res = await self._session.execute(
            text("DELETE FROM perception.inference_jobs WHERE id = CAST(:jid AS uuid)"),
            {"jid": str(job_id)},
        )
        return res.rowcount or 0

    async def borrar_medio(self, media_id: UUID) -> int:
        res = await self._session.execute(
            text("DELETE FROM perception.media WHERE id = CAST(:mid AS uuid)"),
            {"mid": str(media_id)},
        )
        return res.rowcount or 0
