"""Repositorio de ejecuciones de entrenamiento y versiones de pesos.

── LO QUE ESTE ARCHIVO NO COMPRUEBA, A PROPÓSITO ───────────────────────────

Tres invariantes viven en la base y NO se duplican aquí:

  · `ai.validate_version_transition()` decide qué transición de estado es legítima.
  · `ai.reject_finished_run_change()` hace inmutable una ejecución terminada, y
    prohíbe borrarla —«es el registro de qué datos produjeron un modelo»—.
  · `ai.prevent_training_index_change()` impide mover los índices de clase.

Un `UPDATE` que las viole levanta una excepción de PostgreSQL. Comprobarlo también
aquí crearía dos verdades y la copia se quedaría atrás; lo que sí hace el servicio es
TRADUCIR el error a algo legible.

── LA NUMERACIÓN DE VERSIONES SALE DE LA BASE ──────────────────────────────

`version` es el número por modelo: v1, v2, v3. Se calcula con
`COALESCE(MAX(version), 0) + 1` DENTRO del mismo INSERT, no leyendo antes y sumando
en Python: dos publicaciones simultáneas leerían el mismo máximo y crearían dos v3, y
el índice único lo rechazaría con un error que no dice qué pasó.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

_RUN_COLS = (
    "id, project_id, model_id, dataset_version_id, architecture_code, hyperparams, "
    "class_map, status, runner, started_at, finished_at, metrics, error_message, "
    "model_version_id, notes, created_at, updated_at, version"
)

_MV_COLS = (
    "id, project_id, model_id, version, origin, weights_asset_id, source_reference, "
    "notes, status, published_at, published_by, validated_at, deprecated_at, "
    "archived_at, failure_reason, created_at, updated_at, version_lock, deleted_at"
)


class TrainingRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Ejecuciones ────────────────────────────────────────────────────────
    async def create_run(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        dataset_version_id: UUID,
        architecture_code: str,
        hyperparams: dict[str, Any],
        class_map: list[dict[str, Any]],
        runner: str | None,
        notes: str | None,
    ) -> dict[str, Any]:
        """Crea la ejecución ENCOLADA.

        Nace en `queued` y no en un borrador: entre «quiero entrenar esto» y «está
        pendiente de que alguien lo coja» no hay nada que preparar, y un borrador de
        entrenamiento sería un estado en el que nadie hace nada y que hay que limpiar.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO ai.training_runs "  # noqa: S608
                    "(project_id, model_id, dataset_version_id, architecture_code, "
                    " hyperparams, class_map, status, runner, notes, "
                    " created_by, updated_by) "
                    "VALUES (CAST(:pid AS uuid), CAST(:mid AS uuid), CAST(:dvid AS uuid), "
                    "        :arch, CAST(:hp AS jsonb), CAST(:cm AS jsonb), 'queued', "
                    "        :runner, :notas, core.current_user_id(), core.current_user_id()) "
                    f"RETURNING {_RUN_COLS}"
                ),
                {
                    "pid": str(project_id),
                    "mid": str(model_id),
                    "dvid": str(dataset_version_id),
                    "arch": architecture_code,
                    "hp": _json(hyperparams),
                    "cm": _json(class_map),
                    "runner": runner,
                    "notas": notes,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def get_run(self, run_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_RUN_COLS} FROM ai.training_runs "  # noqa: S608
                    "WHERE id = CAST(:rid AS uuid)"
                ),
                {"rid": str(run_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def list_runs(
        self, *, project_id: UUID | None, model_id: UUID | None, status: str | None, limit: int
    ) -> list[dict[str, Any]]:
        clausulas: list[str] = []
        params: dict[str, Any] = {"lim": limit}
        if project_id is not None:
            clausulas.append("project_id = CAST(:pid AS uuid)")
            params["pid"] = str(project_id)
        if model_id is not None:
            clausulas.append("model_id = CAST(:mid AS uuid)")
            params["mid"] = str(model_id)
        if status is not None:
            clausulas.append("status = :estado")
            params["estado"] = status
        donde = f"WHERE {' AND '.join(clausulas)} " if clausulas else ""
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_RUN_COLS} FROM ai.training_runs "  # noqa: S608
                    f"{donde}ORDER BY created_at DESC LIMIT :lim"
                ),
                params,
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def start_run(self, *, run_id: UUID, runner: str | None) -> dict[str, Any] | None:
        """`queued → running`, marcando cuándo y quién ejecuta.

        `runner` se puede fijar aquí y no solo al crear: quien encola no sabe qué
        máquina lo va a coger. Es el dato que explica dos ejecuciones con los mismos
        hiperparámetros y métricas distintas.
        """
        fila = (
            await self._session.execute(
                text(
                    "UPDATE ai.training_runs SET "  # noqa: S608
                    "  status = 'running', "
                    "  started_at = now(), "
                    "  runner = COALESCE(:runner, runner), "
                    "  updated_by = core.current_user_id() "
                    "WHERE id = CAST(:rid AS uuid) AND status = 'queued' "
                    f"RETURNING {_RUN_COLS}"
                ),
                {"rid": str(run_id), "runner": runner},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def finish_run(
        self,
        *,
        run_id: UUID,
        status: str,
        metrics: dict[str, Any] | None,
        error_message: str | None,
        model_version_id: UUID | None,
    ) -> dict[str, Any] | None:
        """Cierra la ejecución. `metrics` solo si salió bien; `error_message` solo si no.

        Lo imponen `chk_run_metrics_solo_exito` y `chk_run_error_solo_fallo`, y tiene
        sentido: unas métricas en una ejecución fallida son las del intento anterior o
        las de un cálculo a medias, y las dos cosas se leerían como resultado.

        `WHERE status = 'running'`: cerrar algo que no está corriendo no devuelve fila,
        y el servicio lo convierte en un 409. Sin ese filtro, cerrar dos veces
        machacaría las métricas de la primera vez —y el disparador de la base lo
        rechazaría con un mensaje que no explica que ya estaba cerrada—.
        """
        fila = (
            await self._session.execute(
                text(
                    "UPDATE ai.training_runs SET "  # noqa: S608
                    "  status = CAST(:estado AS varchar), "
                    "  finished_at = now(), "
                    "  metrics = CAST(:metricas AS jsonb), "
                    "  error_message = :error, "
                    "  model_version_id = CAST(:mvid AS uuid), "
                    "  updated_by = core.current_user_id() "
                    "WHERE id = CAST(:rid AS uuid) AND status = 'running' "
                    f"RETURNING {_RUN_COLS}"
                ),
                {
                    "rid": str(run_id),
                    "estado": status,
                    "metricas": _json(metrics) if metrics is not None else None,
                    "error": error_message,
                    "mvid": str(model_version_id) if model_version_id else None,
                },
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def cancel_run(self, *, run_id: UUID, reason: str) -> dict[str, Any] | None:
        """Cancela una ejecución que aún no ha terminado.

        Es la alternativa a borrar, que la base prohíbe: «una ejecución de
        entrenamiento no se borra: es el registro de qué datos produjeron un modelo».
        """
        fila = (
            await self._session.execute(
                text(
                    "UPDATE ai.training_runs SET "  # noqa: S608
                    "  status = 'cancelled', "
                    "  finished_at = now(), "
                    "  error_message = :motivo, "
                    "  updated_by = core.current_user_id() "
                    "WHERE id = CAST(:rid AS uuid) AND status IN ('queued', 'running') "
                    f"RETURNING {_RUN_COLS}"
                ),
                {"rid": str(run_id), "motivo": reason},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    # ── Versiones de pesos ─────────────────────────────────────────────────
    async def create_version(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        origin: str,
        weights_asset_id: UUID,
        source_reference: str | None,
        notes: str | None,
    ) -> dict[str, Any]:
        """Registra la versión en `registered`, numerándola en la misma sentencia.

        `COALESCE(MAX(version), 0) + 1` va DENTRO del INSERT: leer el máximo antes y
        sumar en Python haría que dos registros simultáneos calcularan el mismo número
        y el índice único los rechazara con un error que no dice qué ha pasado.
        """
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO ai.model_versions "  # noqa: S608
                    "(project_id, model_id, version, origin, weights_asset_id, "
                    " source_reference, notes, status, created_by, updated_by) "
                    "SELECT CAST(:pid AS uuid), CAST(:mid AS uuid), "
                    "       COALESCE(MAX(v.version), 0) + 1, :origen, "
                    "       CAST(:wid AS uuid), :ref, :notas, 'registered', "
                    "       core.current_user_id(), core.current_user_id() "
                    "  FROM ai.model_versions v "
                    " WHERE v.model_id = CAST(:mid AS uuid) "
                    f"RETURNING {_MV_COLS}"
                ),
                {
                    "pid": str(project_id),
                    "mid": str(model_id),
                    "origen": origin,
                    "wid": str(weights_asset_id),
                    "ref": source_reference,
                    "notas": notes,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def get_version(self, version_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_MV_COLS} FROM ai.model_versions "  # noqa: S608
                    "WHERE id = CAST(:vid AS uuid) AND deleted_at IS NULL"
                ),
                {"vid": str(version_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def list_versions(self, model_id: UUID) -> list[dict[str, Any]]:
        """Las versiones de un modelo, la más reciente primero, con sus métricas.

        Las métricas vienen de la EJECUCIÓN que produjo cada versión: viven en
        `training_runs.metrics` y no se copian aquí. Copiarlas daría dos sitios donde
        mirar el mAP de un modelo, y en cuanto alguien corrigiera uno, discreparían.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT v.id, v.project_id, v.model_id, v.version, v.origin, "
                    "       v.weights_asset_id, v.source_reference, v.notes, v.status, "
                    "       v.published_at, v.published_by, v.validated_at, "
                    "       v.deprecated_at, v.archived_at, v.failure_reason, "
                    "       v.created_at, v.updated_at, v.version_lock, v.deleted_at, "
                    "       r.id AS training_run_id, r.metrics "
                    "  FROM ai.model_versions v "
                    "  LEFT JOIN ai.training_runs r ON r.model_version_id = v.id "
                    " WHERE v.model_id = CAST(:mid AS uuid) AND v.deleted_at IS NULL "
                    " ORDER BY v.version DESC"
                ),
                {"mid": str(model_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def transition_version(
        self,
        *,
        version_id: UUID,
        to_status: str,
        failure_reason: str | None,
        expected_lock: int | None,
    ) -> dict[str, Any] | None:
        """Mueve el estado. La transición la valida el disparador de la base.

        Las MARCAS DE TIEMPO se ponen aquí y no en el disparador porque dependen de a
        dónde va, y los CHECK de la base las exigen coherentes: `published` necesita
        `published_at` y `published_by`, `validated` necesita `validated_at`, y así.

        `expected_lock` es control de concurrencia optimista opcional. Sin él, dos
        personas mirando la misma pantalla pueden publicar y degradar a la vez y la
        última gana en silencio.
        """
        condicion_lock = "AND version_lock = :lock " if expected_lock is not None else ""
        fila = (
            await self._session.execute(
                text(
                    "UPDATE ai.model_versions SET "  # noqa: S608
                    "  status = CAST(:estado AS varchar), "
                    "  validated_at = CASE WHEN CAST(:estado AS varchar) = 'validated' "
                    "                      THEN now() ELSE validated_at END, "
                    "  published_at = CASE "
                    "      WHEN CAST(:estado AS varchar) = 'published' THEN now() "
                    "      ELSE published_at END, "
                    "  published_by = CASE "
                    "      WHEN CAST(:estado AS varchar) = 'published' "
                    "      THEN core.current_user_id() ELSE published_by END, "
                    "  deprecated_at = CASE "
                    "      WHEN CAST(:estado AS varchar) = 'deprecated' THEN now() "
                    # Volver a publicar una degradada ES el rollback, y entonces la
                    # marca de degradación se limpia: dejarla puesta haría que la
                    # versión vigente dijera que fue retirada.
                    "      WHEN CAST(:estado AS varchar) = 'published' THEN NULL "
                    "      ELSE deprecated_at END, "
                    "  archived_at = CASE WHEN CAST(:estado AS varchar) = 'archived' "
                    "                     THEN now() ELSE archived_at END, "
                    "  failure_reason = CASE WHEN CAST(:estado AS varchar) = 'failed' "
                    "                        THEN :motivo ELSE NULL END, "
                    "  version_lock = version_lock + 1, "
                    "  updated_by = core.current_user_id() "
                    "WHERE id = CAST(:vid AS uuid) AND deleted_at IS NULL "
                    f"{condicion_lock}"
                    f"RETURNING {_MV_COLS}"
                ),
                {
                    "vid": str(version_id),
                    "estado": to_status,
                    "motivo": failure_reason,
                    **({"lock": expected_lock} if expected_lock is not None else {}),
                },
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def published_version_of(self, model_id: UUID) -> dict[str, Any] | None:
        """La versión publicada de un modelo, si hay alguna.

        Hay como máximo una: lo garantiza el índice único `uq_mv_publicada`. Por eso
        publicar una segunda exige degradar la anterior, y el servicio lo hace en la
        misma transacción.
        """
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {_MV_COLS} FROM ai.model_versions "  # noqa: S608
                    "WHERE model_id = CAST(:mid AS uuid) AND status = 'published' "
                    "  AND deleted_at IS NULL"
                ),
                {"mid": str(model_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    # ── Contexto para encolar ──────────────────────────────────────────────
    async def dataset_snapshot(self, dataset_version_id: UUID) -> dict[str, Any] | None:
        """La versión de dataset, con su recuento y su instantánea de clases.

        `class_snapshot` es lo que se copia a `class_map` de la ejecución: son las
        clases CON SU ÍNDICE en el momento de congelar el dataset, que es el momento
        que hay que reproducir para volver a entrenar lo mismo.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, project_id, version, name, class_snapshot, image_count, "
                    "       train_count, val_count, test_count, frozen_at "
                    "  FROM ai.dataset_versions WHERE id = CAST(:dvid AS uuid)"
                ),
                {"dvid": str(dataset_version_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def model_context(self, model_id: UUID) -> dict[str, Any] | None:
        """El modelo con lo necesario para encolar: proyecto, arquitectura, tarea."""
        fila = (
            await self._session.execute(
                text(
                    "SELECT m.id, m.project_id, m.name, m.slug, m.task, m.input_type, "
                    "       m.architecture_code, m.requires_training, m.status, "
                    "       a.default_hyperparams, a.min_images_recommended, "
                    "       a.requires_annotations, a.weights_extension "
                    "  FROM ai.models m "
                    "  LEFT JOIN ai.architectures a ON a.code = m.architecture_code "
                    " WHERE m.id = CAST(:mid AS uuid) AND m.deleted_at IS NULL"
                ),
                {"mid": str(model_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None


def _json(valor: Any) -> str:
    """`json.dumps` con el mismo criterio en todas las llamadas.

    Se pasa el jsonb como TEXTO con un CAST explícito y no como parámetro nativo:
    asyncpg no adapta `dict` a `jsonb` por su cuenta, y el error que da —«invalid
    input for query argument»— no dice qué columna era.
    """
    import json

    return json.dumps(valor, ensure_ascii=False, default=str)
