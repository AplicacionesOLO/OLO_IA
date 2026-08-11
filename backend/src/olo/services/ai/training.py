"""Servicio de entrenamiento y versionado de modelos.

── LA FRONTERA: ESTE SISTEMA ES EL REGISTRO, NO EL ENTRENADOR ──────────────

Aquí no se carga PyTorch ni se recorre un dataset. El ciclo es:

    1. encolar      alguien pide entrenar el modelo M con el dataset congelado D
    2. arrancar     un RUNNER externo la coge y dice que empieza
    3. cerrar       el runner reporta metricas y los pesos, o el motivo del fallo
    4. registrar    de una ejecucion con exito sale una VERSION en `registered`
    5. validar      alguien comprueba que los pesos hacen lo que dicen
    6. publicar     el acto explicito por el que pasan a ser ejecutables

Los pasos 2 y 3 los hace `backend/tools/entrenar.py`, que corre donde esta la GPU.
Meter el entrenamiento dentro de la API habria significado un proceso web bloqueado
horas, sin forma de repartirlo entre maquinas y sin poder entrenar en un sitio y
servir en otro.

Si hay runner conectado se deduce del latido de `core.workers` (0075): era una
constante `False`, correcta mientras no existiera ninguno, y ahora es un hecho.

Que no haya runner conectado no se esconde: una ejecucion encolada se queda encolada,
y la respuesta lo dice.

── POR QUE PUBLICAR DEGRADA A LA ANTERIOR, EN LA MISMA TRANSACCION ─────────

El indice unico `uq_mv_publicada` garantiza UNA version publicada por modelo. Si
publicar no degradara la anterior, el INSERT fallaria con una violacion de indice y
quien pulso «publicar» leeria un error de base de datos.

Y si se hicieran en dos transacciones habria un instante sin ninguna publicada: justo
entonces, `perception.v_published_models` no devolveria nada y una inferencia lanzada
en ese momento diria que el modelo no existe. Van juntas o no van.

── LO QUE ESTE SERVICIO NO VALIDA ──────────────────────────────────────────

La matriz de transiciones. Vive en `ai.validate_version_transition()` y ahi es
autoridad unica —`domain/ai/model.py` ya lo advirtio—. Lo que se hace aqui es
TRADUCIR: el disparador da un mensaje correcto y con jerga de SQL, y quien pulsa
«publicar» en una version archivada merece leer por que no se puede.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.exc import DBAPIError

from olo.core.errors import BusinessRuleError, ConflictError, NotFoundError
from olo.domain.ai.training import (
    METRICAS_ESPERADAS,
    ModelOrigin,
    TrainingRunStatus,
)
from olo.repositories.ai.training import TrainingRepository
from olo.repositories.workers import WorkerRepository
from olo.services.ai.errors import translate_pg_error

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Estados desde los que se puede publicar. La base los valida; esta lista solo sirve
# para dar el mensaje antes de intentarlo.
_PUBLICABLES = {"validated", "deprecated"}


class AiTrainingService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = TrainingRepository(session)
        self._workers = WorkerRepository(session)
        self._session = session

    # ── Encolar ────────────────────────────────────────────────────────────
    async def queue_run(
        self,
        *,
        model_id: UUID,
        dataset_version_id: UUID,
        hyperparams: dict[str, Any] | None,
        runner: str | None,
        notes: str | None,
    ) -> dict[str, Any]:
        """Encola un entrenamiento y devuelve la ejecucion, ya con su contexto.

        Comprueba tres cosas que, si fallaran mas tarde, lo harian con un mensaje que
        no dice que hacer:

        · que el modelo exista y NECESITE entrenamiento. Un modelo `requires_training
          = false` usa pesos preentrenados; encolarle un entrenamiento produciria una
          ejecucion que nadie deberia coger.
        · que el dataset este CONGELADO y sea del mismo proyecto. Entrenar contra un
          dataset abierto significa que las imagenes pueden cambiar mientras se
          entrena, y entonces «este modelo se entreno con estos datos» deja de ser
          cierto.
        · que el dataset tenga clases. Sin `class_snapshot` no hay `class_map`, y sin
          indices la salida del modelo no significa nada.
        """
        modelo = await self._repo.model_context(model_id)
        if modelo is None:
            raise NotFoundError(f"modelo {model_id} no encontrado")
        if not modelo["requires_training"]:
            raise BusinessRuleError(
                f"el modelo '{modelo['name']}' no necesita entrenamiento: usa pesos "
                "preentrenados. Registra una version con origin='pretrained' y su "
                "source_reference en lugar de encolar una ejecucion que nadie deberia coger"
            )

        dataset = await self._repo.dataset_snapshot(dataset_version_id)
        if dataset is None:
            raise NotFoundError(f"version de dataset {dataset_version_id} no encontrada")
        if dataset["project_id"] != modelo["project_id"]:
            raise BusinessRuleError(
                "el dataset y el modelo son de proyectos distintos: entrenar con "
                "imagenes de otro proyecto produciria un modelo cuyas clases no son "
                "las que dice"
            )
        if dataset["frozen_at"] is None:
            raise BusinessRuleError(
                f"la version de dataset '{dataset['name']}' no esta congelada: sus "
                "imagenes pueden cambiar mientras se entrena, y entonces «este modelo "
                "se entreno con estos datos» dejaria de ser cierto"
            )

        clases = dataset.get("class_snapshot") or []
        if not clases:
            raise BusinessRuleError(
                "la version de dataset no tiene instantanea de clases: sin los indices "
                "no se puede reproducir el entrenamiento ni interpretar la salida"
            )

        # Los hiperparametros del catalogo son la BASE, y lo que llega los pisa. Asi
        # una ejecucion siempre queda con el conjunto completo escrito: reproducirla
        # dentro de un año no depende de que el catalogo siga teniendo los mismos
        # valores por defecto.
        efectivos = dict(modelo.get("default_hyperparams") or {})
        efectivos.update(hyperparams or {})

        aviso = None
        minimo = modelo.get("min_images_recommended")
        if minimo and dataset["image_count"] < minimo:
            aviso = (
                f"el dataset tiene {dataset['image_count']} imagenes y la arquitectura "
                f"{modelo['architecture_code']} recomienda al menos {minimo}. Se encola "
                "igual: es una recomendacion, no un limite, y a veces se entrena a "
                "proposito con pocas para medir el suelo"
            )

        run = await self._repo.create_run(
            project_id=UUID(str(modelo["project_id"])),
            model_id=model_id,
            dataset_version_id=dataset_version_id,
            architecture_code=str(modelo["architecture_code"]),
            hyperparams=efectivos,
            class_map=list(clases),
            runner=runner,
            notes=notes,
        )
        return {
            **run,
            "model_name": modelo["name"],
            "dataset_name": dataset["name"],
            "dataset_image_count": dataset["image_count"],
            "runner_available": await self._workers.esta_vivo("training"),
            "warning": aviso,
        }

    async def get_run(self, run_id: UUID) -> dict[str, Any]:
        run = await self._repo.get_run(run_id)
        if run is None:
            raise NotFoundError(f"ejecucion {run_id} no encontrada")
        return {**run, "runner_available": await self._workers.esta_vivo("training")}

    async def list_runs(
        self,
        *,
        project_id: UUID | None,
        model_id: UUID | None,
        status: str | None,
        limit: int,
    ) -> dict[str, Any]:
        runs = await self._repo.list_runs(
            project_id=project_id, model_id=model_id, status=status, limit=limit
        )
        vivo = await self._workers.esta_vivo("training")
        return {
            "runs": runs,
            # Es la mitad de la informacion que hace falta para entender una cola que
            # no avanza. Sin esto, una ejecucion encolada tres dias parece un fallo.
            "runner_available": vivo,
            "unavailable_reason": (
                None
                if vivo
                else (
                    "No hay ningun runner de entrenamiento con latido reciente. Las "
                    "ejecuciones quedan en cola: las coge `backend/tools/entrenar.py` "
                    "donde este la GPU."
                )
            ),
        }

    # ── El extremo del runner ──────────────────────────────────────────────
    async def start_run(self, *, run_id: UUID, runner: str | None) -> dict[str, Any]:
        run = await self._repo.get_run(run_id)
        if run is None:
            raise NotFoundError(f"ejecucion {run_id} no encontrada")
        if run["status"] != TrainingRunStatus.QUEUED:
            raise ConflictError(
                f"la ejecucion esta en '{run['status']}': solo se arranca una encolada. "
                "Si termino, crea otra: una ejecucion terminada es inmutable"
            )
        movida = await self._repo.start_run(run_id=run_id, runner=runner)
        if movida is None:
            # Otro runner la cogio entre la lectura y el UPDATE. Es la carrera que el
            # `WHERE status = 'queued'` convierte en cero filas en lugar de en dos
            # runners entrenando lo mismo.
            raise ConflictError(
                "otro runner cogio esta ejecucion primero: no se arranca dos veces"
            )
        return {**movida, "runner_available": True}

    async def finish_run(
        self,
        *,
        run_id: UUID,
        metrics: dict[str, Any] | None,
        weights_asset_id: UUID | None,
        source_reference: str | None,
        error_message: str | None,
        version_notes: str | None,
    ) -> dict[str, Any]:
        """Cierra la ejecucion. Con exito, CREA la version de pesos.

        Las dos cosas en la misma transaccion: una ejecucion `succeeded` sin version
        seria un entrenamiento que salio bien y no produjo nada, y `chk_run_pesos_solo_exito`
        garantiza el reves —una version colgada de una ejecucion fallida—.

        `weights_asset_id` es OBLIGATORIO, y no por rigor: `ai.model_versions.weights_asset_id`
        es NOT NULL desde 0043. La invariante dice algo cierto —una version sin archivo
        de pesos no es una version, es una anotacion sobre un entrenamiento— y el
        camino previsto ya existia: `ai.assets` acepta `kind = 'weights'`, asi que el
        runner sube el `best.pt` con el mismo prepare/confirm que las imagenes y pasa
        aqui el id resultante.

        `source_reference` sigue siendo util y sigue siendo opcional para `trained`:
        anota DONDE corrio el entrenamiento —«gpu-box-01:/home/olo/runs/best.pt»— que
        es distinto de donde estan los bytes guardados.
        """
        run = await self._repo.get_run(run_id)
        if run is None:
            raise NotFoundError(f"ejecucion {run_id} no encontrada")
        if run["status"] != TrainingRunStatus.RUNNING:
            raise ConflictError(
                f"la ejecucion esta en '{run['status']}': solo se cierra una que este "
                "corriendo. Una ejecucion terminada es inmutable por diseño"
            )

        if error_message:
            cerrada = await self._repo.finish_run(
                run_id=run_id,
                status=TrainingRunStatus.FAILED,
                metrics=None,
                error_message=error_message,
                model_version_id=None,
            )
            if cerrada is None:
                raise ConflictError("la ejecucion cambio de estado mientras se cerraba")
            return {**cerrada, "model_version": None, "missing_metrics": []}

        if weights_asset_id is None:
            raise BusinessRuleError(
                "una ejecucion con exito necesita el ARCHIVO de pesos: subelo como "
                "asset de tipo 'weights' —el mismo prepare/confirm que las imagenes— y "
                "pasa su `weights_asset_id`. Sin el archivo, el entrenamiento no ha "
                "producido nada recuperable y la version seria solo una anotacion sobre "
                "unas metricas"
            )

        version = await self._repo.create_version(
            project_id=UUID(str(run["project_id"])),
            model_id=UUID(str(run["model_id"])),
            origin=ModelOrigin.TRAINED,
            weights_asset_id=weights_asset_id,
            source_reference=source_reference,
            notes=version_notes,
        )

        cerrada = await self._repo.finish_run(
            run_id=run_id,
            status=TrainingRunStatus.SUCCEEDED,
            metrics=metrics or {},
            error_message=None,
            model_version_id=UUID(str(version["id"])),
        )
        if cerrada is None:
            raise ConflictError("la ejecucion cambio de estado mientras se cerraba")

        # Las metricas que faltan se AVISAN, no se rechazan: hay arquitecturas cuyas
        # metricas son otras, y exigir un mAP obligaria a inventarlo. Pero callarlo
        # dejaria pasar un `metrics: {}` que despues nadie puede comparar con nada.
        ausentes = [k for k in METRICAS_ESPERADAS if k not in (metrics or {})]
        # `model_version` y no `version`: la ejecucion YA tiene una columna `version`
        # —su contador de bloqueo optimista— y meter aqui el diccionario de la version
        # de pesos la sobreescribia. El sintoma fue un 500 de validacion diciendo que
        # al run le faltaba `version`, que es de las cosas que no se adivinan leyendo.
        return {**cerrada, "model_version": version, "missing_metrics": ausentes}

    async def cancel_run(self, *, run_id: UUID, reason: str) -> dict[str, Any]:
        if not reason.strip():
            raise BusinessRuleError(
                "cancelar necesita motivo: es lo unico que quedara para explicar por "
                "que esta ejecucion no llego a terminar"
            )
        cancelada = await self._repo.cancel_run(run_id=run_id, reason=reason)
        if cancelada is None:
            run = await self._repo.get_run(run_id)
            if run is None:
                raise NotFoundError(f"ejecucion {run_id} no encontrada")
            raise ConflictError(
                f"la ejecucion ya termino en '{run['status']}': cancelarla no cambiaria "
                "nada y el historial diria que se cancelo algo que estaba hecho"
            )
        return cancelada

    # ── Versiones ──────────────────────────────────────────────────────────
    async def register_version(
        self,
        *,
        model_id: UUID,
        origin: str,
        weights_asset_id: UUID | None,
        source_reference: str | None,
        notes: str | None,
    ) -> dict[str, Any]:
        """Registra una version que NO viene de un entrenamiento propio.

        Es el camino de los pesos preentrenados y de los importados. `trained` no se
        acepta aqui: una version entrenada la crea el cierre de su ejecucion, y
        permitir crearla a mano produciria pesos que dicen venir de un entrenamiento
        del que no hay registro.
        """
        modelo = await self._repo.model_context(model_id)
        if modelo is None:
            raise NotFoundError(f"modelo {model_id} no encontrado")
        if origin == ModelOrigin.TRAINED:
            raise BusinessRuleError(
                "una version 'trained' sale del cierre de su ejecucion de "
                "entrenamiento, no de aqui: creada a mano serian pesos que dicen venir "
                "de un entrenamiento del que no hay registro"
            )
        if not (source_reference or "").strip():
            raise BusinessRuleError(
                f"una version '{origin}' necesita `source_reference`: unos pesos que "
                "aparecen sin decir de donde vienen no se pueden auditar"
            )
        if weights_asset_id is None:
            raise BusinessRuleError(
                "hace falta el ARCHIVO de pesos como asset de tipo 'weights': "
                "`source_reference` dice de donde VIENEN, y `weights_asset_id` donde "
                "ESTAN. Sin lo segundo no se pueden cargar"
            )
        return await self._repo.create_version(
            project_id=UUID(str(modelo["project_id"])),
            model_id=model_id,
            origin=origin,
            weights_asset_id=weights_asset_id,
            source_reference=source_reference,
            notes=notes,
        )

    async def list_versions(self, model_id: UUID) -> dict[str, Any]:
        modelo = await self._repo.model_context(model_id)
        if modelo is None:
            raise NotFoundError(f"modelo {model_id} no encontrado")
        versiones = await self._repo.list_versions(model_id)
        publicada = next((v for v in versiones if v["status"] == "published"), None)
        return {
            "model_id": str(model_id),
            "model_name": modelo["name"],
            "versions": versiones,
            "published_version_id": publicada["id"] if publicada else None,
        }

    async def transition_version(
        self,
        *,
        version_id: UUID,
        to_status: str,
        failure_reason: str | None,
        expected_lock: int | None,
    ) -> dict[str, Any]:
        """Mueve una version por su ciclo de vida.

        Publicar es el caso especial: degrada la publicada anterior en la MISMA
        transaccion. Sin eso, el indice unico `uq_mv_publicada` rechazaria la segunda
        publicacion con un error de base de datos; y en dos transacciones habria un
        instante sin ninguna publicada, en el que una inferencia lanzada diria que el
        modelo no existe.
        """
        version = await self._repo.get_version(version_id)
        if version is None:
            raise NotFoundError(f"version {version_id} no encontrada")

        if to_status == "failed" and not (failure_reason or "").strip():
            raise BusinessRuleError(
                "marcar una version como fallida necesita motivo: sin el, la pantalla "
                "dice que los pesos no valen y no deja hacer nada al respecto"
            )
        if to_status == "published" and version["status"] not in _PUBLICABLES:
            raise ConflictError(
                f"una version en '{version['status']}' no se publica: primero hay que "
                f"validarla. Solo se publica desde {' o '.join(sorted(_PUBLICABLES))}"
            )

        """
        ── LAS REGLAS VIVEN EN UN DISPARADOR, Y HAY QUE TRADUCIRLAS ──────────────

        `ai.validate_version_transition` (0043) rechaza los saltos de estado con un
        `RAISE EXCEPTION` que lleva `DETAIL = 'AI_VERSION_TRANSITION_INVALID'`, y
        `translate_pg_error` sabe convertir ese codigo en un error de dominio con su 409.

        Solo que este servicio no lo llamaba. Medido al publicar la v4: pedir
        `registered -> validated` —que se salta `validating`— respondia
        **500 «Database error»**, sin decir cual era la secuencia buena. El trigger habia
        hecho bien su trabajo y la traduccion existia; lo que faltaba era el `except` que
        las une. Un 500 en una regla de negocio le dice al cliente «esto esta roto» cuando
        lo cierto es «eso no se puede hacer, y esta es la razon».
        """
        try:
            degradada = None
            if to_status == "published":
                anterior = await self._repo.published_version_of(
                    UUID(str(version["model_id"]))
                )
                if anterior is not None and str(anterior["id"]) != str(version_id):
                    degradada = await self._repo.transition_version(
                        version_id=UUID(str(anterior["id"])),
                        to_status="deprecated",
                        failure_reason=None,
                        expected_lock=None,
                    )

            movida = await self._repo.transition_version(
                version_id=version_id,
                to_status=to_status,
                failure_reason=failure_reason,
                expected_lock=expected_lock,
            )
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        if movida is None:
            raise ConflictError(
                "la version cambio mientras se actualizaba: alguien mas la ha movido. "
                "Vuelve a leerla antes de reintentar"
            )
        return {
            **movida,
            "deprecated_previous_id": degradada["id"] if degradada else None,
        }
