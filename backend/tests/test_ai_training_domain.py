"""Pruebas del dominio de entrenamiento y versionado.

── QUÉ SE PRUEBA AQUÍ Y QUÉ NO ──────────────────────────────────────────────

NO se prueba la matriz de transiciones. Vive en `ai.validate_version_transition()` y
ahí es autoridad única; `domain/ai/model.py` lo advirtió y `domain/ai/training.py` lo
respeta. Una prueba en Python de una matriz que no está en Python solo comprobaría que
la copia de la prueba coincide consigo misma.

Lo que sí se prueba es lo que este módulo DECIDE: qué es un dato incompleto, qué
distingue una versión ejecutable de una que no lo es, y qué métricas se echan de menos
sin llegar a rechazar el resultado.

`weights_asset_id` obligatorio tiene su propia prueba porque llegué a diseñarlo
opcional y la base lo rechazó con `NotNullViolationError`. La invariante es mejor que
mi diseño y merece quedar fijada aquí para que nadie la relaje.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from olo.domain.ai.training import (
    ESTADOS_TERMINALES,
    METRICAS_ESPERADAS,
    ModelOrigin,
    ModelVersion,
    TrainingRun,
    TrainingRunStatus,
)
from olo.domain.warehouse import DomainRuleError

AHORA = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)


def _run(**cambios: object) -> TrainingRun:
    base: dict[str, object] = {
        "id": uuid4(),
        "project_id": uuid4(),
        "model_id": uuid4(),
        "dataset_version_id": uuid4(),
        "architecture_code": "yolo11l",
        "status": TrainingRunStatus.QUEUED,
        "hyperparams": {"epochs": 50},
        "class_map": [{"name": "pallet", "index": 0}],
        "version": 1,
        "created_at": AHORA,
        "updated_at": AHORA,
    }
    base.update(cambios)
    return TrainingRun(**base)  # type: ignore[arg-type]


def _version(**cambios: object) -> ModelVersion:
    base: dict[str, object] = {
        "id": uuid4(),
        "project_id": uuid4(),
        "model_id": uuid4(),
        "version": 1,
        "origin": ModelOrigin.TRAINED,
        "status": "registered",
        "version_lock": 1,
        "weights_asset_id": uuid4(),
        "created_at": AHORA,
        "updated_at": AHORA,
    }
    base.update(cambios)
    return ModelVersion(**base)  # type: ignore[arg-type]


class TestTrainingRun:
    def test_sin_mapa_de_clases_no_se_construye(self) -> None:
        # Los índices son parte del modelo: sin ellos, la salida 0 no significa nada y
        # la ejecución no se puede reproducir ni interpretar.
        with pytest.raises(DomainRuleError, match="mapa de clases"):
            _run(class_map=[])

    def test_los_tres_estados_terminales_estan_completos(self) -> None:
        # Si alguien añade un estado terminal al CHECK de la base y no lo añade aquí,
        # `terminada` diría que una ejecución acabada sigue viva.
        assert {
            TrainingRunStatus.SUCCEEDED,
            TrainingRunStatus.FAILED,
            TrainingRunStatus.CANCELLED,
        } == ESTADOS_TERMINALES
        assert not _run(status=TrainingRunStatus.QUEUED).terminada
        assert not _run(status=TrainingRunStatus.RUNNING).terminada
        for estado in ESTADOS_TERMINALES:
            assert _run(status=estado).terminada

    def test_sin_metricas_faltan_todas_las_esperadas(self) -> None:
        assert _run().metricas_ausentes == METRICAS_ESPERADAS
        # `{}` y `None` significan lo mismo aquí —nadie reportó nada— y confundirlos
        # daría «no falta ninguna» para una ejecución que no midió nada.
        assert _run(metrics={}).metricas_ausentes == METRICAS_ESPERADAS

    def test_con_todas_las_metricas_no_falta_ninguna(self) -> None:
        completas = dict.fromkeys(METRICAS_ESPERADAS, 0.5)
        assert _run(metrics=completas).metricas_ausentes == ()

    def test_las_ausentes_se_nombran_una_por_una(self) -> None:
        # Es lo que hace útil el aviso: «esta ejecución no trae mAP» en lugar de un
        # booleano que obliga a mirar el JSON a mano.
        assert _run(metrics={"epochs": 3, "map50": 0.8}).metricas_ausentes == (
            "map50_95",
            "precision",
            "recall",
            "train_seconds",
        )

    def test_un_map_de_cero_cuenta_como_reportado(self) -> None:
        # 0 es una medida —el modelo no acierta nada— y no una ausencia. Si el chequeo
        # usara verdad/falsedad en vez de presencia de la clave, un modelo malísimo
        # aparecería como «sin métricas» y nadie vería lo mal que salió.
        assert "map50" not in _run(metrics={"map50": 0.0}).metricas_ausentes


class TestModelVersion:
    def test_solo_publicada_es_ejecutable(self) -> None:
        # Es el mismo filtro que `perception.v_published_models` (0070), y la razón de
        # que ese filtro sea la frontera: publicar es el acto explícito por el que
        # alguien declara unos pesos utilizables.
        assert _version(status="published").ejecutable
        for otro in ("registered", "validating", "validated", "deprecated", "archived", "failed"):
            assert not _version(status=otro).ejecutable

    def test_preentrenada_sin_procedencia_no_se_construye(self) -> None:
        with pytest.raises(DomainRuleError, match="source_reference"):
            _version(origin=ModelOrigin.PRETRAINED, source_reference=None)

    def test_importada_con_procedencia_en_blanco_tampoco(self) -> None:
        # `"   "` pasaría un `is None` y no dice de dónde vienen los pesos.
        with pytest.raises(DomainRuleError, match="source_reference"):
            _version(origin=ModelOrigin.IMPORTED, source_reference="   ")

    def test_entrenada_no_necesita_procedencia_externa(self) -> None:
        # Su procedencia es su ejecución de entrenamiento, que es un registro completo:
        # qué dataset, qué hiperparámetros, qué máquina y qué métricas.
        assert _version(origin=ModelOrigin.TRAINED, source_reference=None).version == 1

    def test_el_archivo_de_pesos_es_obligatorio(self) -> None:
        # Se diseñó opcional y la base lo rechazó con `NotNullViolationError`: la
        # columna es NOT NULL desde 0043. La invariante dice algo cierto —una versión
        # sin archivo no es una versión, es una anotación sobre unas métricas— y esta
        # prueba existe para que nadie la relaje volviendo a hacerlo opcional.
        with pytest.raises(TypeError):
            ModelVersion(  # type: ignore[call-arg]
                id=uuid4(),
                project_id=uuid4(),
                model_id=uuid4(),
                version=1,
                origin=ModelOrigin.TRAINED,
                status="registered",
                version_lock=1,
                created_at=AHORA,
                updated_at=AHORA,
            )

    def test_los_dos_campos_de_procedencia_dicen_cosas_distintas(self) -> None:
        # `weights_asset_id` es DONDE ESTAN los bytes; `source_reference`, de DONDE
        # VIENEN. Una version importada necesita los dos, y son campos separados
        # precisamente porque responden preguntas distintas.
        v = _version(
            origin=ModelOrigin.IMPORTED,
            source_reference="https://github.com/ultralytics/assets/yolo11l.pt",
        )
        assert v.weights_asset_id is not None
        assert v.source_reference is not None
        assert not v.ejecutable  # y aun asi no se puede usar hasta publicarla
