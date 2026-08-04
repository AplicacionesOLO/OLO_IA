"""Servicio de percepción: trabajos de inferencia, detecciones y el puente con 0067.

── DÓNDE ESTÁ LA FRONTERA ───────────────────────────────────────────────────

Este módulo NO ejecuta inferencia. Aquí no se carga un modelo ni se decodifica un
vídeo: se registra qué se pidió, se acepta lo que un worker deja, y se traduce lo
que se leyó a hechos que el resto del sistema entiende.

Que no haya worker no es un detalle a esconder. Un trabajo creado hoy llega a
`queued` y se queda ahí, porque no hay nadie que lo recoja. La alternativa —moverlo
a `running` y dibujar una barra de progreso— sería una pantalla que finge trabajar.
Por eso `worker_available` viaja en la respuesta y es `False`, con su motivo.

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

import hashlib
from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.core.errors import BusinessRuleError, ConflictError, NotFoundError
from olo.repositories.perception import PerceptionRepository
from olo.repositories.spatial_observations import SpatialObservationRepository

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

# Los estados desde los que un trabajo puede pasar a la cola. Es la MISMA tabla que
# el disparador de 0069 y que `stateMachine.ts`; aquí sirve para dar un error de
# dominio legible en lugar de dejar que salte el CHECK de la base con su jerga.
_A_LA_COLA = {"uploaded", "failed"}

# Lo que se considera «terminal»: no se cancela ni se reintenta.
_TERMINALES = {"completed", "cancelled"}


class PerceptionService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._repo = PerceptionRepository(session)
        self._obs = SpatialObservationRepository(session)
        self._ctx = ctx

    # ── Modelos ────────────────────────────────────────────────────────────
    async def models(self) -> dict[str, Any]:
        """El catálogo publicado, y si hay algo que ejecutar.

        Devuelve la lista Y `worker_available`, juntos y a propósito: elegir modelo
        sin saber si alguien lo va a correr es la mitad de la información que hace
        falta para decidir si merece la pena lanzar el análisis.
        """
        modelos = await self._repo.published_models()
        return {
            "models": modelos,
            "worker_available": False,
            "unavailable_reason": (
                "No hay ningun worker de inferencia registrado. Un trabajo se puede "
                "crear y queda en cola, pero nadie lo va a procesar todavia."
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
        # Igual que en `models()`: la pantalla necesita saber que la cola no avanza.
        job["worker_available"] = False
        return job

    async def list_jobs(
        self, *, warehouse_id: UUID | None, status: str | None, limit: int
    ) -> dict[str, Any]:
        trabajos = await self._repo.list_jobs(
            warehouse_id=warehouse_id, status=status, limit=limit
        )
        return {"jobs": trabajos, "worker_available": False}

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
        return await self.get_job(job_id)

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

        await self._repo.update_status(
            job_id=job_id,
            to_status="completed" if mark_completed else "running",
            frames_processed=job["frames_total"] if mark_completed else None,
            detection_count=insertadas,
        )
        return {
            "inserted": insertadas,
            "deleted": borradas,
            "job": await self.get_job(job_id),
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
        self, *, job_id: UUID, source_code: str, source_kind: str
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
        if job["status"] != "completed":
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
            candidatas.extend(i for i in items if i["text_value"])
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

        mapa = await self._repo.resolve_rack_codes(
            warehouse_id=warehouse_id,
            codes=[c["text_value"] for c in candidatas],
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
        for c in candidatas:
            nodo = mapa.get(c["text_value"])
            if nodo is None:
                sin_resolver[c["text_value"]] = sin_resolver.get(c["text_value"], 0) + 1
                continue
            a_observar.append(
                {
                    "rack_node_id": nodo,
                    "observed_at": c["observed_at"],
                    "confidence": c["confidence"],
                    "frame_ref": c["frame_ref"],
                    "frame_ms": c["frame_ms"],
                    "notes": f"deteccion {c['id']} del trabajo {job_id}",
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
