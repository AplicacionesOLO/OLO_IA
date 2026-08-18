"""Endpoints de percepción: trabajos de inferencia, detecciones y el puente con 0067.

── LAS RUTAS SON LAS QUE EL FRONTEND YA ESPERABA ────────────────────────────

`frontend/src/modules/perception/repository.ts` llevaba escrita la lista de
endpoints «pendientes» desde que se escribió el módulo con datos falsos. Son estas,
con los mismos nombres:

    POST /v1/perception/jobs
    GET  /v1/perception/jobs
    GET  /v1/perception/jobs/{job_id}
    GET  /v1/perception/jobs/{job_id}/detections
    GET  /v1/perception/jobs/{job_id}/frames/{frame_number}
    POST /v1/perception/jobs/{job_id}/reviews
    GET  /v1/perception/models

Y tres que no estaban previstas y hacen falta:

    POST /v1/perception/jobs/{job_id}/status        mover el estado
    POST /v1/perception/jobs/{job_id}/detections    el extremo del WORKER
    POST /v1/perception/jobs/{job_id}/promote       detecciones → observaciones

── TRES PERMISOS, NO UNO ────────────────────────────────────────────────────

    perception:read     ver
    perception:write    crear, cancelar, revisar        una persona
    perception:ingest   depositar detecciones, avanzar  una máquina

Un worker que deja resultados no debe poder crear trabajos ni revisar los de otro;
un operario que crea trabajos no debe poder fabricar detecciones y hacerlas pasar
por salida del modelo. Con un permiso único de escritura, las dos cosas serían la
misma capacidad. Es la misma razón por la que 0067 separó `observations:write` de
`areas:write`: un dron que reporta no debe poder mover racks.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from olo.api.deps import AccessToken, AppSettings, CurrentContext, Db, require
from olo.api.v1.schemas import (
    DetectionIngestIn,
    DetectionIngestOut,
    DetectionPageOut,
    Envelope,
    FrameOut,
    JobCreateIn,
    JobDeletableOut,
    JobDeletedOut,
    JobListOut,
    JobOut,
    JobStatusIn,
    LiveProgressIn,
    LiveProgressOut,
    LiveStartIn,
    MediaDownloadOut,
    MediaFrameCountIn,
    MediaFrameCountOut,
    MediaPrepareIn,
    MediaPrepareOut,
    ModelCatalogOut,
    PromoteIn,
    PromoteOut,
    ReconcileIn,
    ReconcileIncidentsOut,
    ReconcileOut,
    ReviewIn,
    ReviewOut,
    UnmatchedReportOut,
    WorkerHeartbeatIn,
    WorkerListOut,
    WorkerOut,
)
from olo.repositories import identity
from olo.services.perception import PerceptionService

router = APIRouter(prefix="/perception", tags=["perception"])


@router.get(
    "/models",
    response_model=Envelope[ModelCatalogOut],
    dependencies=[require("perception:read")],
    summary="Modelos publicados que se pueden ejecutar, y si hay quien los ejecute",
)
async def list_models(db: Db, ctx: CurrentContext) -> Envelope[ModelCatalogOut]:
    """El catálogo sale de `perception.v_published_models` (0070), no de `ai`.

    Se midió: un `olo_app` con contexto de tenant ve CERO filas de `ai.models`
    —régimen platform owner— habiendo tres. Consultarlo directamente habría devuelto
    lista vacía para siempre y la pantalla habría dicho «no hay modelos publicados»
    con modelos publicados en la base.

    `worker_available` viene en la misma respuesta a propósito: elegir modelo sin
    saber si alguien lo va a correr es la mitad de la información que hace falta para
    decidir si merece la pena lanzar el análisis.
    """
    datos = await PerceptionService(db, ctx).models()
    return Envelope[ModelCatalogOut](data=ModelCatalogOut.model_validate(datos))


@router.post(
    "/jobs",
    response_model=Envelope[JobOut],
    status_code=201,
    dependencies=[require("perception:write")],
    summary="Crear un trabajo de inferencia sobre un medio",
)
async def create_job(
    cuerpo: JobCreateIn,
    db: Db,
    ctx: CurrentContext,
    settings: AppSettings,
    token: AccessToken,
) -> Envelope[JobOut]:
    """El trabajo nace en `draft` y llega hasta `uploaded`, paso a paso.

    NO se encola solo. Encolar consume el worker cuando exista, y hacerlo automático
    al subir quitaría el paso en el que el operador revisa el umbral y el modelo
    antes de gastar máquina.
    """
    datos = await PerceptionService(db, ctx, settings, token).create_job(
        warehouse_id=cuerpo.warehouse_id,
        name=cuerpo.name,
        media=cuerpo.media.model_dump(),
        pipeline=cuerpo.pipeline,
        model_version_id=cuerpo.model_version_id,
        confidence_threshold=cuerpo.confidence_threshold,
        frame_sampling_rate=cuerpo.frame_sampling_rate,
        save_detected_frames=cuerpo.save_detected_frames,
        notes=cuerpo.notes,
    )
    return Envelope[JobOut](data=JobOut.model_validate(datos))


@router.get(
    "/jobs",
    response_model=Envelope[JobListOut],
    dependencies=[require("perception:read")],
    summary="Trabajos de inferencia, lo más reciente primero",
)
async def list_jobs(
    db: Db,
    ctx: CurrentContext,
    warehouse_id: Annotated[UUID | None, Query(description="Acota a un almacén")] = None,
    status: Annotated[str | None, Query(description="Acota a un estado")] = None,
    include_archived: Annotated[
        bool, Query(description="Incluir las archivadas, fuera por defecto")
    ] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Envelope[JobListOut]:
    """`warehouse_id` es opcional, y no por comodidad.

    La pantalla de percepción es del tenant: un operador con varios almacenes quiere
    ver sus análisis juntos. RLS ya acota a los que puede ver, así que «todos»
    significa «todos los suyos».

    Las ARCHIVADAS quedan fuera por defecto: se archivan para sacarlas de en medio.
    `include_archived=true` las trae, porque esconderlas del todo seria perderlas.
    """
    datos = await PerceptionService(db, ctx).list_jobs(
        warehouse_id=warehouse_id,
        status=status,
        limit=limit,
        incluir_archivadas=include_archived,
    )
    return Envelope[JobListOut](data=JobListOut.model_validate(datos))


@router.get(
    "/jobs/{job_id}",
    response_model=Envelope[JobOut],
    dependencies=[require("perception:read")],
    summary="Un trabajo, con su historial de estados y su recuento por clase",
)
async def get_job(job_id: UUID, db: Db, ctx: CurrentContext) -> Envelope[JobOut]:
    """El historial viene de `perception.job_events`, escrito por disparador.

    El frontend lo CONSTRUÍA en el navegador al crear el trabajo. Un historial
    reconstruido dice lo que el código cree que pasó, no lo que pasó.
    """
    datos = await PerceptionService(db, ctx).get_job(job_id)
    return Envelope[JobOut](data=JobOut.model_validate(datos))


@router.post(
    "/jobs/{job_id}/status",
    response_model=Envelope[JobOut],
    dependencies=[require("perception:write")],
    summary="Encolar, cancelar o reintentar un trabajo",
)
async def change_status(
    job_id: UUID, cuerpo: JobStatusIn, db: Db, ctx: CurrentContext
) -> Envelope[JobOut]:
    """La transición la valida el disparador de 0069, con la misma tabla que
    `stateMachine.ts` del frontend.

    Aquí se traduce: el CHECK de la base da un error correcto y opaco, y quien pulsa
    «cancelar» en un trabajo ya completado merece leer por qué no se puede.
    """
    datos = await PerceptionService(db, ctx).change_status(
        job_id=job_id, to_status=cuerpo.to_status, reason=cuerpo.reason
    )
    return Envelope[JobOut](data=JobOut.model_validate(datos))


@router.post(
    "/jobs/{job_id}/detections",
    response_model=Envelope[DetectionIngestOut],
    dependencies=[require("perception:ingest")],
    summary="Depositar los resultados de la inferencia (extremo del worker)",
)
async def ingest_detections(
    job_id: UUID, cuerpo: DetectionIngestIn, db: Db, ctx: CurrentContext
) -> Envelope[DetectionIngestOut]:
    """El único endpoint con `perception:ingest`, y el único que crea detecciones.

    Rechaza el lote si trae detecciones por debajo del umbral que el propio trabajo
    declaró. Filtrarlas en silencio sería peor: el trabajo diría 200, el worker habría
    mandado 260, y nadie sabría dónde se fueron las 60.
    """
    datos = await PerceptionService(db, ctx).ingest_detections(
        job_id=job_id,
        items=[d.model_dump() for d in cuerpo.detections],
        replace=cuerpo.replace,
        mark_completed=cuerpo.mark_completed,
    )
    return Envelope[DetectionIngestOut](
        data=DetectionIngestOut.model_validate(datos)
    )


@router.get(
    "/jobs/{job_id}/detections",
    response_model=Envelope[DetectionPageOut],
    dependencies=[require("perception:read")],
    summary="Detecciones de un trabajo, paginadas y filtrables",
)
async def list_detections(
    job_id: UUID,
    db: Db,
    ctx: CurrentContext,
    class_name: Annotated[str | None, Query(description="Acota a una clase")] = None,
    min_confidence: Annotated[float | None, Query(ge=0, le=1)] = None,
    review_status: Annotated[str | None, Query(description="pending/accepted/…")] = None,
    state: Annotated[str | None, Query(description="unmatched/matched/…")] = None,
    frame_start: Annotated[int | None, Query(ge=0)] = None,
    frame_end: Annotated[int | None, Query(ge=0)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=500)] = 50,
) -> Envelope[DetectionPageOut]:
    """El total sale de la misma consulta con `count(*) OVER ()`.

    Pedirlo aparte serían dos viajes al pooler para pintar una pantalla, y con 260 ms
    medidos eso es medio segundo de reloj que se nota al paginar.
    """
    datos = await PerceptionService(db, ctx).detections(
        job_id=job_id,
        class_name=class_name,
        min_confidence=min_confidence,
        review_status=review_status,
        state=state,
        frame_start=frame_start,
        frame_end=frame_end,
        page=page,
        page_size=page_size,
    )
    return Envelope[DetectionPageOut](data=DetectionPageOut.model_validate(datos))


@router.get(
    "/jobs/{job_id}/frames/{frame_number}",
    response_model=Envelope[FrameOut],
    dependencies=[require("perception:read")],
    summary="Las detecciones de un fotograma",
)
async def get_frame(
    job_id: UUID, frame_number: int, db: Db, ctx: CurrentContext
) -> Envelope[FrameOut]:
    """`detections: []` cuando no hay ninguna, y NO un 404.

    Un fotograma sin detecciones existe y es información: el modelo lo miró y no vio
    nada. Un 404 diría que el fotograma no está.
    """
    datos = await PerceptionService(db, ctx).frame(
        job_id=job_id, frame_number=frame_number
    )
    return Envelope[FrameOut](data=FrameOut.model_validate(datos))


@router.post(
    "/jobs/{job_id}/reviews",
    response_model=Envelope[ReviewOut],
    dependencies=[require("perception:write")],
    summary="Revisar detecciones: aceptar, rechazar o marcar falso positivo",
)
async def submit_review(
    job_id: UUID, cuerpo: ReviewIn, db: Db, ctx: CurrentContext
) -> Envelope[ReviewOut]:
    """Lo que NO hace: sobrescribir el recuadro o la clase que dijo el modelo.

    Una corrección es una fila nueva que sustituye a la original y la deja
    `superseded`. Sobrescribir borraría lo que el modelo dijo, que es justo el dato
    con el que se mide si el modelo está mejorando.
    """
    datos = await PerceptionService(db, ctx).review(
        job_id=job_id, decisions=[d.model_dump() for d in cuerpo.decisions]
    )
    return Envelope[ReviewOut](data=ReviewOut.model_validate(datos))


@router.post(
    "/jobs/{job_id}/promote",
    response_model=Envelope[PromoteOut],
    dependencies=[require("perception:write"), require("observations:write")],
    summary="Promover las detecciones con código de rack a observaciones (0067)",
)
async def promote(
    job_id: UUID, cuerpo: PromoteIn, db: Db, ctx: CurrentContext
) -> Envelope[PromoteOut]:
    """La unión de los dos módulos: de aquí sale la ruta sobre el plano.

    Pide LOS DOS permisos, y es deliberado: escribe en percepción y en observaciones,
    así que quien lo llama tiene que poder hacer las dos cosas. Con solo
    `perception:write`, este endpoint sería un camino para escribir observaciones sin
    tener permiso para escribirlas.

    Idempotente: la unicidad `(source_id, rack_node_id, observed_at)` de 0067 absorbe
    los repetidos y las ya promovidas quedan `matched`. Pulsar dos veces da el mismo
    resultado, que es lo que se espera de un botón.
    """
    datos = await PerceptionService(db, ctx).promote_to_observations(
        job_id=job_id, source_code=cuerpo.source_code, source_kind=cuerpo.source_kind
    )
    return Envelope[PromoteOut](data=PromoteOut.model_validate(datos))


@router.get(
    "/warehouses/{warehouse_id}/unmatched",
    response_model=Envelope[UnmatchedReportOut],
    dependencies=[require("perception:read")],
    summary="Códigos leídos que el catálogo espacial no conoce",
)
async def unmatched(
    warehouse_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[UnmatchedReportOut]:
    """Es el informe que justifica que `unmatched` no caduque.

    Cada fila es un código que el modelo lee en el pasillo y el catálogo no tiene: o
    el OCR se equivoca sistemáticamente, o hay un rack que el WMS no conoce. Las dos
    respuestas son útiles y ninguna se descubre borrando la evidencia.
    """
    datos = await PerceptionService(db, ctx).unmatched(warehouse_id)
    return Envelope[UnmatchedReportOut](
        data=UnmatchedReportOut.model_validate(datos)
    )

@router.post(
    "/media/prepare",
    response_model=Envelope[MediaPrepareOut],
    dependencies=[require("perception:write")],
    summary="Reservar sitio en el bucket para subir un medio",
)
async def prepare_media(
    cuerpo: MediaPrepareIn,
    db: Db,
    ctx: CurrentContext,
    settings: AppSettings,
    token: AccessToken,
) -> Envelope[MediaPrepareOut]:
    """Primer paso de tres: preparar, subir directo, crear el trabajo.

    Devuelve `upload_url`, donde el cliente hace el POST del binario CON SU PROPIO
    token. Los bytes no atraviesan el backend, y las políticas de 0076 comprueban que
    la ruta esté bajo el prefijo del tenant y de un almacén suyo.

    No crea ninguna fila. Una fila de medio sin bytes es basura si la subida se
    abandona a medias, y con 400 MB por la red de un almacén se abandona.
    """
    datos = await PerceptionService(db, ctx, settings, token).prepare_media_upload(
        warehouse_id=cuerpo.warehouse_id,
        original_filename=cuerpo.original_filename,
        content_type=cuerpo.content_type,
        byte_count=cuerpo.bytes,
    )
    return Envelope[MediaPrepareOut](data=MediaPrepareOut.model_validate(datos))


@router.get(
    "/jobs/{job_id}/media-url",
    response_model=Envelope[MediaDownloadOut],
    dependencies=[require("perception:read")],
    summary="URL firmada del medio, para verlo o para que el worker lo descargue",
)
async def media_url(
    job_id: UUID,
    db: Db,
    ctx: CurrentContext,
    settings: AppSettings,
    token: AccessToken,
) -> Envelope[MediaDownloadOut]:
    """`perception:read` y NO `perception:ingest`, que es lo que pedía antes.

    ── POR QUE SE BAJO EL PERMISO ────────────────────────────────────────────

    Este endpoint nació para el worker, así que pedía la credencial de máquina. Pero
    es también la ÚNICA forma de ver el vídeo de una inspección desde la aplicación:
    los buckets son privados y sin URL firmada no hay reproducción.

    Con `perception:ingest` —que solo tienen `tenant_admin` y `warehouse_manager`— un
    operario, un auditor o un lector abrían la inspección y no veían nada. Ver el
    material de una inspección es LEERLA; ingerir es otra cosa.

    El worker no pierde nada: su credencial incluye `perception:read`.

    Responde 422 si el medio se registró solo con metadatos —lo que pasaba antes de
    0076—, diciendo que hay que volver a crear la inspección subiendo el archivo. Un
    404 diría que el trabajo no existe, y existe.
    """
    url = await PerceptionService(db, ctx, settings, token).media_download_url(job_id)
    return Envelope[MediaDownloadOut](
        data=MediaDownloadOut(url=url, expires_in=3600)
    )


# ══════════════════════════════════════════════════════════════════════════
# DIRECTOS (0078)
#
# El mismo trabajo de inferencia, leyendo de una URL en vez de un archivo. Mismas
# detecciones, mismas revisiones, mismo puente al WMS: un modelo aparte para directos
# habria duplicado los cuatro.
#
# ── LO QUE OLO_IA **NO** ES, Y HAY QUE DECIRLO ───────────────────────────
#
# Esto NO es un servidor RTMP. No hay nada aqui que acepte una emision: el dron o su
# mando publican en un servidor de medios —MediaMTX, nginx-rtmp, SRS— y lo que se
# registra aqui es la URL desde la que ese servidor sirve el stream.
#
# Montar la ingesta dentro del backend habria metido un servidor de medios en el proceso
# web, con su propio puerto, su propio ciclo de vida y su propio consumo de red, para
# hacer algo que un binario dedicado hace mejor.
# ══════════════════════════════════════════════════════════════════════════


@router.post(
    "/live",
    response_model=Envelope[JobOut],
    status_code=201,
    dependencies=[require("perception:write")],
    summary="Abrir una sesion de analisis en directo",
)
async def start_live(
    cuerpo: LiveStartIn, db: Db, ctx: CurrentContext
) -> Envelope[JobOut]:
    """Nace ya en `queued`: en un directo no hay nada que subir.

    Responde 422 si la URL no es `rtmp://`, `rtsp://` o `http(s)://`. Un `file://` haria
    que el worker leyera el disco de la maquina que lo ejecuta creyendo abrir una camara,
    y no fallaria: devolveria fotogramas.

    Y 409 si ya hay un TRABAJO vivo —`queued` o `running`— sobre esa misma URL: serian
    dos workers leyendo la misma camara y duplicando cada deteccion.

    El indice unico de 0078 no basta para esto y la prueba lo demostro: protege la fila
    del MEDIO, que el `ON CONFLICT` reutiliza, asi que la segunda sesion entraba con un
    trabajo nuevo sobre el mismo medio. La comprobacion vive en el servicio.
    """
    datos = await PerceptionService(db, ctx).start_live(
        warehouse_id=cuerpo.warehouse_id,
        name=cuerpo.name,
        stream_url=cuerpo.stream_url,
        pipeline=cuerpo.pipeline,
        model_version_id=cuerpo.model_version_id,
        confidence_threshold=cuerpo.confidence_threshold,
        frame_sampling_rate=cuerpo.frame_sampling_rate,
        notes=cuerpo.notes,
    )
    return Envelope[JobOut](data=JobOut.model_validate(datos))


@router.post(
    "/jobs/{job_id}/frame-count",
    response_model=Envelope[MediaFrameCountOut],
    dependencies=[require("perception:ingest")],
    summary="Anotar cuantos fotogramas tiene el video (extremo del worker)",
)
async def registrar_recuento(
    job_id: UUID, cuerpo: MediaFrameCountIn, db: Db, ctx: CurrentContext
) -> Envelope[MediaFrameCountOut]:
    """Guarda el recuento REAL de fotogramas del material.

    Va al MEDIO y no al trabajo: es una propiedad del archivo, asi que dos inspecciones del
    mismo video comparten el dato. Y es idempotente — a partir del segundo analisis
    responde `cambio: false` sin tocar la fila, porque `perception.media` esta vigilada por
    auditoria y reescribir la misma cifra dejaria una entrada por analisis diciendo que nada
    cambio.
    """
    datos = await PerceptionService(db, ctx).registrar_total_de_fotogramas(
        job_id=job_id,
        total_frames=cuerpo.total_frames,
        frames_to_analyze=cuerpo.frames_to_analyze,
    )
    return Envelope[MediaFrameCountOut](data=MediaFrameCountOut.model_validate(datos))


@router.post(
    "/jobs/{job_id}/live-progress",
    response_model=Envelope[LiveProgressOut],
    dependencies=[require("perception:ingest")],
    summary="Sumar el progreso de un lote (extremo del worker en directo)",
)
async def live_progress(
    job_id: UUID, cuerpo: LiveProgressIn, db: Db, ctx: CurrentContext
) -> Envelope[LiveProgressOut]:
    """Suma incrementos y NO cambia el estado.

    Un directo sigue `running` hasta que alguien lo para: es la diferencia con un
    archivo, que termina cuando se acaban sus fotogramas. Por eso esto no pasa por el
    endpoint de estado.

    Responde 409 si el trabajo no esta corriendo, en vez de acumular progreso sobre uno
    ya cerrado.
    """
    datos = await PerceptionService(db, ctx).live_progress(
        job_id=job_id, frames=cuerpo.frames
    )
    return Envelope[LiveProgressOut](data=LiveProgressOut.model_validate(datos))


# ══════════════════════════════════════════════════════════════════════════
# REGISTRO DE WORKERS (0075)
#
# Hasta 0075, `worker_available` era la constante `False` en el servicio. Era la
# respuesta CORRECTA mientras no existiera ningún worker —la pantalla avisaba de que
# la cola no iba a avanzar, en vez de dibujar una barra de progreso sobre nada—, pero
# una constante no puede volverse cierta el día que alguien arranca uno.
#
# Estos tres endpoints son lo que la convierte en un hecho. El worker late cada 30 s y
# la ventana son 90: tolera dos latidos perdidos antes de darse por muerto.
# ══════════════════════════════════════════════════════════════════════════


@router.post(
    "/workers/heartbeat",
    response_model=Envelope[WorkerOut],
    dependencies=[require("perception:ingest")],
    summary="Registrar un worker o refrescar su latido (extremo del worker)",
)
async def worker_heartbeat(
    cuerpo: WorkerHeartbeatIn, db: Db, ctx: CurrentContext
) -> Envelope[WorkerOut]:
    """Registrarse y latir son la misma llamada, a propósito.

    Un worker que arranca no sabe si ya tenía fila —puede venir de un reinicio— y
    obligarle a consultarlo antes abriría una carrera entre la consulta y el registro.

    Exige `perception:ingest`, el mismo permiso que depositar detecciones: es la
    credencial de MÁQUINA de este módulo, y la tienen `tenant_admin` y
    `warehouse_manager`, no el operario del pasillo.

    Sirve también a los runners de entrenamiento —`kind: "training"`— porque el
    registro es uno solo para los dos: un worker de inferencia y un runner de
    entrenamiento son el mismo concepto con distinto trabajo. Ver 0075.
    """
    datos = await PerceptionService(db, ctx).worker_heartbeat(
        kind=cuerpo.kind,
        name=cuerpo.name,
        capabilities=list(cuerpo.capabilities),
        agent_version=cuerpo.agent_version,
        device=cuerpo.device,
        current_job=cuerpo.current_job,
    )
    return Envelope[WorkerOut](data=WorkerOut.model_validate(datos))


@router.get(
    "/workers",
    response_model=Envelope[WorkerListOut],
    dependencies=[require("perception:read")],
    summary="Los workers registrados, vivos o no",
)
async def list_workers(
    db: Db,
    ctx: CurrentContext,
    kind: Annotated[str | None, Query(pattern="^(inference|training)$")] = None,
) -> Envelope[WorkerListOut]:
    """Incluye los MUERTOS a propósito.

    «Hubo un worker y dejó de responder hace dos horas» es información distinta de
    «nunca hubo ninguno», y es la que hace falta para saber si hay que ir a mirar una
    máquina. Filtrar los muertos dejaría las dos situaciones indistinguibles.
    """
    datos = await PerceptionService(db, ctx).list_workers(kind)
    return Envelope[WorkerListOut](data=WorkerListOut.model_validate(datos))


@router.delete(
    "/workers/{worker_id}",
    # El literal y no `status.HTTP_204_NO_CONTENT`: `status` es un parametro de
    # consulta de `list_jobs` en este mismo archivo, y el import quedaria sombreado
    # ahi dentro. Es la razon por la que el POST de arriba tambien usa `201`.
    status_code=204,
    dependencies=[require("perception:ingest")],
    summary="Retirar un worker del registro",
)
async def delete_worker(worker_id: UUID, db: Db, ctx: CurrentContext) -> None:
    """Para una máquina que se devuelve, no para una que se cayó.

    Una que se cae no necesita esto: su latido caduca en 90 s y desaparece de
    `alive` sola. Esto es para que la LISTA no acumule máquinas que ya no existen.
    """
    await PerceptionService(db, ctx).delete_worker(worker_id)

# ══════════════════════════════════════════════════════════════════════════
# EL PUENTE AL WMS
#
# `promote` responde «¿este codigo existe como rack?» y de ahi sale la RUTA sobre el
# plano. Esto responde «¿lo que hay en el hueco es lo que el WMS dice que hay?» y de
# ahi sale la DISCREPANCIA. Son dos preguntas distintas y las dos hacen falta.
# ══════════════════════════════════════════════════════════════════════════


@router.post(
    "/jobs/{job_id}/reconcile",
    response_model=Envelope[ReconcileOut],
    dependencies=[require("inventory:write")],
    summary="Convertir las detecciones en lecturas y compararlas con el WMS",
)
async def reconcile(
    job_id: UUID, cuerpo: ReconcileIn, db: Db, ctx: CurrentContext
) -> Envelope[ReconcileOut]:
    """Exige `inventory:write` y no `perception:write`, y la diferencia importa.

    Lo que esto escribe son filas de INVENTARIO —`inventory.scans` y
    `inventory.readings`—, no de percepcion. Quien puede revisar detecciones no
    necesariamente puede afirmar que en un hueco hay lo que hay, y esa afirmacion es la
    que despues genera una incidencia de inventario.

    Responde 409 si el trabajo no esta `completed`: las detecciones de un trabajo que
    sigue corriendo todavia pueden cambiar, y una lectura es un hecho.

    NO es idempotente: cada llamada crea un `scan` nuevo. Dos reconciliaciones del mismo
    vuelo son dos recorridos —quiza con otro corte del WMS de por medio— y machacar el
    anterior perderia la comparacion.
    """
    datos = await PerceptionService(db, ctx).reconcile_job(
        job_id=job_id, source=cuerpo.source, notes=cuerpo.notes
    )
    return Envelope[ReconcileOut](data=ReconcileOut.model_validate(datos))


@router.get(
    "/scans/{scan_id}/reconciliation",
    response_model=Envelope[ReconcileOut],
    dependencies=[require("inventory:read")],
    summary="El resultado de una reconciliacion ya hecha",
)
async def reconciliation(
    scan_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[ReconcileOut]:
    """Solo lectura, asi que `inventory:read`: mirar una discrepancia no la crea."""
    datos = await PerceptionService(db, ctx).reconciliation(scan_id)
    # Los recuentos del alta no aplican al consultar: se rellenan a cero para no
    # inventarlos. Un `detections: 0` aqui significa «no se recontaron», y el numero
    # que importa —`readings`— sale de la propia vista.
    completo = {
        "wms_snapshot_id": None,
        "warning": None,
        "detections": 0,
        "readings": len(datos["rows"]),
        "empty_frames": 0,
        "unknown_classes": [],
        **datos,
    }
    return Envelope[ReconcileOut](data=ReconcileOut.model_validate(completo))


@router.get(
    "/jobs/{job_id}/crop-prefix",
    response_model=Envelope[dict[str, str]],
    dependencies=[require("perception:write")],
    summary="Donde el worker deja los recortes de este trabajo",
)
async def crop_prefix(
    job_id: UUID,
    db: Db,
    ctx: CurrentContext,
    settings: AppSettings,
    token: AccessToken,
) -> Envelope[dict[str, str]]:
    """La ruta la genera el servidor; el worker solo anade el nombre del archivo.

    `perception:write` y no `:read`: esto no lee nada, habilita a escribir en el bucket.

    Se pide una vez por trabajo. Pedir una URL por recorte serian miles de idas y vueltas
    antes de subir un solo byte, y un video de cinco minutos deja miles.
    """
    #  DENTRO del sobre, como todo lo demas de esta API. Devolverlo suelto costo un
    #  analisis entero sin imagenes: el cliente del worker desenvuelve `data`, no lo
    #  encontro, y se quedo sin prueba visual sin que nada fallara ruidosamente.
    datos = await PerceptionService(db, ctx, settings, token).crop_prefix(job_id)
    return Envelope[dict[str, str]](data={k: str(v) for k, v in datos.items()})


@router.post(
    "/scans/{scan_id}/incidents",
    response_model=Envelope[ReconcileIncidentsOut],
    dependencies=[require("incidents:write")],
    summary="Convertir las discrepancias de un recorrido en incidencias",
)
async def open_incidents_from_scan(
    scan_id: UUID, db: Db, ctx: CurrentContext
) -> Envelope[ReconcileIncidentsOut]:
    """El paso que convierte un hallazgo en trabajo que alguien cierra.

    ── QUE SE ABRE Y QUE NO ──────────────────────────────────────────────────

    Solo las discrepancias: pallet inesperado, vacio inesperado y hueco fuera del
    catalogo. Lo que no se pudo VER —etiqueta ilegible, hueco tapado, sin revisar— no
    genera incidencia, y no es un olvido: pide volver a grabar, no ir al pasillo.
    Mezclarlos llenaria la bandeja de problemas de camara disfrazados de problemas de
    inventario, y a los quince minutos nadie la mira.

    ── SE PUEDE LLAMAR DOS VECES ─────────────────────────────────────────────

    Un hueco que ya tiene una incidencia abierta se salta y se cuenta aparte, en vez de
    fallar a mitad y dejar la bandeja llena por la mitad sin decirlo.

    Exige `incidents:write` y no `inventory:write`: lo que crea son incidencias, y
    asignar trabajo a alguien no es lo mismo que registrar una lectura.
    """
    #  El actor es el usuario de DOMINIO, no el de auth: es el mismo camino que usa
    #  `POST /incidents`, y mezclarlos dejaria incidencias firmadas por un id que no
    #  existe en la tabla de personas.
    actor = await identity.fetch_current_user_id(db)
    datos = await PerceptionService(db, ctx).abrir_incidencias(
        scan_id=scan_id, actor=actor
    )
    return Envelope[ReconcileIncidentsOut](
        data=ReconcileIncidentsOut.model_validate(datos)
    )


# ══════════════════════════════════════════════════════════════════════════════
# QUITAR UNA INSPECCIÓN DE EN MEDIO
#
# Reportado por el uso real: se sube un vídeo, la inspección se queda sin analizar
# —hoy no hay modelo publicado que lea códigos de hueco— y los bytes se quedan en
# Storage. Sin forma de quitarlas, se acumulan y ocupan.
#
#     perception:delete   borrar y archivar   · tenant_admin y warehouse_manager
#
# Propio y no `perception:write`: escribir es registrar inspecciones y revisar
# detecciones, que es el trabajo del operario. Borrar destruye bytes.
# ══════════════════════════════════════════════════════════════════════════════


@router.get(
    "/jobs/{job_id}/deletable",
    response_model=Envelope[JobDeletableOut],
    dependencies=[require("perception:read")],
    summary="Si esta inspeccion se puede borrar, y si no, por que no",
)
async def job_deletable(
    job_id: UUID, db: Db, ctx: CurrentContext, settings: AppSettings, token: AccessToken
) -> Envelope[JobDeletableOut]:
    """Se consulta con `perception:read` aunque borrar pida más.

    Es deliberado: la pantalla necesita saber si podrá borrar ANTES de ofrecer el
    botón, y quien solo lee también gana con ver que una inspección tiene tres
    incidencias colgando. Enterarse de que no se puede al pulsar es peor.
    """
    datos = await PerceptionService(db, ctx, settings, token).puede_borrarse(job_id)
    return Envelope[JobDeletableOut](data=JobDeletableOut.model_validate(datos))


@router.post(
    "/jobs/{job_id}/archive",
    status_code=204,
    dependencies=[require("perception:delete")],
    summary="Archivar una inspeccion: fuera de la lista, el rastro se queda",
)
async def archive_job(
    job_id: UUID, db: Db, ctx: CurrentContext, settings: AppSettings, token: AccessToken
) -> None:
    """⚠ **NO libera Storage.** Los bytes siguen ahí.

    Es el precio de no destruir lo que cuelga de la inspección, y la interfaz lo dice:
    alguien que archive para hacer sitio no lo va a hacer.

    Idempotente: archivar dos veces no mueve la fecha, o el registro diría que se
    archivó cuando solo se volvió a pulsar.
    """
    actor = await identity.fetch_current_user_id(db)
    await PerceptionService(db, ctx, settings, token).archivar_trabajo(job_id, actor=actor)


@router.post(
    "/jobs/{job_id}/unarchive",
    status_code=204,
    dependencies=[require("perception:delete")],
    summary="Devolver una inspeccion archivada a la lista",
)
async def unarchive_job(
    job_id: UUID, db: Db, ctx: CurrentContext, settings: AppSettings, token: AccessToken
) -> None:
    """Archivar tiene que poder deshacerse. Sin esto, una archivada por error se
    quedaría fuera de la lista para siempre y la única salida sería borrarla."""
    await PerceptionService(db, ctx, settings, token).desarchivar_trabajo(job_id)


@router.delete(
    "/jobs/{job_id}",
    response_model=Envelope[JobDeletedOut],
    dependencies=[require("perception:delete")],
    summary="Borrar una inspeccion y liberar su espacio en Storage",
)
async def delete_job(
    job_id: UUID, db: Db, ctx: CurrentContext, settings: AppSettings, token: AccessToken
) -> Envelope[JobDeletedOut]:
    """Borra la inspección, sus detecciones, sus eventos y sus bytes.

    **422 si de ella cuelga trabajo que nadie puede reconstruir** —una incidencia
    abierta desde ella, una detección promovida a observación de rack, o una revisada
    por una persona—, diciendo cuántas de cada y que la alternativa es archivarla. Un
    409 sería igual de correcto en HTTP, pero este 422 explica *qué* del cuerpo del
    problema lo impide, que es lo que hace falta para decidir.

    Devuelve cuánto espacio se liberó DE VERDAD. Si el medio estaba compartido con
    otra inspección —`uq_media_hash` deduplica por hash— el objeto no se toca y aquí
    vendrá 0, dicho en vez de callado.

    No hay 204: el cuerpo es el dato que justifica la operación. Un borrado que dice
    «liberados 0 bytes» cuando se esperaba liberar espacio es información, no ruido.
    """
    datos = await PerceptionService(db, ctx, settings, token).borrar_trabajo(job_id)
    return Envelope[JobDeletedOut](data=JobDeletedOut.model_validate(datos))
