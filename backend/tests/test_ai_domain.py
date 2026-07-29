"""Dominio de IA: invariantes que no necesitan base de datos.

    pytest tests/test_ai_domain.py

Casi todas son puras. La excepción son las dos últimas, marcadas `integration`, que
comparan los enums de Python contra los dominios de PostgreSQL. Esa comparación es
lo que evita que las dos listas se separen en silencio: si divergieran, el motor
rechazaría el valor y el cliente recibiría un 500 donde correspondía un 422.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest

from olo.domain.ai import (
    AiClass,
    AiModel,
    AiProject,
    Architecture,
    Framework,
    InputType,
    ModelClass,
    ModelStatus,
    ModelVersionStatus,
    ProjectStatus,
    Task,
    asignar_indices_contiguos,
)
from olo.domain.ai.klass import siguiente_class_index
from olo.domain.warehouse import DomainRuleError

_AHORA = datetime(2026, 7, 29, tzinfo=UTC)


def _proyecto(**kw: Any) -> AiProject:
    base: dict[str, Any] = {
        "id": uuid4(),
        "name": "Inventario EPA",
        "slug": "inventario-epa",
        "status": ProjectStatus.DRAFT,
        "version": 1,
        "created_at": _AHORA,
        "updated_at": _AHORA,
    }
    return AiProject(**{**base, **kw})


def _modelo(**kw: Any) -> AiModel:
    base: dict[str, Any] = {
        "id": uuid4(),
        "project_id": uuid4(),
        "name": "Detector YOLO",
        "slug": "detector-yolo",
        "architecture_code": "yolo11m",
        "task": Task.DETECT,
        "input_type": InputType.IMAGE,
        "status": ModelStatus.DRAFT,
        "requires_training": True,
        "version": 1,
        "created_at": _AHORA,
        "updated_at": _AHORA,
    }
    return AiModel(**{**base, **kw})


def _arquitectura(**kw: Any) -> Architecture:
    base: dict[str, Any] = {
        "code": "yolo11m",
        "framework_code": "ultralytics",
        "display_name": "YOLO11 medium",
        "family": "yolo11",
        "supported_tasks": frozenset({Task.DETECT, Task.SEGMENT, Task.CLASSIFY, Task.POSE}),
        "supported_input_types": frozenset(
            {InputType.IMAGE, InputType.VIDEO, InputType.FRAMES}
        ),
        "supported_annotation_kinds": frozenset({"bbox", "polygon"}),
        "requires_training": True,
        "requires_annotations": True,
        "is_active": True,
    }
    return Architecture(**{**base, **kw})


# ══ Proyecto ═══════════════════════════════════════════════════════════════
def test_01_proyecto_valido() -> None:
    p = _proyecto()
    assert p.is_active


@pytest.mark.parametrize(
    ("campo", "valor"),
    [
        ("name", "X"),                      # menos de 2 caracteres
        ("slug", "Mayúsculas"),             # patrón
        ("slug", "-empieza-por-guion"),
        ("frame_interval_seconds", 0),       # tiene que ser > 0
        ("frame_interval_seconds", 61),      # tope de cordura
        ("max_frames_per_video", 0),
        ("max_frames_per_video", 100_001),
        ("max_video_duration_secs", 0),
        ("max_video_duration_secs", 7_201),
    ],
)
def test_02_proyecto_rechaza_valores_invalidos(campo: str, valor: Any) -> None:
    with pytest.raises(DomainRuleError):
        _proyecto(**{campo: valor})


def test_03_frames_estimados_respeta_el_tope() -> None:
    """La cuenta que avisa antes de subir, no después de anotar 600 imágenes."""
    p = _proyecto(frame_interval_seconds=1.0, max_frames_per_video=100)
    assert p.frames_estimados(60) == 60          # 1 fps durante un minuto
    assert p.frames_estimados(600) == 100        # el tope corta
    assert p.frames_estimados(0) == 0
    assert p.frames_estimados(-5) == 0

    lento = _proyecto(frame_interval_seconds=5.0, max_frames_per_video=1000)
    assert lento.frames_estimados(60) == 12      # un frame cada 5 s


def test_04_excede_duracion() -> None:
    p = _proyecto(max_video_duration_secs=1200)
    assert not p.excede_duracion(1200)
    assert p.excede_duracion(1201)


def test_05_un_proyecto_archivado_no_esta_activo() -> None:
    assert not _proyecto(status=ProjectStatus.ARCHIVED).is_active
    assert not _proyecto(deleted_at=_AHORA).is_active


# ══ Modelo ═════════════════════════════════════════════════════════════════
def test_06_el_modelo_no_tiene_framework_propio() -> None:
    """`framework_code` es DERIVADO y opcional, no parte de la identidad.

    La migración 0042 eliminó la columna. Que el campo del dominio sea `None` por
    defecto es lo que impide construir un modelo «con framework» y creer que se
    persiste.
    """
    m = _modelo()
    assert m.framework_code is None
    assert m.framework_adapter is None

    # Se rellena solo al leer de la vista.
    enriquecido = _modelo(framework_code="ultralytics", framework_adapter="ultralytics")
    assert enriquecido.framework_adapter == "ultralytics"


def test_07_contrato_congelado_solo_si_se_consulto_el_conteo() -> None:
    """`None` significa «no se consultó», no «no tiene».

    Tratar la ausencia del dato como cero permitiría intentar una edición que el
    motor va a rechazar de todos modos, con un 409 en lugar de un mensaje útil.
    """
    assert _modelo(version_count=None).contrato_congelado is False
    assert _modelo(version_count=0).contrato_congelado is False
    assert _modelo(version_count=1).contrato_congelado is True


def test_08_detecta_que_campos_del_contrato_cambian() -> None:
    m = _modelo(task=Task.DETECT, input_type=InputType.IMAGE, architecture_code="yolo11m")

    assert m.campos_del_contrato_modificados({"task": "segment"}) == ["task"]
    assert m.campos_del_contrato_modificados(
        {"architecture_code": "rtdetr-l", "input_type": "frames"}
    ) == ["architecture_code", "input_type"]

    # Enviar el MISMO valor no es una modificación: obligar al cliente a recortar el
    # cuerpo antes de cada PATCH sería una fricción sin motivo.
    assert m.campos_del_contrato_modificados({"task": Task.DETECT}) == []
    assert m.campos_del_contrato_modificados({"name": "Otro nombre"}) == []


def test_09_version_publicada_es_derivada() -> None:
    assert not _modelo().tiene_version_publicada
    assert _modelo(published_version_id=uuid4()).tiene_version_publicada


@pytest.mark.parametrize(("campo", "valor"), [("name", "X"), ("slug", "MAL")])
def test_10_modelo_rechaza_valores_invalidos(campo: str, valor: Any) -> None:
    with pytest.raises(DomainRuleError):
        _modelo(**{campo: valor})


# ══ Catálogo ═══════════════════════════════════════════════════════════════
def test_11_valida_la_combinacion_con_la_lista_de_alternativas() -> None:
    """El mensaje debe decir qué SÍ soporta. Es la razón de duplicar la regla."""
    a = _arquitectura()
    a.validate_combination(Task.DETECT, InputType.IMAGE)   # no lanza

    with pytest.raises(DomainRuleError) as exc:
        a.validate_combination(Task.OCR, InputType.IMAGE)
    texto = str(exc.value)
    assert "ocr" in texto
    assert "detect" in texto and "segment" in texto, "el mensaje debe listar alternativas"

    with pytest.raises(DomainRuleError) as exc2:
        a.validate_combination(Task.DETECT, InputType.THERMAL)
    assert "thermal" in str(exc2.value)


def test_12_una_arquitectura_desactivada_se_rechaza() -> None:
    with pytest.raises(DomainRuleError, match="desactivada"):
        _arquitectura(is_active=False).validate_combination(Task.DETECT, InputType.IMAGE)


def test_13_zero_shot_y_coherencia_de_anotaciones() -> None:
    sam = _arquitectura(
        code="sam2-b",
        framework_code="pytorch",
        supported_tasks=frozenset({Task.SEGMENT}),
        supported_annotation_kinds=frozenset(),
        requires_training=False,
        requires_annotations=False,
    )
    assert sam.es_zero_shot
    assert not sam.hiperparametros_verificados

    yolo = _arquitectura(hyperparam_schema={"epochs": {"type": "integer"}})
    assert not yolo.es_zero_shot
    assert yolo.hiperparametros_verificados


@pytest.mark.parametrize(
    "cambios",
    [
        # necesita anotaciones pero no dice cuáles
        {"requires_annotations": True, "supported_annotation_kinds": frozenset()},
        # no las necesita pero declara tipos
        {
            "requires_training": False,
            "requires_annotations": False,
            "supported_annotation_kinds": frozenset({"bbox"}),
        },
        # entrenar sin anotaciones
        {
            "requires_training": True,
            "requires_annotations": False,
            "supported_annotation_kinds": frozenset(),
        },
        {"supported_tasks": frozenset()},
        {"supported_input_types": frozenset()},
    ],
)
def test_14_el_catalogo_rechaza_capacidades_incoherentes(cambios: dict[str, Any]) -> None:
    with pytest.raises(DomainRuleError):
        _arquitectura(**cambios)


def test_15_soporta_es_una_consulta_sin_excepcion() -> None:
    a = _arquitectura()
    assert a.soporta(Task.DETECT, InputType.IMAGE)
    assert not a.soporta(Task.OCR, InputType.IMAGE)


def test_16_framework_lleva_su_adaptador() -> None:
    f = Framework(
        code="ultralytics", display_name="Ultralytics", adapter="ultralytics", is_active=True
    )
    assert f.adapter == "ultralytics"


# ══ Clases y vocabulario ═══════════════════════════════════════════════════
def _clase(**kw: Any) -> AiClass:
    base: dict[str, Any] = {
        "id": uuid4(),
        "project_id": uuid4(),
        "name": "pallet",
        "class_index": 0,
        "color": "#FF8800",
        "is_active": True,
        "version": 1,
        "created_at": _AHORA,
        "updated_at": _AHORA,
    }
    return AiClass(**{**base, **kw})


@pytest.mark.parametrize(
    ("campo", "valor"),
    [
        ("name", "   "),
        ("class_index", -1),
        ("color", "FF8800"),      # sin almohadilla
        ("color", "#FF88"),       # corto
        ("color", "#GGGGGG"),     # no hexadecimal
    ],
)
def test_17_clase_rechaza_valores_invalidos(campo: str, valor: Any) -> None:
    with pytest.raises(DomainRuleError):
        _clase(**{campo: valor})


def test_18_una_clase_desactivada_no_es_usable() -> None:
    """Sus anotaciones quedan fuera de los datasets futuros.

    Un modelo que la declarara entrenaría sobre nada para esa etiqueta.
    """
    assert _clase().usable
    assert not _clase(is_active=False).usable
    assert not _clase(deleted_at=_AHORA).usable


def test_19_indices_contiguos_por_posicion() -> None:
    """El orden de la lista ES el índice. Es la operación del PUT."""
    a, b, c = uuid4(), uuid4(), uuid4()
    assert asignar_indices_contiguos([a, b, c]) == [(a, 0), (b, 1), (c, 2)]
    # Reordenar produce índices distintos, que es justo el caso que el PUT resuelve
    # de forma atómica.
    assert asignar_indices_contiguos([c, a, b]) == [(c, 0), (a, 1), (b, 2)]


def test_20_el_vocabulario_no_admite_duplicados() -> None:
    """Repetir una clase daría dos índices a la misma etiqueta."""
    a, b = uuid4(), uuid4()
    with pytest.raises(DomainRuleError, match="repetir"):
        asignar_indices_contiguos([a, b, a])


def test_21_el_vocabulario_no_puede_estar_vacio() -> None:
    with pytest.raises(DomainRuleError, match="vacío"):
        asignar_indices_contiguos([])


def test_22_siguiente_indice_no_reutiliza_huecos() -> None:
    """Con 0, 1, 3 devuelve 4 y no 2.

    Reutilizar el 2 haría que un modelo entrenado con la clase 2 antigua
    interpretara la nueva con esa etiqueta — y sin error alguno.
    """
    assert siguiente_class_index([]) == 0
    assert siguiente_class_index([0]) == 1
    assert siguiente_class_index([0, 1, 3]) == 4
    assert siguiente_class_index([7]) == 8


def test_23_model_class_valida_su_indice() -> None:
    with pytest.raises(DomainRuleError):
        ModelClass(
            model_id=uuid4(),
            class_id=uuid4(),
            project_id=uuid4(),
            training_index=-1,
            created_at=_AHORA,
        )


# ══ 24-25 · Los enums contra la base ═══════════════════════════════════════
@pytest.mark.integration
async def test_24_los_enums_coinciden_con_los_dominios_de_postgres() -> None:
    """LA PRUEBA QUE EVITA UNA DIVERGENCIA SILENCIOSA.

    `Task` e `InputType` espejan los dominios `ai.task` y `ai.input_type`. Si una
    lista creciera y la otra no, el motor rechazaría el valor y el cliente vería un
    500 donde correspondía un 422 — o peor: una tarea válida en la base que la API
    no ofrece, y nadie se enteraría de que existe.

    Se leen los CHECK de los dominios en lugar de mantener una copia de la lista en
    la prueba, que solo trasladaría el problema.
    """
    import re as _re

    from .admin_conn import admin_tx

    async with admin_tx() as c:
        filas = await c.fetch(
            "SELECT t.typname, pg_get_constraintdef(co.oid) AS definicion "
            "FROM pg_type t "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "JOIN pg_constraint co ON co.contypid = t.oid "
            "WHERE n.nspname = 'ai' AND t.typname = ANY($1::text[])",
            ["task", "input_type"],
        )

    por_nombre = {r["typname"]: r["definicion"] for r in filas}
    assert set(por_nombre) == {"task", "input_type"}, f"faltan dominios: {por_nombre}"

    esperado = {
        "task": {t.value for t in Task},
        "input_type": {i.value for i in InputType},
    }
    for dominio, definicion in por_nombre.items():
        en_la_base = set(_re.findall(r"'([a-z_]+)'::", definicion))
        assert en_la_base == esperado[dominio], (
            f"el dominio ai.{dominio} y el enum de Python han divergido. "
            f"Solo en la base: {sorted(en_la_base - esperado[dominio])}. "
            f"Solo en Python: {sorted(esperado[dominio] - en_la_base)}."
        )


@pytest.mark.integration
async def test_25_los_estados_de_version_coinciden_con_el_check() -> None:
    """`ModelVersionStatus` contra `chk_mv_status` de la migración 0043."""
    import re as _re

    from .admin_conn import admin_tx

    async with admin_tx() as c:
        definicion = await c.fetchval(
            "SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c "
            "JOIN pg_class t ON t.oid = c.conrelid "
            "JOIN pg_namespace n ON n.oid = t.relnamespace "
            "WHERE n.nspname='ai' AND t.relname='model_versions' AND c.conname='chk_mv_status'"
        )

    assert definicion, "no encuentro chk_mv_status"
    en_la_base = set(_re.findall(r"'([a-z_]+)'::", definicion))
    en_python = {s.value for s in ModelVersionStatus}
    assert en_la_base == en_python, (
        f"Solo en la base: {sorted(en_la_base - en_python)}. "
        f"Solo en Python: {sorted(en_python - en_la_base)}."
    )
