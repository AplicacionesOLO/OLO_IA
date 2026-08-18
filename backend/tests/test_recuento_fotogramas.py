"""CUANTOS FOTOGRAMAS DICE UN TRABAJO QUE VA A ANALIZAR.

── DE DONDE SALE ESTE ARCHIVO ──────────────────────────────────────────────────────

De un trabajo que decia «1 de 1» mientras guardaba 545 detecciones repartidas en 203
fotogramas distintos. `DJI_20260308105811_0008_D.MP4`, medido: el analisis estaba bien y
el contador mentia, y quien miraba la pantalla no tenia forma de saber cual de las dos
cosas creer — que es peor que un fallo que se ve—.

La cadena era esta, y ningun eslabon fallo con un error:

    Chrome no decodifica H.265        →  `getVideoMeta` devuelve ceros y calla
    ceros                             →  `duration_ms` y `total_frames` nulos en el medio
    los dos nulos                     →  `_frames_a_analizar` devuelve 1
    `frames_total = 1`                →  `bump_frames` acota con LEAST y el progreso
                                          se clava en 1 de 1

Lo que se prueba aqui es el eslabon tercero —que sigue devolviendo 1, porque inventar un
total es peor— y el remiendo: que el worker, que es el UNICO que sabe cuantos va a mirar,
puede corregirlo, y que esa correccion no se cuela donde no debe.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest

from olo.core.errors import BusinessRuleError
from olo.services.perception import PerceptionService

FRAMES = PerceptionService._frames_a_analizar
JOB = UUID("7ed211d0-89a8-41b3-a486-0c5b3d604f70")
MEDIA = uuid4()


class RepoFalso:
    """Lo justo para ver QUE se le pide al repositorio, que es lo que se prueba."""

    def __init__(self, job: dict[str, Any]) -> None:
        self._job = job
        self.medio: list[tuple[UUID, int]] = []
        self.trabajo: list[tuple[UUID, int]] = []

    async def get_job(self, job_id: UUID) -> dict[str, Any] | None:
        return self._job

    async def fijar_total_de_fotogramas(self, media_id: UUID, total: int) -> int:
        self.medio.append((media_id, total))
        return 1

    async def fijar_total_del_trabajo(self, job_id: UUID, total: int) -> int:
        self.trabajo.append((job_id, total))
        #  Como el UPDATE de verdad: el total pasa a ser el que se pide.
        self._job = {**self._job, "frames_total": total}
        return 1


def servicio(job: dict[str, Any]) -> tuple[PerceptionService, RepoFalso]:
    svc = PerceptionService.__new__(PerceptionService)
    repo = RepoFalso(job)
    svc._repo = repo  # type: ignore[assignment]
    return svc, repo


def video(**extra: Any) -> dict[str, Any]:
    return {
        "id": JOB,
        "media_id": MEDIA,
        "media_kind": "video",
        "frames_total": 1,
        "frames_processed": 0,
        **extra,
    }


# ══════════════════════════════════════════════════════════════════════════════
# LA ESTIMACION DEL ALTA
# ══════════════════════════════════════════════════════════════════════════════


def test_sin_duracion_ni_recuento_el_total_es_uno():
    """El eslabon donde nace el «1 de 1». Se prueba que SIGUE siendo 1.

    Podria parecer que el arreglo es estimar algo aqui, y no lo es: sin duracion no hay de
    donde sacar el numero, y una barra sobre un total inventado avanza a una velocidad que
    no es la real y termina antes o despues de lo que dice. El 1 es honesto — lo que
    faltaba era corregirlo cuando el dato aparece—.
    """
    assert FRAMES(duration_ms=None, total_frames=None, fps=10.0) == 1
    #  Cero cuenta como ausente: es lo que manda el navegador cuando no pudo leer nada.
    assert FRAMES(duration_ms=0, total_frames=0, fps=10.0) == 1


def test_con_duracion_es_la_multiplicacion():
    #  14,5 s a 10 fps de muestreo. El caso normal, el de los videos que Chrome si lee.
    assert FRAMES(duration_ms=14507, total_frames=434, fps=10.0) == 145


def test_el_recuento_del_video_no_es_lo_que_se_analiza():
    """Un sesgo del otro lado, y por eso el worker manda las dos cifras.

    Sin duracion se usa el total del video: 634. Pero a 10 fps sobre 29,97 reales se miran
    212. Anunciar 634 deja una barra que termina en el 33 % y un trabajo que parece a
    medias cuando esta entero.
    """
    assert FRAMES(duration_ms=None, total_frames=634, fps=10.0) == 634


# ══════════════════════════════════════════════════════════════════════════════
# LA CORRECCION DEL WORKER
# ══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_el_worker_corrige_el_total_del_trabajo():
    """El caso real: 634 al medio, 212 al trabajo. Son dos cifras distintas a proposito."""
    svc, repo = servicio(video())
    salida = await svc.registrar_total_de_fotogramas(
        job_id=JOB, total_frames=634, frames_to_analyze=212
    )
    assert repo.medio == [(MEDIA, 634)]
    assert repo.trabajo == [(JOB, 212)]
    assert salida["job_frames_total"] == 212


@pytest.mark.asyncio
async def test_un_worker_que_no_lo_manda_no_toca_el_trabajo():
    """Compatibilidad, y no es teorica: el worker corre fuera y no se actualiza a la vez
    que el servidor. Un worker antiguo tiene que seguir anotando el recuento del medio sin
    dejar el trabajo a medio corregir."""
    svc, repo = servicio(video())
    salida = await svc.registrar_total_de_fotogramas(job_id=JOB, total_frames=634)
    assert repo.medio == [(MEDIA, 634)]
    assert repo.trabajo == []
    assert salida["job_frames_total"] is None


@pytest.mark.asyncio
async def test_la_respuesta_lleva_lo_que_quedo_anotado():
    """Y no lo que se pidio. Si el trabajo ya no admitia correccion —terminado— el numero
    no cambia, y el worker lo dice en su salida en vez de dar por hecho que cuajo."""
    svc, repo = servicio(video())

    async def no_toca(job_id: UUID, total: int) -> int:
        return 0  # el UPDATE no encontro fila: ni `queued` ni `running`

    repo.fijar_total_del_trabajo = no_toca  # type: ignore[method-assign]
    salida = await svc.registrar_total_de_fotogramas(
        job_id=JOB, total_frames=634, frames_to_analyze=212
    )
    assert salida["job_frames_total"] == 1


@pytest.mark.asyncio
async def test_de_una_foto_no_se_cuenta_nada():
    """La comprobacion que ya habia, y que este cambio no puede haber aflojado: una foto
    tiene un fotograma y un directo no tiene final."""
    svc, _ = servicio(video(media_kind="image"))
    with pytest.raises(BusinessRuleError):
        await svc.registrar_total_de_fotogramas(
            job_id=JOB, total_frames=634, frames_to_analyze=212
        )
