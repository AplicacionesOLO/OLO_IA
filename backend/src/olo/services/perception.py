"""Servicio de percepción: trabajos de inferencia, detecciones y el puente con 0067.

── DÓNDE ESTÁ LA FRONTERA ───────────────────────────────────────────────────

Este módulo NO ejecuta inferencia. Aquí no se carga un modelo ni se decodifica un
vídeo: se registra qué se pidió, se acepta lo que un worker deja, y se traduce lo
que se leyó a hechos que el resto del sistema entiende.

Que no haya worker no es un detalle a esconder. Un trabajo creado sin worker llega a
`queued` y se queda ahí, porque no hay nadie que lo recoja. La alternativa —moverlo
a `running` y dibujar una barra de progreso— sería una pantalla que finge trabajar.
Por eso `worker_available` viaja en la respuesta, con su motivo cuando es `False`.

Ese valor era una CONSTANTE `False` hasta 0075, y era la respuesta correcta mientras
no existiera ningún worker. Ahora sale del latido de `core.workers`: el worker de
`tools/inferir.py` late cada 30 s y la ventana son 90, así que la pantalla dice la
verdad en las dos direcciones —incluido «había uno y se murió»—.

── EL PUENTE, QUE ES LO QUE DA VALOR AL MÓDULO ──────────────────────────────

    detección con texto «RCL104»          ← lo que el modelo cree que leyó
              ↓  ¿existe RCL104 como rack de ESTE almacén?
    spatial.rack_observations (0067)      ← el hecho: la fuente vio el rack R a las T
              ↓  x spatial.rack_placements (0065)
    la RUTA en metros sobre el plano

Y la rama que casi nadie implementa: cuando el código NO existe. Esa detección no se
descarta ni se corrige a lo que más se parezca —«RCL104» y «RCL1O4» se diferencian en
un carácter, y adivinar convertiría un error de lectura en un dato—. Se queda
`unmatched`, que 0032 declaró sin caducidad porque señala una discrepancia real.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from olo.core.config import get_settings
from olo.core.errors import (
    BusinessRuleError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
)
from olo.domain.inspeccion import ESTADOS_ACCIONABLES
from olo.domain.perception import (
    BUCKET,
    convertir,
    es_codigo_de_ubicacion,
    prefijo_de_recortes,
    ruta_canonica,
    validar_medio,
)
from olo.domain.perception.media import BYTES_MAX, TIPOS_ADMITIDOS
from olo.domain.perception.resolucion import diagnosticar_resumen
from olo.repositories.incidents import IncidentRepository
from olo.repositories.perception import PerceptionRepository
from olo.repositories.spatial_observations import SpatialObservationRepository
from olo.repositories.workers import WorkerRepository
from olo.security.authorization import can_access_warehouse
from olo.services.notifications import NotificationService
from olo.services.usage import UsageService
from olo.storage.supabase_storage import StorageClient, StorageError

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings
    from olo.core.context import TenantContext

# Los estados desde los que un trabajo puede pasar a la cola. Es la MISMA tabla que
# el disparador de 0069 y que `stateMachine.ts`; aquí sirve para dar un error de
# dominio legible en lugar de dejar que salte el CHECK de la base con su jerga.
_A_LA_COLA = {"uploaded", "failed"}

#: Las clases cuyo texto es un codigo de UBICACION. Solo estas se promueven a observaciones
#: espaciales: el texto de un `qr_pallet` es el codigo del pallet, y el de un `pallet` puede
#: ser cualquier cosa que cayera dentro de su caja.
#:
#: Vive aqui como constante y no en la base porque hoy es una sola clase. En cuanto haya dos
#: familias de etiquetas de ubicacion, el sitio correcto es una marca en `ai.classes` — y
#: entonces esto pasa a ser una consulta.
_CLASES_QUE_UBICAN = frozenset({"qr_ubicacion"})

#: Pipelines que LEEN códigos y por tanto pueden producir lecturas de ubicación. Solo
#: para estos tiene sentido la resolución espacial automática al cerrar el trabajo: un
#: `object-detection` no genera ninguna `qr_ubicacion`, así que promover sería recorrer
#: toda la cola para no casar nada.
_PIPELINES_CON_CODIGO = frozenset({"ocr", "detection-ocr", "ubicaciones"})

logger = logging.getLogger(__name__)

# Lo que se considera «terminal»: no se cancela ni se reintenta.
_TERMINALES = {"completed", "cancelled"}


class PerceptionService:
    def __init__(
        self,
        session: AsyncSession,
        ctx: TenantContext,
        settings: Settings | None = None,
        access_token: str | None = None,
    ) -> None:
        """`settings` y `access_token` solo hacen falta para hablar con Storage.

        Son OPCIONALES porque la mayoría de los métodos de este servicio no tocan
        bytes: listar trabajos, mover un estado o promover detecciones no necesitan
        credenciales de Storage, y exigirlas obligaría a los veinte sitios que
        construyen este servicio a pasar dos cosas que no usan.

        Los tres métodos que sí las necesitan lo comprueban y fallan diciendo qué
        falta, en vez de reventar con un `AttributeError` sobre `None`.
        """
        self._session = session
        self._repo = PerceptionRepository(session)
        self._obs = SpatialObservationRepository(session)
        self._workers = WorkerRepository(session)
        self._ctx = ctx
        self._storage = (
            StorageClient(settings, access_token)
            if settings is not None and access_token is not None
            else None
        )
        #  `get_settings()` y no el parametro `settings`: ese sigue siendo opcional
        #  y solo para Storage (ver el docstring de arriba). Avisar no depende de
        #  credenciales de Storage, asi que exigirlo aqui obligaria a los mismos
        #  veinte sitios a pasar algo que la mayoria no usa.
        self._notificaciones = NotificationService(session, ctx, get_settings())

    # ── Modelos ────────────────────────────────────────────────────────────
    async def models(self) -> dict[str, Any]:
        """El catálogo publicado, y si hay algo que ejecutar.

        Devuelve la lista Y `worker_available`, juntos y a propósito: elegir modelo
        sin saber si alguien lo va a correr es la mitad de la información que hace
        falta para decidir si merece la pena lanzar el análisis.
        """
        modelos = await self._repo.published_models()
        vivo = await self._workers.esta_vivo("inference")
        return {
            "models": modelos,
            "worker_available": vivo,
            #  ── EL LIMITE VIAJA CON EL CATALOGO ───────────────────────────
            #
            #  La pantalla de nueva inspeccion ya pide esto ANTES de dejar elegir un
            #  archivo, asi que es el sitio donde el limite llega sin una peticion mas.
            #
            #  Y viaja porque estaba escrito a mano en el navegador: decia 500 MB cuando el
            #  servidor admitia 2 GB, y el operador se quedaba sin poder subir un vuelo que
            #  el sistema aceptaba de sobra. Dos numeros para la misma regla se separan
            #  siempre; el que manda es el del dominio.
            "max_upload_bytes": BYTES_MAX,
            "accepted_types": sorted(TIPOS_ADMITIDOS),
            "unavailable_reason": (
                None
                if vivo
                else (
                    "No hay ningun worker de inferencia con latido reciente. Un trabajo "
                    "se puede crear y queda en cola, pero nadie lo va a procesar: lo "
                    "coge `backend/tools/inferir.py` donde haya GPU."
                )
            ),
        }

    # ── Trabajos ───────────────────────────────────────────────────────────
    async def create_job(
        self,
        *,
        warehouse_id: UUID,
        name: str,
        media: dict[str, Any],
        pipeline: str,
        model_version_id: UUID | None,
        confidence_threshold: float,
        frame_sampling_rate: float | None,
        save_detected_frames: bool,
        notes: str | None,
    ) -> dict[str, Any]:
        """Registra el medio y crea el trabajo, hasta `uploaded`.

        NO llega a `queued` por su cuenta. Encolar es una decisión —consume el worker
        cuando exista— y hacerla automáticamente al subir dejaría al operador sin el
        paso en el que revisa el umbral y el modelo antes de gastar máquina.

        El `sha256` lo calcula quien sube, no este servicio: los bytes no pasan por
        aquí. Si llega mal, la única consecuencia es que un mismo vídeo se registre
        dos veces, y eso se ve en la lista.
        """
        kind = media["kind"]
        if kind == "image" and (media.get("duration_ms") or media.get("total_frames")):
            # El CHECK de 0069 lo rechazaría igual; se comprueba aquí para dar un
            # mensaje que diga qué hacer en lugar de un fallo de restricción.
            raise BusinessRuleError(
                "una imagen no tiene duracion ni fotogramas: quita esos campos o "
                "declara el medio como video"
            )
        if kind == "video" and frame_sampling_rate is None:
            raise BusinessRuleError(
                "un video necesita frecuencia de muestreo: sin ella no se sabe "
                "cuantos fotogramas analizar"
            )

        # ── Los bytes, si se subieron (0076) ────────────────────────────
        #
        # `media_id` viene de `prepare`. La ruta se RECALCULA aquí con el mismo id,
        # tipo y nombre: no se acepta del cliente en ningún paso, así que no hay forma
        # de reclamar un objeto que esté en otra ruta del bucket.
        #
        # Y se COMPRUEBA que el objeto exista. Sin esta comprobación se crearía un
        # trabajo cuyo vídeo no está, el worker lo cogería, fallaría al descargar, y el
        # operador vería un trabajo `failed` sin saber que su subida se cortó.
        bucket: str | None = None
        object_path: str | None = None
        media_id = media.get("media_id")
        if media_id is not None:
            object_path = ruta_canonica(
                self._ctx.tenant_id,
                warehouse_id,
                UUID(str(media_id)),
                media["content_type"],
                media["original_filename"],
            )
            almacen = self._exige_storage()
            if await almacen.head(BUCKET, object_path) is None:
                raise BusinessRuleError(
                    "El archivo no esta en Storage. Subelo antes de crear la "
                    "inspeccion, y manda el mismo nombre y tipo que usaste en "
                    "`prepare`: la ruta se deriva de ellos."
                )
            bucket = BUCKET

        fila_media = await self._repo.upsert_media(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            kind=kind,
            original_filename=media["original_filename"],
            content_type=media["content_type"],
            byte_count=media["bytes"],
            sha256=media["sha256"],
            width=media.get("width"),
            height=media.get("height"),
            duration_ms=media.get("duration_ms"),
            total_frames=media.get("total_frames"),
            source=media.get("source", "uploaded-file"),
            bucket=bucket,
            object_path=object_path,
        )

        etiqueta = None
        if model_version_id is not None:
            etiqueta = await self._model_label(model_version_id)

        # `frames_total` sale del medio: una imagen es 1 fotograma; un vídeo, los que
        # se vayan a analizar según el muestreo. Ponerlo a 1 en un vídeo daría una
        # barra de progreso que salta de 0 a 100.
        if kind == "video":
            total = self._frames_a_analizar(
                duration_ms=fila_media.get("duration_ms"),
                total_frames=fila_media.get("total_frames"),
                fps=frame_sampling_rate,
            )
        else:
            total = 1

        creado = await self._repo.create_job(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            media_id=UUID(str(fila_media["id"])),
            name=name,
            pipeline=pipeline,
            model_version_id=model_version_id,
            model_label=etiqueta,
            confidence_threshold=confidence_threshold,
            frame_sampling_rate=frame_sampling_rate,
            save_detected_frames=save_detected_frames,
            notes=notes,
            frames_total=total,
        )
        job_id = UUID(str(creado["id"]))

        # `draft → uploading → uploaded`, paso a paso. Es la cadena que 0069 valida y
        # que deja un historial que explica el estado. Escribir `uploaded` de entrada
        # habría sido una sentencia menos y un historial que no cuadra con su fila.
        for destino in ("uploading", "uploaded"):
            await self._repo.update_status(job_id=job_id, to_status=destino)

        return await self.get_job(job_id)

    async def get_job(self, job_id: UUID) -> dict[str, Any]:
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        job["events"] = await self._repo.list_events(job_id)
        job["class_counts"] = await self._repo.class_counts(job_id)
        # Igual que en `models()`: la pantalla necesita saber si la cola avanza.
        job["worker_available"] = await self._workers.esta_vivo("inference")
        return job

    async def list_jobs(
        self,
        *,
        warehouse_id: UUID | None,
        status: str | None,
        limit: int,
        incluir_archivadas: bool = False,
        incluir_directos: bool = True,
    ) -> dict[str, Any]:
        trabajos = await self._repo.list_jobs(
            warehouse_id=warehouse_id,
            status=status,
            limit=limit,
            incluir_archivadas=incluir_archivadas,
            incluir_directos=incluir_directos,
        )
        #  Una sola consulta del latido para toda la lista, no una por trabajo: con
        #  260 ms de latencia al pooler, 20 trabajos serían cinco segundos de espera
        #  para responder la misma pregunta veinte veces.
        vivo = await self._workers.esta_vivo("inference")
        for trabajo in trabajos:
            trabajo["worker_available"] = vivo
        # Cuántas hay archivadas, para que la pantalla pueda decirlo con el
        # interruptor. Sin el recuento, esconderlas se lee como si no existieran.
        archivadas = 0
        if not incluir_archivadas:
            todas = await self._repo.list_jobs(
                warehouse_id=warehouse_id,
                status=status,
                limit=limit,
                incluir_archivadas=True,
            )
            archivadas = len(todas) - len(trabajos)
        return {
            "jobs": trabajos,
            "worker_available": vivo,
            "archived_count": archivadas,
        }

    async def change_status(
        self, *, job_id: UUID, to_status: str, reason: str | None
    ) -> dict[str, Any]:
        """Encola, cancela o reintenta. La transición la valida la base.

        Este método existe para traducir: el CHECK de 0069 da un error correcto y
        opaco, y quien pulsa «cancelar» en un trabajo ya completado merece leer por
        qué no se puede en lugar de un fallo de restricción.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")

        actual = job["status"]
        if to_status == "queued" and actual not in _A_LA_COLA:
            raise ConflictError(
                f"un trabajo en '{actual}' no se puede encolar: solo desde "
                f"{' o '.join(sorted(_A_LA_COLA))}"
            )
        if to_status == "cancelled" and actual in _TERMINALES:
            raise ConflictError(
                f"un trabajo en '{actual}' ya termino: cancelarlo no cambiaria nada, "
                "y el historial diria que se cancelo algo que estaba hecho"
            )
        if to_status == "failed" and not reason:
            raise BusinessRuleError(
                "un trabajo fallido necesita motivo: sin el, la pantalla dice que "
                "algo fue mal y no deja hacer nada al respecto"
            )

        movido = await self._repo.update_status(
            job_id=job_id, to_status=to_status, error_message=reason
        )
        if movido is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        actualizado = await self.get_job(job_id)
        if to_status in ("failed", "cancelled"):
            await self._avisar_cierre(actualizado, exito=False, motivo=reason)
        return actualizado

    async def _avisar_cierre(
        self, job: dict[str, Any], *, exito: bool, motivo: str | None
    ) -> None:
        """Notifica a quien creo el trabajo que se cerro. Best-effort: ver la
        cabecera de `NotificationService.avisar`."""
        nombre = job.get("name") or "un trabajo de percepcion"
        if exito:
            titulo = f"Analisis terminado: {nombre}"
            cuerpo = f"El analisis de «{nombre}» termino y ya tiene detecciones para revisar."
        else:
            titulo = f"Analisis no completado: {nombre}"
            cuerpo = (
                f"El analisis de «{nombre}» no llego a terminar. "
                f"Motivo: {motivo or 'sin especificar'}"
            )

        await self._notificaciones.avisar(
            user_id=UUID(str(job["created_by"])),
            kind="perception_job.succeeded" if exito else "perception_job.failed",
            title=titulo,
            body=cuerpo,
            link=f"/perception/jobs/{job['id']}",
        )

    # ── Detecciones ────────────────────────────────────────────────────────
    async def ingest_detections(
        self,
        *,
        job_id: UUID,
        items: Sequence[dict[str, Any]],
        replace: bool,
        mark_completed: bool,
    ) -> dict[str, Any]:
        """Recibe lo que produjo la inferencia. Es el extremo del worker.

        `replace=True` borra las detecciones anteriores del trabajo: es lo que hace
        que reprocesar sea seguro. Sin ello, un segundo intento sumaría sus
        detecciones a las del primero y el recuento del trabajo sería la suma de dos
        análisis distintos presentada como uno.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        if job["status"] not in {"queued", "running"}:
            raise ConflictError(
                f"un trabajo en '{job['status']}' no acepta detecciones: solo "
                "mientras esta en cola o corriendo"
            )

        umbral = float(job["confidence_threshold"])
        # Se rechaza el lote entero si trae algo por debajo del umbral que el propio
        # trabajo declaró. Filtrarlo en silencio sería peor: el trabajo diría 200
        # detecciones, el worker habría mandado 260, y nadie sabría dónde se fueron.
        flojas = [i for i in items if float(i["confidence"]) < umbral and not i.get("is_manual")]
        if flojas:
            raise BusinessRuleError(
                f"{len(flojas)} detecciones por debajo del umbral del trabajo "
                f"({umbral}). El worker deberia filtrarlas antes de enviarlas: "
                "descartarlas aqui haria que el recuento no cuadrara con lo enviado"
            )

        # Cuota (0113): se comprueba el lote ENTERO antes de insertar nada --
        # igual que el umbral de confianza de arriba, un rechazo a medias
        # dejaria el recuento del trabajo sin corresponder con lo que el
        # worker cree que mando. `replace=True` (reprocesar) no libera cupo
        # hasta despues de este chequeo a proposito: primero se sabe si el
        # lote NUEVO cabe, no si el saldo neto contra lo que se va a borrar
        # cabria -- mas simple, y el caso normal (`replace=False`) es el que
        # de verdad importa para la cuota.
        if items:
            await UsageService(self._session).verificar_cupo_detecciones(nuevas=len(items))

        borradas = 0
        if replace:
            borradas = await self._repo.delete_detections(job_id)

        if job["status"] == "queued":
            await self._repo.update_status(job_id=job_id, to_status="running")

        insertadas = await self._repo.insert_detections(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=UUID(str(job["warehouse_id"])),
            job_id=job_id,
            items=items,
        )

        # ── El recuento: FIJAR o SUMAR según `replace` ─────────────────────
        #
        # `replace=True` significa «este lote es TODO el resultado» —se acaban de borrar
        # las anteriores—, así que el recuento es el del lote.
        #
        # `replace=False` significa «añade a lo que hay», y ahí fijarlo es un fallo: cada
        # lote borraba el recuento del anterior. Medido en un directo: 6 detecciones
        # guardadas en la base y `detection_count = 0`, porque el último lote —el vacío
        # que cierra la sesión— lo fijó a cero.
        #
        # El bump va ANTES del cambio de estado: `bump_frames` solo suma mientras el
        # trabajo está `running`, y `mark_completed` lo saca de ahí.
        if not replace and insertadas:
            await self._repo.bump_frames(job_id, procesados=0, detecciones=insertadas)

        await self._repo.update_status(
            job_id=job_id,
            to_status="completed" if mark_completed else "running",
            # En un directo `frames_total` es NULL, así que esto pasa `None` y
            # `COALESCE` conserva lo que el worker fue acumulando. En un archivo fija el
            # total, que es lo que significa haberlo terminado.
            frames_processed=job["frames_total"] if mark_completed else None,
            detection_count=insertadas if replace else None,
        )
        job_final = await self.get_job(job_id)
        #  ── RESOLUCIÓN ESPACIAL EN TIEMPO REAL (solo directos) ─────────────
        #
        #  En un directo cada lote AÑADE y nunca se reescribe (`replace=False`), así
        #  que sus lecturas ya son definitivas al llegar: esperar al cierre del vuelo
        #  para atarlas a su rack solo retrasaría lo que el operador quiere ver
        #  mientras vuela. Se promueve el lote en cuanto entra. Idempotente (ver
        #  `promote_to_observations`), y en SAVEPOINT por el mismo motivo que la
        #  promoción del cierre: un fallo aquí no puede perder la ingesta.
        if (
            not mark_completed
            and insertadas
            and job.get("media_stream_url")
            and str(job["pipeline"]) in _PIPELINES_CON_CODIGO
        ):
            try:
                async with self._session.begin_nested():
                    await self.promote_to_observations(
                        job_id=job_id,
                        source_code=str(job_id),
                        source_kind="drone",
                        en_vivo=True,
                    )
            except Exception:  # un fallo aquí no rompe la ingesta
                logger.warning(
                    "resolucion en vivo fallida para el lote del trabajo %s", job_id,
                    exc_info=True,
                )
        if mark_completed:
            await self._avisar_cierre(job_final, exito=True, motivo=None)
            #  ── RESOLUCIÓN ESPACIAL AUTOMÁTICA ────────────────────────────
            #
            #  Al cerrarse el trabajo, las lecturas de ubicación (`qr_ubicacion`) se
            #  promueven a observaciones y se les escribe `rack_node_id`. Antes esto
            #  dependía de que un operador pulsara «promover» a mano, así que casi
            #  ninguna detección quedaba enlazada a su rack y los huecos nunca
            #  aparecían como ubicaciones vacías del almacén.
            #
            #  Va en un SAVEPOINT: si la promoción falla, revierte SOLO lo suyo y la
            #  ingesta del worker —que ya terminó— se conserva. Un fallo aquí no debe
            #  perder las detecciones ni devolver error al worker; la promoción es
            #  idempotente y se puede reintentar a mano con el mismo resultado.
            #
            #  `source_code = job_id`: cada trabajo (un vuelo) es su propia fuente, lo
            #  que hace la promoción idempotente por la unicidad de 0067.
            if str(job["pipeline"]) in _PIPELINES_CON_CODIGO:
                try:
                    async with self._session.begin_nested():
                        resultado = await self.promote_to_observations(
                            job_id=job_id,
                            source_code=str(job_id),
                            source_kind="drone",
                        )
                    logger.info(
                        "resolucion automatica trabajo %s: %s candidatas, "
                        "%s casadas, %s observaciones",
                        job_id,
                        resultado.get("candidates"),
                        resultado.get("matched"),
                        resultado.get("observations_created"),
                    )
                except Exception:  # noqa: BLE001  un fallo aquí no rompe la ingesta
                    logger.warning(
                        "resolucion automatica fallida para el trabajo %s; las "
                        "detecciones se conservan, se puede promover a mano",
                        job_id,
                        exc_info=True,
                    )
        return {
            "inserted": insertadas,
            "deleted": borradas,
            "job": job_final,
        }

    async def detections(
        self,
        *,
        job_id: UUID,
        class_name: str | None,
        min_confidence: float | None,
        review_status: str | None,
        state: str | None,
        frame_start: int | None,
        frame_end: int | None,
        page: int,
        page_size: int,
        mas_recientes: bool = False,
    ) -> dict[str, Any]:
        if await self._repo.get_job(job_id) is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        items, total = await self._repo.list_detections(
            job_id=job_id,
            class_name=class_name,
            min_confidence=min_confidence,
            review_status=review_status,
            state=state,
            frame_start=frame_start,
            frame_end=frame_end,
            offset=(page - 1) * page_size,
            limit=page_size,
            mas_recientes=mas_recientes,
        )
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    async def frame(self, *, job_id: UUID, frame_number: int) -> dict[str, Any]:
        """Las detecciones de un fotograma.

        Devuelve el fotograma con `detections: []` cuando no hay ninguna, en lugar de
        404. Un fotograma sin detecciones existe y es información —el modelo lo miró
        y no vio nada—; un 404 diría que el fotograma no está.
        """
        if await self._repo.get_job(job_id) is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        dets = await self._repo.frame_detections(job_id=job_id, frame_number=frame_number)
        return {
            "frame_number": frame_number,
            "frame_ms": dets[0]["frame_ms"] if dets else None,
            "frame_ref": dets[0]["frame_ref"] if dets else None,
            "detections": dets,
        }

    # ── Revisión ───────────────────────────────────────────────────────────
    async def review(
        self, *, job_id: UUID, decisions: Sequence[dict[str, Any]]
    ) -> dict[str, Any]:
        """Aplica las decisiones de una revisión.

        Un falso positivo pasa a `discarded` en el mismo UPDATE que su revisión: son
        el mismo hecho —«lo he mirado y no vale»— y en dos sentencias existiría un
        instante en el que está revisado y todavía cuenta como detección válida.

        Lo que NO hace: sobrescribir el recuadro o la clase del modelo. Una
        corrección es una fila NUEVA que sustituye a la original y la deja
        `superseded`. Sobrescribir borraría lo que el modelo dijo, que es justo el
        dato con el que se mide si el modelo mejora.
        """
        if await self._repo.get_job(job_id) is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")

        aplicadas = 0
        no_encontradas: list[str] = []
        for d in decisions:
            estado = "discarded" if d.get("is_false_positive") else None
            ok = await self._repo.mark_review(
                detection_id=UUID(str(d["detection_id"])),
                observed_at=d["observed_at"],
                review_status=d["status"],
                comment=d.get("comment"),
                new_state=estado,
            )
            if ok:
                aplicadas += 1
            else:
                no_encontradas.append(str(d["detection_id"]))

        # Las que no se encontraron se REPORTAN, no se ignoran: revisar 40
        # detecciones y que se apliquen 38 sin decir cuáles fallaron es la clase de
        # respuesta que hace que alguien crea que revisó algo que no revisó.
        return {"applied": aplicadas, "not_found": no_encontradas}

    # ── El puente con 0067 ─────────────────────────────────────────────────
    async def promote_to_observations(
        self,
        *,
        job_id: UUID,
        source_code: str,
        source_kind: str,
        en_vivo: bool = False,
    ) -> dict[str, Any]:
        """Convierte en observaciones las detecciones cuyo texto es un rack real.

        Es la unión de los dos módulos: de aquí sale la ruta que el explorador dibuja
        sobre el plano.

        Idempotente por partida doble: la unicidad `(source_id, rack_node_id,
        observed_at)` de 0067 absorbe los repetidos, y las detecciones ya promovidas
        quedan `matched`, así que volver a llamar no duplica ni la observación ni la
        marca. Un operador que pulsa dos veces obtiene el mismo resultado, que es lo
        que se espera de un botón.

        Los códigos que NO existen se devuelven en `unresolved`. No se corrigen ni se
        aproximan: «RCL104» y «RCL1O4» se diferencian en un carácter, y adivinar
        cual quiso decir el OCR convertiría un error de lectura en un dato.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        #  `en_vivo`: un directo `running` SÍ se promueve. Sus lotes solo añaden —nunca
        #  `replace`—, así que lo ya recibido no puede cambiar y la objeción de abajo no
        #  aplica. Solo lo usa `ingest_detections`, y solo para trabajos con stream.
        vivo_ok = en_vivo and job["status"] == "running" and job.get("media_stream_url")
        if job["status"] != "completed" and not vivo_ok:
            raise ConflictError(
                f"un trabajo en '{job['status']}' no se promueve: sus detecciones "
                "todavia pueden cambiar, y una observacion es un hecho"
            )

        warehouse_id = UUID(str(job["warehouse_id"]))

        # Todas las detecciones con texto y sin resolver. Se piden en páginas grandes
        # porque el puente es una operación de lote, no una pantalla.
        candidatas: list[dict[str, Any]] = []
        pagina = 1
        while True:
            items, total = await self._repo.list_detections(
                job_id=job_id, state="unmatched", offset=(pagina - 1) * 500, limit=500
            )
            #  Con texto Y de una clase que nombre una ubicación.
            #
            #  El filtro por clase no sobra: desde que los códigos se decodifican, la caja
            #  de un `pallet` puede contener la etiqueta del hueco y traer su código en el
            #  texto. Promover eso diría «vi el rack X» a partir de una detección que
            #  hablaba de un pallet — cierto por accidente y por el motivo equivocado. Una
            #  observación espacial tiene que venir de una lectura de ubicación.
            candidatas.extend(
                i
                for i in items
                if i["text_value"] and i["class_name"] in _CLASES_QUE_UBICAN
            )
            if pagina * 500 >= total:
                break
            pagina += 1

        if not candidatas:
            return {
                "source_code": source_code,
                "candidates": 0,
                "observations_created": 0,
                "matched": 0,
                "unresolved": [],
            }

        """
        ── SE CASA PRIMERO CONTRA EL HUECO, Y EL RACK ES EL RESPALDO ──────────────

        Antes solo se buscaba entre los códigos de RACK, así que una lectura completa
        —`RCL47-C018-N01-2`, que es lo que dicen los QR de las etiquetas— no casaba con
        nada y la pantalla decía «sin detectar» de un código correctamente leído.

        Los 29.310 huecos del catálogo llevan su código de cuatro niveles, así que la
        lectura apunta a un hueco concreto. La observación se sigue atando al RACK, que es
        lo que el modelo de 0067 admite, pero el código exacto queda escrito en la nota:
        así no se pierde la precisión que el QR sí tenía.

        El respaldo por rack se conserva porque no toda lectura es completa: una etiqueta
        vieja puede decir solo `RCL47`, y eso sigue valiendo para saber en qué rack se
        estaba.
        """
        leidos = [c["text_value"] for c in candidatas]
        huecos = await self._repo.resolve_location_codes(
            warehouse_id=warehouse_id, codes=leidos
        )
        #  Solo se pregunta por rack lo que no resolvió como hueco: preguntar por todo
        #  sería un viaje de más con la respuesta ya en la mano.
        mapa = await self._repo.resolve_rack_codes(
            warehouse_id=warehouse_id,
            codes=[c for c in leidos if c not in huecos],
        )

        fuente = await self._obs.upsert_source(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            code=source_code,
            name=job["name"],
            kind=source_kind,
            clock_skew_ms=0,
        )

        a_observar: list[dict[str, Any]] = []
        a_marcar: list[tuple[UUID, Any, str]] = []
        sin_resolver: dict[str, int] = {}
        por_hueco = 0
        for c in candidatas:
            codigo = c["text_value"]
            hueco = huecos.get(codigo)
            nodo = hueco["rack_id"] if hueco else mapa.get(codigo)
            if nodo is None:
                sin_resolver[codigo] = sin_resolver.get(codigo, 0) + 1
                continue
            if hueco:
                por_hueco += 1
            a_observar.append(
                {
                    "rack_node_id": nodo,
                    "observed_at": c["observed_at"],
                    "confidence": c["confidence"],
                    "frame_ref": c["frame_ref"],
                    "frame_ms": c["frame_ms"],
                    #  El hueco exacto va en la nota. La observación se ata al rack porque
                    #  es lo que el esquema admite, pero perder el `-N01-2` sería tirar la
                    #  única parte que el QR aporta sobre una lectura de rack.
                    "notes": (
                        f"deteccion {c['id']} del trabajo {job_id}"
                        + (f" · hueco {codigo} ({hueco['location_id']})" if hueco else "")
                    ),
                }
            )
            a_marcar.append((UUID(str(c["id"])), c["observed_at"], nodo))

        creadas = await self._obs.insert_observations(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            source_id=UUID(str(fuente["id"])),
            items=a_observar,
        )
        marcadas = await self._repo.mark_matched(job_id=job_id, pares=a_marcar)

        return {
            "source_code": source_code,
            "source_id": fuente["id"],
            "candidates": len(candidatas),
            "observations_created": creadas,
            "matched": marcadas,
            #  De las casadas, cuantas lo hicieron contra un HUECO concreto y no solo
            #  contra el rack. Es lo que distingue «se vio algo en el rack 47» de «se
            #  leyo el hueco RCL47-C018-N01-2», y la pantalla debe poder decirlo.
            "matched_locations": por_hueco,
            # Ordenado por número de lecturas: el código que el modelo lee cinco
            # veces y el catálogo no conoce es más interesante que el que leyó una.
            "unresolved": [
                {"text": t, "readings": n}
                for t, n in sorted(sin_resolver.items(), key=lambda x: (-x[1], x[0]))
            ],
        }

    async def unmatched(self, warehouse_id: UUID) -> dict[str, Any]:
        filas = await self._repo.unmatched_texts(warehouse_id)
        return {
            "items": filas,
            "total_readings": sum(int(f["lecturas"]) for f in filas),
        }

    # ── Auxiliares ─────────────────────────────────────────────────────────
    async def _model_label(self, model_version_id: UUID) -> str:
        """Nombre y versión del modelo, para congelarlos en el trabajo.

        Si la versión no está publicada, no se puede ejecutar: mejor un 422 al crear
        que un trabajo que apunta a un modelo que nadie declaró utilizable.
        """
        modelos = await self._repo.published_models()
        for m in modelos:
            if str(m["model_version_id"]) == str(model_version_id):
                return f"{m['name']} v{m['version']}"
        raise BusinessRuleError(
            f"la version de modelo {model_version_id} no esta publicada: solo se "
            "pueden ejecutar versiones publicadas"
        )

    @staticmethod
    def _frames_a_analizar(
        *, duration_ms: int | None, total_frames: int | None, fps: float | None
    ) -> int:
        """Cuántos fotogramas se van a analizar, para la barra de progreso.

        Con duración y muestreo, es la multiplicación. Sin duración se usa el total
        del vídeo, y sin ninguna de las dos se devuelve 1 —no se inventa un total,
        porque una barra sobre un total inventado avanza a una velocidad que no es la
        real y termina antes o después de lo que dice—.
        """
        if duration_ms and fps:
            return max(1, round((duration_ms / 1000.0) * fps))
        if total_frames:
            return total_frames
        return 1

    @staticmethod
    def sha256_de(datos: bytes) -> str:
        """Hash de un contenido. Aquí para que el importador y las pruebas
        coincidan con lo que la base espera —64 hex en minúscula, ver el CHECK—."""
        return hashlib.sha256(datos).hexdigest()

    # ══════════════════════════════════════════════════════════════════════
    # REGISTRO DE WORKERS (0075)
    # ══════════════════════════════════════════════════════════════════════

    async def worker_heartbeat(
        self,
        *,
        kind: str,
        name: str,
        capabilities: list[str],
        agent_version: str | None,
        device: str | None,
        current_job: UUID | None,
    ) -> dict[str, Any]:
        """Registra el worker o refresca su latido, y devuelve su fila con `alive`.

        Se devuelve `alive: True` sin consultarlo: acabamos de escribir `now()` en
        `last_seen_at`, así que la ventana de 90 s lo cubre por construcción. Volver a
        preguntárselo a la base sería una segunda ida y vuelta para confirmar lo que la
        primera acaba de hacer.
        """
        fila = await self._workers.latir(
            tenant_id=self._ctx.tenant_id,
            kind=kind,
            name=name,
            capabilities=capabilities,
            agent_version=agent_version,
            device=device,
            current_job=current_job,
        )
        return {**fila, "alive": True, "seconds_since": 0}

    async def list_workers(self, kind: str | None) -> dict[str, Any]:
        """Los workers registrados, con cuántos están vivos.

        `alive` se cuenta aquí y no se deja al cliente: es la cifra que decide si la
        cola va a avanzar, y calcularla en tres pantallas distintas daría tres formas
        de contar lo mismo.
        """
        workers = await self._workers.listar(kind)
        return {"workers": workers, "alive": sum(1 for w in workers if w["alive"])}

    async def delete_worker(self, worker_id: UUID) -> None:
        if await self._workers.retirar(worker_id) == 0:
            raise NotFoundError(f"worker {worker_id} no encontrado")

    # ══════════════════════════════════════════════════════════════════════
    # LOS BYTES DEL MEDIO (0076)
    #
    # Hasta 0076 el navegador mandaba solo metadatos y los bytes se quedaban en la
    # pestaña. Un worker no puede analizar un vídeo que no existe, así que este es el
    # eslabón entre «Nueva inspección» y `tools/inferir.py`.
    #
    # Tres pasos, como en `ai_assets`: preparar, subir directo, confirmar al crear el
    # trabajo. El binario NO atraviesa el backend —400 MB por el proceso web solo para
    # reenviarlos gastaría memoria sin añadir nada— y la ruta la genera SIEMPRE el
    # servidor.
    # ══════════════════════════════════════════════════════════════════════

    def _exige_storage(self) -> StorageClient:
        if self._storage is None:
            raise BusinessRuleError(
                "Esta operacion necesita credenciales de Storage y el servicio se "
                "construyo sin ellas."
            )
        return self._storage

    async def prepare_media_upload(
        self,
        *,
        warehouse_id: UUID,
        original_filename: str,
        content_type: str,
        byte_count: int,
    ) -> dict[str, Any]:
        """Reserva un sitio en el bucket y devuelve dónde subir.

        El `media_id` se genera AQUÍ y viaja al cliente porque la ruta se deriva de él.
        Al confirmar, el servidor recalcula la ruta con el mismo id, tipo y nombre: así
        no hay forma de subir a un sitio y reclamar otro.

        No se escribe ninguna fila todavía. Una fila de medio sin bytes es basura si la
        subida se abandona a medias —y se abandona, con 400 MB por una red de almacén—.
        La fila se crea al crear el trabajo, cuando ya se ha comprobado que el objeto
        está.
        """
        motivo = validar_medio(content_type, byte_count)
        if motivo:
            raise BusinessRuleError(motivo)

        if not await can_access_warehouse(self._session, warehouse_id):
            # Se comprueba aquí y no solo en la política de Storage: sin esto el
            # operador recibiría un fallo de subida opaco en lugar de un 403 que dice
            # que ese almacén no es suyo.
            raise ForbiddenError("No tienes acceso a ese almacen")

        media_id = uuid4()
        path = ruta_canonica(
            self._ctx.tenant_id, warehouse_id, media_id, content_type, original_filename
        )
        return {
            "media_id": media_id,
            "bucket": BUCKET,
            "object_path": path,
            "upload_url": self._exige_storage().upload_endpoint(BUCKET, path),
        }

    async def crop_prefix(self, job_id: UUID) -> dict[str, Any]:
        """Donde el worker deja los recortes de ESTE trabajo (0091).

        ── POR QUE LO DA EL SERVIDOR Y NO SE LO INVENTA EL WORKER ────────────────

        Misma regla que la subida del medio: la ruta la genera SIEMPRE el servidor. El
        worker solo anade el nombre del archivo dentro del prefijo, asi que no hay forma de
        subir al almacen de otro tenant aunque el proceso corra en una maquina cualquiera.

        Se pide UNA vez por trabajo y no una por recorte: un video de cinco minutos deja
        miles, y pedir una URL para cada uno serian miles de idas y vueltas al backend
        antes de subir un solo byte.

        El binario NO pasa por aqui: el worker sube directo a Storage con su propio token,
        igual que el navegador.

        ── POR QUE NO HAY UNA CARPETA `recortes/` ────────────────────────────────

        Porque el bucket exige CUATRO segmentos exactos —`core.perception_media_path_ok`—
        y anadir una carpeta hacian cinco. La regla no es un detalle: con mas de cuatro,
        un `a/b/c/d/../../otro` navegaria fuera de su prefijo, y por eso la funcion los
        cuenta en vez de confiar en el nombre.

        Costo un analisis entero con las subidas rechazadas de una en una: el prefijo se
        pedia bien, se subia, y Storage devolvia «new row violates row-level security
        policy» por cada recorte. Asi que la separacion va en el NOMBRE, no en la ruta.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        warehouse_id = UUID(str(job["warehouse_id"]))
        if not await can_access_warehouse(self._session, warehouse_id):
            raise ForbiddenError("No tienes acceso a ese almacen")

        prefijo = prefijo_de_recortes(self._ctx.tenant_id, warehouse_id, job_id)
        return {
            "bucket": BUCKET,
            "prefix": prefijo,
            #  La base para el PUT. El worker compone `{upload_base}/{prefix}/{nombre}`.
            "upload_base": self._exige_storage().upload_endpoint(BUCKET, "").rstrip("/"),
        }

    async def crop_url(self, job_id: UUID, path: str, expires_in: int = 3600) -> str:
        """URL firmada de UN recorte/fotograma ya subido (ver `crop_prefix`).

        Valida que `path` pertenezca de verdad a ESTE trabajo antes de firmar
        nada -- sin esto, cualquiera con `perception:read` podria pedir la
        firma de una ruta ajena con solo adivinarla (el bucket es uno solo
        para todo el tenant, no uno por trabajo).
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        warehouse_id = UUID(str(job["warehouse_id"]))
        prefijo = prefijo_de_recortes(self._ctx.tenant_id, warehouse_id, job_id)
        if not path.startswith(f"{prefijo}/"):
            raise ForbiddenError("Esa ruta no pertenece a este trabajo")
        return await self._exige_storage().sign_download(BUCKET, path, expires_in)

    async def media_download_url(self, job_id: UUID, expires_in: int = 3600) -> str:
        """URL firmada del medio de un trabajo. La pide el worker para descargarlo.

        Una hora de vida: un vídeo de 1 GB por la red de un almacén tarda, y una firma
        que caduca a mitad de la descarga deja el trabajo fallando por algo que no
        tiene nada que ver con el modelo.
        """
        medio = await self._repo.media_de_trabajo(job_id)
        if medio is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        if not medio.get("bucket") or not medio.get("object_path"):
            raise BusinessRuleError(
                "Este trabajo no tiene bytes que analizar: su medio se registro solo "
                "con metadatos, antes de que existiera la subida de archivos. Vuelve a "
                "crear la inspeccion subiendo el archivo."
            )
        return await self._exige_storage().sign_download(
            str(medio["bucket"]), str(medio["object_path"]), expires_in
        )

    async def preview_download_url(self, job_id: UUID, expires_in: int = 3600) -> str:
        """URL firmada de la COPIA LIGERA, la que el navegador si puede reproducir.

        Separado de `media_download_url` a proposito: son dos archivos con dos usos que
        no se pueden confundir. El original es lo que analiza el worker y lo que hay que
        conservar intacto; la copia es 720p H.264 y no sirve para leer un codigo.

        Un 422 y no un 404 si no hay copia: el trabajo existe y su video tambien. Lo que
        no hay es la copia, y decir «no encontrado» mandaria a buscar el problema al sitio
        equivocado.
        """
        copia = await self._repo.copia_para_ver(job_id)
        if copia is None:
            trabajo = await self._repo.get_job(job_id)
            if trabajo is None:
                raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
            raise BusinessRuleError(
                "Este trabajo no tiene copia para ver. La genera el worker al analizar, "
                "y necesita ffmpeg: si el worker no lo tiene, el analisis se hace igual "
                "pero el video no se puede reproducir en el navegador."
            )
        bucket, ruta = copia
        return await self._exige_storage().sign_download(bucket, ruta, expires_in)

    async def registrar_copia_para_ver(self, *, job_id: UUID, path: str) -> dict[str, Any]:
        """Anota que hay una copia ligera. Lo llama el worker despues de subirla."""
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError("Ese trabajo no existe.", resource_id=str(job_id))
        media_id = job.get("media_id")
        if media_id is None:
            raise BusinessRuleError("Ese trabajo no tiene material del que hacer copia.")
        tocadas = await self._repo.fijar_copia_para_ver(UUID(str(media_id)), path)
        return {"media_id": media_id, "preview_path": path, "cambio": tocadas > 0}

    # ══════════════════════════════════════════════════════════════════════
    # QUITAR UNA INSPECCIÓN DE EN MEDIO
    #
    # Se sube un vídeo, la inspección se queda sin analizar —hoy no hay modelo
    # publicado que lea códigos de hueco— y los bytes se quedan en Storage para
    # siempre. Sin forma de quitarlas, se acumulan.
    #
    # Pero no todas se pueden borrar: de algunas cuelga trabajo que nadie puede
    # reconstruir. La decisión NO la toma quien pulsa el botón, la toma el dato.
    # ══════════════════════════════════════════════════════════════════════
    async def puede_borrarse(self, job_id: UUID) -> dict[str, Any]:
        """Si esta inspección se puede borrar, y si no, por qué no.

        Devuelve los tres recuentos además del veredicto: un «no se puede» a secas
        deja a quien lo lee con la misma pregunta con la que llegó.
        """
        trabajo = await self._repo.get_job(job_id)
        if trabajo is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        enlaces = await self._repo.enlaces(job_id)
        #  El estado entra en el veredicto, y no solo en `borrar_trabajo`: si la pantalla
        #  no lo sabe, ensena el boton habilitado y el borrado falla al pulsarlo. Dos
        #  reglas para la misma decision se separan siempre — y esta ya costo un analisis
        #  de una hora—.
        en_marcha = str(trabajo.get("status") or "") in ("queued", "running")
        return {
            **enlaces,
            "borrable": sum(enlaces.values()) == 0 and not en_marcha,
            "archivada": trabajo.get("archived_at") is not None,
            "en_marcha": en_marcha,
        }

    async def archivar_trabajo(self, job_id: UUID, *, actor: UUID | None) -> None:
        """Saca la inspección de la lista y conserva todo lo demás.

        ⚠ NO libera Storage. Es el precio de no destruir lo que cuelga de ella, y la
        interfaz tiene que decirlo: alguien que archiva para hacer sitio se llevaría
        una sorpresa.
        """
        if await self._repo.get_job(job_id) is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        await self._repo.archivar(job_id, actor=actor)

    async def desarchivar_trabajo(self, job_id: UUID) -> None:
        if await self._repo.get_job(job_id) is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        await self._repo.desarchivar(job_id)

    async def borrar_trabajo(self, job_id: UUID) -> dict[str, Any]:
        """Borra la inspección y, si nadie más lo usa, su objeto de Storage.

        ── EL ORDEN IMPORTA, Y ESTE ES EL BUENO ──────────────────────────────────

        Primero la base, después Storage. Al revés, un fallo al borrar la fila dejaría
        una inspección viva apuntando a bytes que ya no están: se vería en la lista,
        se abriría, y el reproductor daría un error que nadie sabría explicar.

        En este orden el peor caso es un objeto huérfano en Storage —espacio que no se
        recupera— y eso se puede medir y limpiar después. Se informa en la respuesta
        (`storage_liberado`) en vez de callarlo.

        ── EL MEDIO PUEDE ESTAR COMPARTIDO ───────────────────────────────────────

        `uq_media_hash` deduplica por hash: subir dos veces el mismo archivo reutiliza
        la fila de medio. Si otra inspección lo usa, el objeto NO se toca — borrarlo la
        dejaría sin bytes sin que nadie lo notara hasta intentar reproducirla.
        """
        trabajo = await self._repo.get_job(job_id)
        if trabajo is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")

        #  ── UN TRABAJO EN MARCHA NO SE BORRA ──────────────────────────────────
        #
        #  Paso de verdad: se borro una inspeccion desde la pantalla mientras el worker la
        #  analizaba. El worker siguio UNA HORA fallando en cada volcado con un 404 y
        #  guardando cero, y el analisis entero se perdio. Ahora el worker corta en el
        #  primer 404, pero lo que hay que evitar es llegar ahi.
        #
        #  `queued` tambien: puede haber un worker que acabe de cogerlo y todavia no lo
        #  haya movido a `running`, y el hueco entre los dos estados es de segundos.
        #
        #  La salida existe y esta en el mensaje: cancelar primero. No se bloquea a nadie,
        #  se le pide un paso mas para lo que es irreversible.
        estado = str(trabajo.get("status") or "")
        if estado in ("queued", "running"):
            raise BusinessRuleError(
                f"Esta inspeccion esta {estado}: puede haber un worker analizandola ahora "
                "mismo, y borrarla tira su trabajo sin avisarle. Cancelala primero y "
                "vuelve a borrarla."
            )

        enlaces = await self._repo.enlaces(job_id)
        if sum(enlaces.values()) > 0:
            raise BusinessRuleError(
                "De esta inspeccion cuelga trabajo que no se puede reconstruir: "
                f"{enlaces['incidencias']} incidencia(s) abiertas desde ella, "
                f"{enlaces['promovidas']} deteccion(es) promovidas a observaciones de "
                f"rack y {enlaces['revisadas']} revisada(s) por una persona. "
                "Archivala en su lugar: sale de la lista y el rastro se queda. Eso NO "
                "libera su espacio en Storage."
            )

        media_id = UUID(str(trabajo["media_id"]))
        medio = await self._repo.media_de_trabajo(job_id)
        compartido = await self._repo.otros_trabajos_del_medio(media_id, job_id)

        # 1 · La base. La cascada se lleva detecciones y eventos.
        if await self._repo.borrar_trabajo(job_id) == 0:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")

        liberado = 0
        if compartido == 0:
            await self._repo.borrar_medio(media_id)
            # 2 · Y los bytes, si los había. Un medio registrado sin subida —lo que
            #     pasaba antes de 0076— no tiene objeto que borrar.
            bucket = (medio or {}).get("bucket")
            ruta = (medio or {}).get("object_path")
            if bucket and ruta:
                try:
                    await self._exige_storage().delete(str(bucket), [str(ruta)])
                    liberado = int((medio or {}).get("bytes") or 0)
                except StorageError:
                    # Se traga A PROPOSITO: la fila ya no esta y reventar aqui daria un
                    # 500 sobre una operacion que en lo esencial funciono. Lo que no se
                    # hace es mentir: `storage_liberado` se queda en 0 y la respuesta
                    # dice que el objeto sigue ahi.
                    liberado = 0

        return {
            "storage_liberado": liberado,
            "medio_compartido": compartido > 0,
            "bytes_del_medio": int((medio or {}).get("bytes") or 0),
        }

    # ══════════════════════════════════════════════════════════════════════
    # EL PUENTE AL WMS
    #
    # `promote_to_observations` responde «¿este codigo existe como rack?». Esto responde
    # la pregunta que un operador hace de verdad: «¿lo que hay en el hueco es lo que el
    # WMS dice que hay?».
    #
    # Son DOS puentes distintos y los dos hacen falta. El primero da la RUTA sobre el
    # plano —donde estuvo el drone—; este da la DISCREPANCIA —que no cuadra y donde—.
    # ══════════════════════════════════════════════════════════════════════

    async def reconcile_job(
        self, *, job_id: UUID, source: str = "drone", notes: str | None = None
    ) -> dict[str, Any]:
        """Convierte las detecciones de un trabajo en lecturas y las reconcilia.

        Exige el trabajo `completed`, igual que `promote`: las detecciones de un trabajo
        que sigue corriendo todavia pueden cambiar, y una lectura es un hecho.

        NO es idempotente y es deliberado: cada llamada crea un `scan` nuevo. Dos
        reconciliaciones del mismo vuelo son dos recorridos distintos —quiza con otro
        corte del WMS de por medio— y machacar el anterior perderia la comparacion. Lo
        que si se puede es mirar los dos y ver que cambio.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        if job["status"] != "completed":
            raise ConflictError(
                f"un trabajo en '{job['status']}' no se reconcilia: sus detecciones "
                "todavia pueden cambiar, y una lectura es un hecho"
            )

        warehouse_id = UUID(str(job["warehouse_id"]))

        # Todas las detecciones, en paginas grandes: es una operacion de lote.
        detecciones: list[dict[str, Any]] = []
        pagina = 1
        while True:
            items, total = await self._repo.list_detections(
                job_id=job_id, offset=(pagina - 1) * 500, limit=500
            )
            detecciones.extend(items)
            if pagina * 500 >= total:
                break
            pagina += 1

        if not detecciones:
            raise BusinessRuleError(
                "este trabajo no tiene detecciones que reconciliar: analizalo primero "
                "con `tools/inferir.py`"
            )

        #  El patron de los codigos de pallet sale de la CONFIGURACION, no de una
        #  constante: en este almacen empiezan por `22` y una letra, y en el siguiente no.
        #  Se lee con `get_settings()` —cacheado— y no por parametro porque los veinte
        #  sitios que construyen este servicio no tienen por que conocerlo.
        #  QUE CODIGOS EXISTEN, ANTES DE CONVERTIR.
        #
        #  El puente lo necesita para no dejar que una etiqueta que el catalogo no tiene le
        #  robe la escena a una que si —ver la nota larga en `lectura.convertir`—. Se
        #  preguntan solo los codigos LEIDOS, que son un punado, no las 29.310 ubicaciones
        #  del almacen: una consulta con `= ANY` y unos pocos valores.
        leidos = {
            t
            for t in (
                str(d.get("text_value")).strip().upper()
                for d in detecciones
                if d.get("text_value")
            )
            if es_codigo_de_ubicacion(t)
        }
        catalogo = set(
            (
                await self._repo.resolve_location_codes(
                    warehouse_id=warehouse_id, codes=sorted(leidos)
                )
            ).keys()
        )

        resumen = convertir(
            detecciones,
            patron_pallet=get_settings().patron_codigo_pallet,
            ubicaciones_conocidas=catalogo,
        )
        if not resumen.lecturas:
            raise BusinessRuleError(
                f"las {len(detecciones)} detecciones no describen ningun hueco: "
                "ninguna es de las clases que el puente entiende "
                "(qr_ubicacion, qr_pallet, pallet, hueco_vacio, etiqueta_ilegible)"
                + (
                    f". Clases detectadas: {', '.join(sorted(resumen.clases_desconocidas))}"
                    if resumen.clases_desconocidas
                    else ""
                )
            )

        corte = await self._repo.ultimo_corte_wms(warehouse_id)

        scan_id = await self._repo.crear_scan(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            wms_snapshot_id=corte,
            model_version_id=(
                UUID(str(job["model_version_id"])) if job.get("model_version_id") else None
            ),
            source=source,
            notes=notes or f"Reconciliacion del trabajo «{job['name']}»",
        )

        insertadas = await self._repo.insertar_lecturas(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            scan_id=scan_id,
            filas=[
                {
                    "location_code_observed": lect.location_code_observed,
                    "location_qr": lect.location_qr,
                    "location_confidence": lect.location_confidence,
                    "content": lect.content,
                    "content_confidence": lect.content_confidence,
                    "pallet_qr": lect.pallet_qr,
                    "pallet_code_observed": lect.pallet_code_observed,
                    "pallet_confidence": lect.pallet_confidence,
                    "bbox": lect.bbox,
                    "observed_at": lect.observed_at,
                    "frame_ms": lect.frame_ms,
                    "crop_location_path": lect.crop_location_path,
                    "crop_content_path": lect.crop_content_path,
                    "crop_pallet_path": lect.crop_pallet_path,
                }
                for lect in resumen.lecturas
            ],
        )
        await self._repo.cerrar_scan(scan_id, estado="done")

        return {
            "scan_id": str(scan_id),
            "wms_snapshot_id": str(corte) if corte else None,
            # Sin corte del WMS las lecturas se guardan pero no hay «esperado» con el
            # que contrastar. Se dice: una reconciliacion vacia sin explicacion se lee
            # como «todo cuadra», que es la conclusion contraria a la correcta.
            "warning": (
                None
                if corte
                else (
                    "Este almacen no tiene ningun corte del WMS importado, asi que las "
                    "lecturas se guardaron pero no hay con que compararlas. Importa un "
                    "corte y vuelve a reconciliar."
                )
            ),
            "detections": len(detecciones),
            "readings": insertadas,
            "empty_frames": resumen.fotogramas_vacios,
            "discarded_texts": resumen.textos_descartados,
            "ambiguous_scenes": resumen.escenas_ambiguas,
            "unknown_classes": sorted(resumen.clases_desconocidas),
            #  Etiquetas de hueco leidas BIEN que el catalogo no tiene. Van aparte de todo lo
            #  demas porque piden una accion propia —dar de alta la ubicacion o corregir la
            #  etiqueta— y porque son un hallazgo del recorrido, no un fallo de captura.
            "unknown_locations": sorted(resumen.ubicaciones_desconocidas),
            "summary": await self._repo.resumen_reconciliacion(scan_id),
            "rows": await self._filas_para_pantalla(await self._repo.reconciliacion(scan_id)),
        }

    async def reconciliation(self, scan_id: UUID) -> dict[str, Any]:
        """El resultado de una reconciliacion ya hecha."""
        return {
            "scan_id": str(scan_id),
            "summary": await self._repo.resumen_reconciliacion(scan_id),
            "rows": await self._filas_para_pantalla(await self._repo.reconciliacion(scan_id)),
        }

    async def _filas_para_pantalla(self, filas: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Una fila por HALLAZGO, con su foto.

        ── LAS REPETIDAS SE JUNTAN ───────────────────────────────────────────────

        Un directo ve la misma etiqueta durante muchos segundos, y cada escena es una
        lectura: `RCL50-C001-N03-2 · pallet · …` aparecia diez veces identica. Diez filas
        iguales no dicen mas que una; esconden las demas. Se juntan las que dicen
        EXACTAMENTE lo mismo (hueco, contenido, pallet y resultado) y se cuenta cuantas
        veces se vio (`times_seen`). Se queda la mas reciente. Las lecturas en
        `inventory.readings` no se tocan: esto es solo la vista.

        ── LA FOTO SE FIRMA AQUI ─────────────────────────────────────────────────

        La ruta es permanente, la firma caduca en una hora: se firma al pedirla. Sin
        credenciales de Storage las URLs van a `None` y la fila sigue valiendo.
        """
        juntas: dict[tuple[Any, ...], dict[str, Any]] = {}
        for f in filas:  # ya vienen de la mas reciente a la mas vieja por hueco
            clave = (
                f.get("location_code"),
                f.get("content"),
                f.get("pallet_code_observed"),
                f.get("status"),
            )
            if clave in juntas:
                previa = juntas[clave]
                previa["times_seen"] += 1
                #  Si la mas reciente no tenia foto y esta si, se usa la foto de esta.
                for campo in ("crop_location_path", "crop_content_path", "crop_pallet_path"):
                    if not previa.get(campo) and f.get(campo):
                        previa[campo] = f[campo]
                continue
            juntas[clave] = {**f, "times_seen": 1}

        unicas = list(juntas.values())
        almacen = self._storage
        limite = asyncio.Semaphore(8)

        async def firmar(f: dict[str, Any]) -> dict[str, Any]:
            salida = dict(f)
            for campo, destino in (
                ("crop_location_path", "crop_location_url"),
                ("crop_content_path", "crop_content_url"),
                ("crop_pallet_path", "crop_pallet_url"),
            ):
                ruta = salida.pop(campo, None)
                url = None
                if ruta and almacen is not None:
                    async with limite:
                        try:
                            url = await almacen.sign_download(BUCKET, ruta, 3600)
                        except StorageError:
                            url = None
                salida[destino] = url
            return salida

        return list(await asyncio.gather(*(firmar(f) for f in unicas)))

    # ══════════════════════════════════════════════════════════════════════
    # DE HALLAZGO A TRABAJO: LAS INCIDENCIAS DE UNA RECONCILIACION
    #
    # Sin esto, la app ENCUENTRA y no pasa nada. La discrepancia vive en una
    # pantalla, nadie la recibe, nadie la cierra, y el recorrido siguiente no sabe
    # que existio. Es la diferencia entre una demo y una operacion.
    #
    # La tabla `incidents.incidents` ya tenia `kind = 'reconciliation'` y
    # `source_job_id` desde el principio, sin nadie que los escribiera. Esto es ese
    # escritor.
    # ══════════════════════════════════════════════════════════════════════

    #: Que estados MERECEN una incidencia. Vive en el dominio y no aqui porque la MISMA
    #: lista decide, en la pantalla del mapa, si algo se dio por resuelto. Separadas, un
    #: estado nuevo abriria incidencia y el mapa la daria por resuelta al vuelo siguiente
    #: — y nadie lo veria hasta que un operario cierra algo que no estaba arreglado.
    #:
    #: Lo que NO entra es lo que no se pudo VER: pide volver a grabar, no ir al pasillo.
    #: Ver la nota larga de `olo.domain.inspeccion`.

    async def abrir_incidencias(self, *, scan_id: UUID, actor: UUID) -> dict[str, Any]:
        """Convierte las discrepancias de un recorrido en incidencias con su prueba.

        ── LO QUE SE GUARDA, Y POR QUE ───────────────────────────────────────────

        Cada incidencia lleva en `details` los dos lados de la comparacion —lo que se leyo
        y lo que el WMS declara— y de que recorrido salio. Sin eso, una incidencia de hace
        un mes es «algo no cuadraba en RCL47-C018-N01-2», que no se puede ni comprobar ni
        discutir. Con eso, quien la abre sabe que fue a buscar antes de subir al pasillo.

        `source_snapshot_id` guarda CUAL foto del WMS se estaba mirando: «el WMS decia otra
        cosa» depende de eso, y el corte se sustituye cada vez que se importa uno nuevo.

        ── REPETIR LA LLAMADA NO DUPLICA ─────────────────────────────────────────

        Un hueco que ya tiene una incidencia abierta se SALTA y se cuenta aparte. Es lo
        contrario de fallar: reconciliar dos veces el mismo vuelo es normal, y que la
        segunda reviente a mitad dejaria la bandeja a medio llenar sin decirlo.
        """
        recorrido = await self._repo.scan(scan_id)
        if recorrido is None:
            raise NotFoundError(f"recorrido {scan_id} no encontrado")

        warehouse_id = UUID(str(recorrido["warehouse_id"]))
        filas = await self._repo.reconciliacion(scan_id)
        accionables = [f for f in filas if f["status"] in ESTADOS_ACCIONABLES]

        incidencias = IncidentRepository(self._session)
        abiertas = await incidencias.abiertas_por_ubicacion(warehouse_id)

        creadas: list[str] = []
        saltadas: list[str] = []
        for f in accionables:
            codigo = f.get("location_code")
            if codigo and codigo in abiertas:
                #  Ya hay una abierta para ese hueco: se salta y se dice. Dos incidencias
                #  del mismo problema convierten la bandeja en una lista de clics.
                saltadas.append(str(codigo))
                continue

            titulo, explica = ESTADOS_ACCIONABLES[f["status"]]
            leido = f.get("pallet_code_observed")
            declarados = f.get("expected_pallets") or []
            #  El detalle se arma como LINEAS y se une: es lo que va a leer una persona
            #  con el movil en el pasillo, y ahi la diferencia entre un parrafo y cuatro
            #  lineas es si lo lee o no.
            lineas = [
                explica,
                "",
                "Observado: "
                + str(f.get("content"))
                + (f", pallet leido {leido}" if leido else ", sin identificar el pallet"),
                (
                    "El WMS declara: " + ", ".join(declarados)
                    if declarados
                    else "El WMS no declara nada aqui."
                ),
                "",
                f"Recorrido {scan_id}.",
            ]
            detalle = "\n".join(lineas)

            nueva = await incidencias.abrir(
                {
                    "warehouse_id": str(warehouse_id),
                    "location_id": f.get("location_id"),
                    "location_code": codigo,
                    "kind": "reconciliation",
                    #  El estado de la vista se guarda tal cual: es el vocabulario con el
                    #  que se clasifico, y traducirlo aqui perderia la trazabilidad.
                    "subkind": f["status"],
                    "title": f"{titulo} en {codigo or 'hueco sin identificar'}",
                    "details": detalle,
                    "source_snapshot_id": recorrido.get("wms_snapshot_id"),
                },
                actor=actor,
            )
            await incidencias.anotar(
                nueva, desde=None, hasta="open", nota=detalle, actor=actor
            )
            creadas.append(str(nueva))
            if codigo:
                abiertas[codigo] = str(nueva)

        return {
            "scan_id": str(scan_id),
            "created": len(creadas),
            "skipped": len(saltadas),
            "skipped_locations": sorted(set(saltadas)),
            "incident_ids": creadas,
            #  Cuantas filas del recorrido eran accionables, para que la pantalla pueda
            #  decir «de 8 lecturas, 1 genera trabajo» en vez de un numero suelto.
            "actionable_rows": len(accionables),
            "total_rows": len(filas),
        }

    # ══════════════════════════════════════════════════════════════════════
    # DIRECTOS (0078)
    #
    # Un directo es el MISMO trabajo de inferencia, con dos diferencias:
    #
    #   · su medio es una URL, no un archivo. No hay bytes ni hash.
    #   · `frames_total` es NULL —no se sabe cuantos son— asi que la pantalla cuenta
    #     en vez de calcular un porcentaje.
    #
    # Lo demas es igual a proposito: mismas detecciones, mismas revisiones, mismo puente
    # al WMS. Un modelo aparte para directos habria duplicado los cuatro.
    # ══════════════════════════════════════════════════════════════════════

    async def start_live(
        self,
        *,
        warehouse_id: UUID,
        name: str,
        stream_url: str,
        pipeline: str,
        model_version_id: UUID | None,
        confidence_threshold: float,
        frame_sampling_rate: float,
        notes: str | None,
        origin: str = "stream",
        reservado: bool = False,
    ) -> dict[str, Any]:
        """Abre una sesion en directo. `origin='stream'`: la deja LISTA para que un
        worker la coja. `origin='edge_device'` (0109): el dispositivo YA corrio el
        modelo -- ver `repositories.list_jobs`, que excluye estos trabajos del sondeo
        de un worker (`status=queued`), porque no hay nada que ningun worker pueda
        abrir en `stream_url` para ellos.

        El esquema de la URL se comprueba aqui: `rtmp://`, `rtsp://` o `http(s)://`. Sin
        eso, un `file:///c:/algo` haria que el worker leyera el disco de la maquina que
        lo ejecuta creyendo abrir una camara —y no fallaria, devolveria fotogramas—.
        """
        if not stream_url.startswith(("rtmp://", "rtmps://", "rtsp://", "http://", "https://")):
            raise BusinessRuleError(
                "La URL del directo tiene que ser rtmp://, rtsp:// o http(s)://. Un "
                "esquema como `file://` haria que el worker leyera su propio disco."
            )

        medio = await self._repo.upsert_stream(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            stream_url=stream_url,
            nombre=name,
        )

        # Y ahora la comprobacion que el indice de 0078 NO hace. Ese protege el MEDIO;
        # dos sesiones sobre la misma camara comparten fila de medio —el `ON CONFLICT`
        # la reutiliza— y crearian dos TRABAJOS. Dos workers leyendo el mismo stream
        # duplicarian cada deteccion, y el inventario contaria doble.
        vivo = await self._repo.directo_activo(UUID(str(medio["id"])))
        if vivo is not None:
            raise ConflictError(
                f"Ya hay un directo abierto sobre esa URL: «{vivo['name']}» "
                f"({vivo['status']}). Cierralo antes de abrir otro, o dos workers "
                "leerian la misma camara y cada deteccion entraria dos veces."
            )

        etiqueta = None
        if model_version_id is not None:
            etiqueta = await self._model_label(model_version_id)

        job = await self._repo.create_job(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            media_id=UUID(str(medio["id"])),
            name=name,
            pipeline=pipeline,
            model_version_id=model_version_id,
            model_label=etiqueta,
            confidence_threshold=confidence_threshold,
            frame_sampling_rate=frame_sampling_rate,
            save_detected_frames=False,
            notes=notes,
            # NULL = no se sabe cuantos fotogramas son. Ver 0078.
            frames_total=None,
            origin=origin,
        )

        # Del estado inicial a `queued` en un paso: en un directo no hay nada que subir,
        # asi que `uploading`/`uploaded` no describen nada. Dejarlo en `draft` obligaria
        # a un segundo clic para algo que no tiene decision intermedia.
        for destino in ("uploading", "uploaded", "queued"):
            await self._repo.update_status(job_id=UUID(str(job["id"])), to_status=destino)

        #  `reservado`: el directo lo abre quien YA tiene un worker dedicado esperandolo
        #  (`tools/rtmp/directo_auto.py`, que lanza `inferir.py --job <id>` en la misma
        #  maquina que recibe el stream). Pasa a `running` en esta misma transaccion, asi
        #  que nunca es visible como `queued` y ningun otro worker que sondee la cola lo
        #  reclama. Medido: un worker de OTRA maquina cogia el directo, no podia abrir
        #  `rtsp://127.0.0.1` (su localhost no tiene el stream) y lo marcaba `failed`.
        if origin == "edge_device" or reservado:
            # El filtro de `list_jobs` (0109, `origin = 'stream'` cuando se pregunta
            # por `status=queued`) NO basta por si solo: probado en vivo contra el
            # worker real del proyecto de desarrollo -- lo reclamo y lo fallo DOS
            # veces seguidas pese al filtro, asi que ese worker no descubre trabajo
            # por esa via (o no por esta version del backend). La unica garantia que
            # no depende de adivinar como sondea un worker que no se controla desde
            # aqui es que el trabajo nunca permanezca `queued` el tiempo suficiente
            # para que nadie lo lea: se avanza a `running` en el mismo paso, antes de
            # devolver la respuesta. El dispositivo ya trae sus propias detecciones
            # (`POST /jobs/{id}/detections` las acepta en 'queued' o 'running' por
            # igual), asi que saltarse el tiempo en cola no le quita nada.
            await self._repo.update_status(job_id=UUID(str(job["id"])), to_status="running")

        return {
            **(await self._repo.get_job(UUID(str(job["id"]))) or job),
            "worker_available": await self._workers.esta_vivo("inference"),
        }

    async def terminar_directo(self, job_id: UUID) -> dict[str, Any]:
        """Cierra un directo DESDE LA APP, conservando todo lo que ya se leyó.

        Es el botón «Terminar directo». Se cierra como `completed` —no `cancelled`—
        porque lo analizado hasta aquí es un resultado válido, y al completarse corre la
        resolución espacial (las ubicaciones leídas se atan a su rack). El worker lo
        nota en su siguiente envío (el backend le responde 409) y se detiene solo.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError(f"trabajo de inferencia {job_id} no encontrado")
        if not job.get("media_stream_url"):
            raise BusinessRuleError("Solo un directo se termina así; un archivo acaba solo.")
        if job["status"] not in {"queued", "running"}:
            raise ConflictError(f"Este directo ya está '{job['status']}'.")
        await self.ingest_detections(
            job_id=job_id, items=[], replace=False, mark_completed=True
        )
        return await self.get_job(job_id)

    async def hook_directo(self, evento: str) -> dict[str, Any]:
        """El servidor de video avisa: el dron CONECTO o se DESCONECTO.

        conectado     abre el directo (queda en cola; lo coge el worker que lea directos).
                      Si ya habia uno abierto sobre el canal —el dron se reconecto antes
                      de que el worker soltara el anterior— se reutiliza: el worker
                      reconecta solo dentro de su margen de 20 s.
        desconectado  si el directo seguia EN COLA (ningun worker lo cogio), se cancela
                      para que la proxima conexion no choque. Si un worker lo estaba
                      analizando, lo cierra el al dejar de recibir video.
        """
        from datetime import datetime, timedelta, timezone

        ajustes = get_settings()
        url = f"rtsp://{ajustes.media_host}:8554/{ajustes.media_path}"
        warehouse_id = ajustes.directo_warehouse_id
        if evento == "conectado":
            hora = datetime.now(timezone(timedelta(hours=-6)))  # Costa Rica, sin DST
            try:
                job = await self.start_live(
                    warehouse_id=warehouse_id,  # type: ignore[arg-type]
                    name=f"Directo dron {hora:%d/%m %H:%M}",
                    stream_url=url,
                    pipeline=ajustes.directo_pipeline,
                    model_version_id=ajustes.directo_model_version_id,
                    confidence_threshold=ajustes.directo_umbral,
                    frame_sampling_rate=ajustes.directo_fps,
                    notes="Abierto automaticamente al conectar el dron (servidor de video)",
                )
            except ConflictError:
                return {"accion": "ya_abierto"}
            return {"accion": "abierto", "job_id": str(job["id"])}

        filas = await self._repo.list_jobs(
            warehouse_id=warehouse_id, status="queued", limit=20, incluir_directos=True
        )
        for f in filas:
            if f.get("media_stream_url") == url:
                await self.change_status(
                    job_id=UUID(str(f["id"])),
                    to_status="cancelled",
                    reason="El dron se desconecto antes de que un worker abriera el directo",
                )
                return {"accion": "cancelado", "job_id": str(f["id"])}
        return {"accion": "nada"}

    async def estacion_directo(self) -> dict[str, Any]:
        """Lo que la pantalla del directo necesita: red, URL, dron y directo activo.

        Ver `olo.services.estacion_directo`. El directo activo es el trabajo con stream
        `queued`/`running` más reciente de lo que este usuario puede ver.
        """
        from olo.services.estacion_directo import leer_estacion

        maquina = await leer_estacion()
        activo = None
        for estado in ("running", "queued"):
            filas = await self._repo.list_jobs(
                warehouse_id=self._ctx.warehouse_id, status=estado, limit=20
            )
            vivo = next((f for f in filas if f.get("media_stream_url")), None)
            if vivo is not None:
                activo = {
                    "id": vivo["id"],
                    "name": vivo["name"],
                    "status": vivo["status"],
                    "detection_count": int(vivo.get("detection_count") or 0),
                    "frames_processed": int(vivo.get("frames_processed") or 0),
                }
                break
        return {
            **maquina,
            "worker_vivo": await self._workers.esta_vivo("inference"),
            "directo_activo": activo,
        }

    async def registrar_total_de_fotogramas(
        self,
        *,
        job_id: UUID,
        total_frames: int,
        frames_to_analyze: int | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, Any]:
        """Anota cuantos fotogramas tiene DE VERDAD el video de un trabajo.

        Lo manda el worker, que es el unico que lo sabe: los recorre todos para
        analizarlos. El navegador no puede saberlo al subir —no hay API que lo diga— y por
        eso `total_frames` venia nulo, y con el nulo se perdia la cadencia real.

        Se guarda en el MEDIO y no en el trabajo: es una propiedad del archivo, no del
        analisis. Dos inspecciones del mismo video comparten el recuento.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError("Ese trabajo no existe.", resource_id=str(job_id))
        media_id = job.get("media_id")
        if media_id is None:
            raise BusinessRuleError("Ese trabajo no tiene material del que contar nada.")
        if job.get("media_kind") != "video":
            #  Una foto tiene un fotograma y un directo no tiene final: en ninguno de los
            #  dos casos un recuento significa algo.
            raise BusinessRuleError(
                "Solo un video tiene un numero de fotogramas que contar."
            )

        tocadas = await self._repo.fijar_total_de_fotogramas(
            media_id, total_frames, ancho=width, alto=height
        )

        #  Y de paso, cuantos va a analizar ESTE trabajo. Es otra cosa que el recuento del
        #  medio —634 fotogramas de los que se muestrean 212— y va al trabajo porque
        #  depende del muestreo que eligio quien lo lanzo.
        #
        #  Se corrige aqui porque la estimacion del alta puede estar muy lejos: sale de la
        #  duracion que mando el navegador, y un navegador que no sabe decodificar el video
        #  manda ceros. Ver `fijar_total_del_trabajo`.
        job_total = None
        if frames_to_analyze is not None:
            await self._repo.fijar_total_del_trabajo(job_id, frames_to_analyze)
            actualizado = await self._repo.get_job(job_id)
            job_total = (actualizado or job).get("frames_total")

        return {
            "media_id": media_id,
            "total_frames": total_frames,
            "cambio": tocadas > 0,
            "job_frames_total": job_total,
        }

    async def diagnostico_de_lectura(self, *, job_id: UUID) -> dict[str, Any]:
        """Por que este analisis leyo lo que leyo, en numeros y en una frase.

        ── DE DONDE SALE ────────────────────────────────────────────────────────

        De un trabajo que devolvio 545 detecciones y ni un solo codigo de pallet, y que
        para entenderlo hubo que bajar el video, medirlo, sacar recortes y cruzar 703
        etiquetas contra su tasa de lectura. La pantalla decia «completado» y ya.

        Todo lo que hizo falta estaba en la base en cuanto el analisis termino. Esto es
        decirlo, y decirlo ANTES de que alguien lo descubra mirando.

        No falla si el ancho del medio no se sabe: devuelve `sin_etiquetas` con la mediana
        nula, que es honesto. Un diagnostico sobre un ancho supuesto seria peor.
        """
        job = await self._repo.get_job(job_id)
        if job is None:
            raise NotFoundError("Ese trabajo no existe.", resource_id=str(job_id))

        resumen = await self._repo.resumen_de_etiquetas(job_id)
        mediana = resumen.get("ancho_mediano")
        d = diagnosticar_resumen(
            etiquetas=int(resumen.get("etiquetas") or 0),
            leidas=int(resumen.get("leidas") or 0),
            ancho_mediano=float(mediana) if mediana is not None else None,
            #  Solo los pipelines con lectura intentan decodificar. Sin esto, un analisis
            #  de pura deteccion recibia el reproche de no haber leido nada.
            intento_lectura=job.get("pipeline") in ("ocr", "detection-ocr", "ubicaciones"),
        )
        return {
            "job_id": job_id,
            "etiquetas": d.etiquetas,
            "leidas": d.leidas,
            "ancho_mediano_px": round(d.ancho_mediano) if d.ancho_mediano else None,
            "veredicto": d.veredicto,
            "mensaje": d.mensaje,
            "acercarse": d.acercarse,
        }

    async def live_progress(self, *, job_id: UUID, frames: int) -> dict[str, Any]:
        """Suma los fotogramas de un lote. Lo llama el worker mientras el directo corre.

        SOLO fotogramas. Las detecciones las cuenta `ingest_detections`, que sabe cuantas
        inserto; contarlas tambien aqui las sumaba dos veces.
        """
        if await self._repo.bump_frames(job_id, procesados=frames, detecciones=0) == 0:
            raise ConflictError(
                "Ese trabajo no esta corriendo: un directo solo acumula progreso "
                "mientras esta en `running`."
            )
        job = await self._repo.get_job(job_id)
        return {
            "frames_processed": (job or {}).get("frames_processed", 0),
            "detection_count": (job or {}).get("detection_count", 0),
        }
