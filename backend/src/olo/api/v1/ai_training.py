"""Endpoints de entrenamiento y versionado de modelos.

── LO QUE FALTABA, Y POR QUÉ SE NOTABA ──────────────────────────────────────

`ai.training_runs` y `ai.model_versions` existían desde 0031/0043, con sus CHECK, sus
disparadores y su matriz de transiciones, y tenían CERO filas: no había ningún endpoint
que escribiera en ellas. La consecuencia se veía dos módulos más allá —el desplegable
de modelos de percepción estaba vacío— porque `perception.v_published_models` filtra
por `status = 'published'` y no había ninguna versión que publicar.

Este router cierra ese hueco. No hace falta migración: el esquema ya estaba.

── EL ENTRENAMIENTO NO CORRE AQUÍ ───────────────────────────────────────────

    POST /runs            encolar
    POST /runs/{id}/start   ← el RUNNER dice que empieza
    POST /runs/{id}/finish  ← el RUNNER reporta métricas y pesos, o el fallo
    POST /runs/{id}/cancel

Los dos del medio los llama `backend/tools/entrenar.py`, que corre donde está la GPU.
Meter el entrenamiento dentro de la API habría significado un proceso web bloqueado
horas, sin forma de repartirlo entre máquinas y sin poder entrenar en un sitio y
servir en otro.

── PERMISOS ─────────────────────────────────────────────────────────────────

`ai_models:read` y `ai_models:write`, que ya existen, más `PlatformOwnerRequired` como
todo el bloque de IA: entrenar y publicar es trabajo de la plataforma, no del tenant.
El tenant CONSUME lo publicado, y para eso está `perception.v_published_models` (0070).
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from olo.api.deps import Db, PlatformOwnerRequired, require
from olo.api.v1.ai_schemas import (
    ModelVersionListOut,
    ModelVersionOut,
    ModelVersionRegisterIn,
    ModelVersionTransitionIn,
    TrainingFinishOut,
    TrainingRunCancelIn,
    TrainingRunFinishIn,
    TrainingRunListOut,
    TrainingRunOut,
    TrainingRunQueueIn,
    TrainingRunStartIn,
)
from olo.api.v1.schemas import Envelope
from olo.services.ai.training import AiTrainingService

router = APIRouter(prefix="/ai", tags=["ai-training"])


# ── Ejecuciones ────────────────────────────────────────────────────────────
@router.post(
    "/training-runs",
    response_model=Envelope[TrainingRunOut],
    status_code=201,
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Encolar un entrenamiento contra una versión congelada de dataset",
)
async def queue_run(cuerpo: TrainingRunQueueIn, db: Db) -> Envelope[TrainingRunOut]:
    """Nace ENCOLADA, no en borrador.

    Entre «quiero entrenar esto» y «está pendiente de que alguien lo coja» no hay nada
    que preparar, y un borrador de entrenamiento sería un estado en el que nadie hace
    nada y que hay que limpiar.

    El dataset tiene que estar CONGELADO: entrenar contra uno abierto significa que las
    imágenes pueden cambiar mientras se entrena, y entonces «este modelo se entrenó con
    estos datos» deja de ser cierto.
    """
    datos = await AiTrainingService(db).queue_run(
        model_id=cuerpo.model_id,
        dataset_version_id=cuerpo.dataset_version_id,
        hyperparams=cuerpo.hyperparams,
        runner=cuerpo.runner,
        notes=cuerpo.notes,
    )
    return Envelope[TrainingRunOut](data=TrainingRunOut.model_validate(datos))


@router.get(
    "/training-runs",
    response_model=Envelope[TrainingRunListOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:read")],
    summary="Ejecuciones de entrenamiento, lo más reciente primero",
)
async def list_runs(
    db: Db,
    project_id: Annotated[UUID | None, Query()] = None,
    model_id: Annotated[UUID | None, Query()] = None,
    status: Annotated[str | None, Query(description="queued/running/succeeded/…")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Envelope[TrainingRunListOut]:
    """`runner_available` viene en la respuesta y es `false`.

    Es la mitad de la información que hace falta para entender una cola que no avanza:
    sin ella, una ejecución encolada tres días parece un fallo.
    """
    datos = await AiTrainingService(db).list_runs(
        project_id=project_id, model_id=model_id, status=status, limit=limit
    )
    return Envelope[TrainingRunListOut](data=TrainingRunListOut.model_validate(datos))


@router.get(
    "/training-runs/{run_id}",
    response_model=Envelope[TrainingRunOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:read")],
    summary="Una ejecución de entrenamiento",
)
async def get_run(run_id: UUID, db: Db) -> Envelope[TrainingRunOut]:
    datos = await AiTrainingService(db).get_run(run_id)
    return Envelope[TrainingRunOut](data=TrainingRunOut.model_validate(datos))


@router.post(
    "/training-runs/{run_id}/start",
    response_model=Envelope[TrainingRunOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Un runner declara que empieza a entrenar",
)
async def start_run(
    run_id: UUID, cuerpo: TrainingRunStartIn, db: Db
) -> Envelope[TrainingRunOut]:
    """Idempotente por carrera perdida, no por reintento.

    El `UPDATE` filtra por `status = 'queued'`: si dos runners cogen la misma
    ejecución, el segundo no actualiza ninguna fila y recibe un 409. Sin ese filtro,
    los dos entrenarían lo mismo y el segundo machacaría el `started_at` del primero.
    """
    datos = await AiTrainingService(db).start_run(run_id=run_id, runner=cuerpo.runner)
    return Envelope[TrainingRunOut](data=TrainingRunOut.model_validate(datos))


@router.post(
    "/training-runs/{run_id}/finish",
    response_model=Envelope[TrainingFinishOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Un runner reporta el resultado; con éxito, nace la versión de pesos",
)
async def finish_run(
    run_id: UUID, cuerpo: TrainingRunFinishIn, db: Db
) -> Envelope[TrainingFinishOut]:
    """La ejecución y la versión se cierran en la MISMA transacción.

    Una ejecución `succeeded` sin versión sería un entrenamiento que salió bien y no
    produjo nada; el CHECK `chk_run_pesos_solo_exito` garantiza el revés. Y las
    métricas que faltan se AVISAN en `missing_metrics` en lugar de rechazarse: hay
    arquitecturas cuyas métricas son otras, y exigir un mAP obligaría a inventarlo.
    """
    datos = await AiTrainingService(db).finish_run(
        run_id=run_id,
        metrics=cuerpo.metrics,
        weights_asset_id=cuerpo.weights_asset_id,
        source_reference=cuerpo.source_reference,
        error_message=cuerpo.error_message,
        version_notes=cuerpo.version_notes,
    )
    version = datos.pop("model_version", None)
    ausentes = datos.pop("missing_metrics", [])
    return Envelope[TrainingFinishOut](
        data=TrainingFinishOut.model_validate(
            {
                "run": datos,
                "version": version,
                "missing_metrics": ausentes,
            }
        )
    )


@router.post(
    "/training-runs/{run_id}/cancel",
    response_model=Envelope[TrainingRunOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Cancelar una ejecución que aún no ha terminado",
)
async def cancel_run(
    run_id: UUID, cuerpo: TrainingRunCancelIn, db: Db
) -> Envelope[TrainingRunOut]:
    """Cancelar es la ALTERNATIVA a borrar, que la base prohíbe.

    `ai.reject_finished_run_change()` lo dice con sus palabras: «una ejecución de
    entrenamiento no se borra: es el registro de qué datos produjeron un modelo. Si
    fue un error, márcala como cancelled».
    """
    datos = await AiTrainingService(db).cancel_run(run_id=run_id, reason=cuerpo.reason)
    return Envelope[TrainingRunOut](data=TrainingRunOut.model_validate(datos))


# ── Versiones de pesos ─────────────────────────────────────────────────────
@router.get(
    "/models/{model_id}/versions",
    response_model=Envelope[ModelVersionListOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:read")],
    summary="Versiones de un modelo, con las métricas de su entrenamiento",
)
async def list_versions(model_id: UUID, db: Db) -> Envelope[ModelVersionListOut]:
    """Las métricas vienen de la EJECUCIÓN que produjo cada versión, por JOIN.

    No se copian a la versión: dos sitios donde mirar el mAP de un modelo discreparían
    en cuanto alguien corrigiera uno.
    """
    datos = await AiTrainingService(db).list_versions(model_id)
    return Envelope[ModelVersionListOut](data=ModelVersionListOut.model_validate(datos))


@router.post(
    "/models/{model_id}/versions",
    response_model=Envelope[ModelVersionOut],
    status_code=201,
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Registrar pesos preentrenados o importados",
)
async def register_version(
    model_id: UUID, cuerpo: ModelVersionRegisterIn, db: Db
) -> Envelope[ModelVersionOut]:
    """`origin = 'trained'` NO se acepta aquí.

    Una versión entrenada la crea el cierre de su ejecución. Permitir crearla a mano
    produciría pesos que dicen venir de un entrenamiento del que no hay registro, y
    entonces «con qué datos se entrenó esto» dejaría de tener respuesta.
    """
    datos = await AiTrainingService(db).register_version(
        model_id=model_id,
        origin=cuerpo.origin,
        weights_asset_id=cuerpo.weights_asset_id,
        source_reference=cuerpo.source_reference,
        notes=cuerpo.notes,
    )
    return Envelope[ModelVersionOut](data=ModelVersionOut.model_validate(datos))


@router.post(
    "/model-versions/{version_id}/status",
    response_model=Envelope[ModelVersionOut],
    dependencies=[PlatformOwnerRequired, require("ai_models:write")],
    summary="Validar, publicar, degradar o archivar una versión",
)
async def transition_version(
    version_id: UUID, cuerpo: ModelVersionTransitionIn, db: Db
) -> Envelope[ModelVersionOut]:
    """Publicar degrada a la anterior en la MISMA transacción.

    El índice único `uq_mv_publicada` garantiza una sola versión publicada por modelo.
    Sin degradar la anterior, publicar fallaría con una violación de índice; y en dos
    transacciones habría un instante sin ninguna publicada, en el que una inferencia
    lanzada diría que el modelo no existe.

    Publicar es además lo que hace que el modelo APAREZCA en el desplegable de
    percepción: `perception.v_published_models` (0070) filtra por `published`, y ese
    filtro es la frontera entre «existe en el taller» y «se puede usar».
    """
    datos = await AiTrainingService(db).transition_version(
        version_id=version_id,
        to_status=cuerpo.to_status,
        failure_reason=cuerpo.failure_reason,
        expected_lock=cuerpo.expected_lock,
    )
    return Envelope[ModelVersionOut](data=ModelVersionOut.model_validate(datos))
