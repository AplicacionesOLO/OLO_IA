"""Proyecto de IA: agrupa un pool de imágenes, un vocabulario y VARIOS modelos."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from olo.domain.warehouse import DomainRuleError

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

# Topes de cordura de la migración 0025. Se repiten aquí para dar un error de
# negocio claro antes de llegar al CHECK, no para sustituirlo.
MAX_INTERVALO_FRAMES_S = 60.0
MAX_FRAMES_POR_VIDEO = 100_000
MAX_DURACION_VIDEO_S = 7_200


class ProjectStatus(StrEnum):
    DRAFT = "draft"
    COLLECTING = "collecting"
    ANNOTATING = "annotating"
    TRAINING = "training"
    PUBLISHED = "published"
    ARCHIVED = "archived"


@dataclass(slots=True)
class AiProject:
    """Un proyecto de ENTRENAMIENTO, no un proyecto físico.

    La distinción importa y está en ADR-008 §3.3: aquí viven imágenes, clases y
    modelos que se entrenan juntos. El almacén, su geometría y sus drones son otro
    dominio.

    NO tiene `base_model` ni `task`: la migración 0034 los movió a `ai.models`,
    porque un proyecto con cinco modelos no tiene UNA arquitectura ni UNA tarea.
    """

    id: UUID
    name: str
    slug: str
    status: ProjectStatus
    version: int
    created_at: datetime
    updated_at: datetime
    description: str | None = None

    # Extracción de frames: configurable POR PROYECTO, no un límite global.
    # Alimenta el pool de imágenes, que es del proyecto y compartido entre modelos.
    frame_interval_seconds: float = 1.0
    max_frames_per_video: int = 1000
    max_video_duration_secs: int = 1200

    deleted_at: datetime | None = None

    def __post_init__(self) -> None:
        if len(self.name.strip()) < 2:
            msg = "El nombre del proyecto debe tener al menos 2 caracteres"
            raise DomainRuleError(msg)

        if not _SLUG_RE.match(self.slug):
            msg = (
                f"El slug {self.slug!r} debe empezar por minúscula o dígito y "
                "contener solo minúsculas, dígitos y guiones"
            )
            raise DomainRuleError(msg)

        if not 0 < self.frame_interval_seconds <= MAX_INTERVALO_FRAMES_S:
            msg = (
                f"El intervalo de extracción debe estar entre 0 y "
                f"{MAX_INTERVALO_FRAMES_S:g} segundos"
            )
            raise DomainRuleError(msg)

        if not 1 <= self.max_frames_per_video <= MAX_FRAMES_POR_VIDEO:
            msg = f"El máximo de frames por vídeo debe estar entre 1 y {MAX_FRAMES_POR_VIDEO}"
            raise DomainRuleError(msg)

        if not 1 <= self.max_video_duration_secs <= MAX_DURACION_VIDEO_S:
            msg = f"La duración máxima de vídeo debe estar entre 1 y {MAX_DURACION_VIDEO_S} s"
            raise DomainRuleError(msg)

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None and self.status is not ProjectStatus.ARCHIVED

    def frames_estimados(self, duracion_segundos: float) -> int:
        """Cuántos frames saldrían de un vídeo, con la configuración del proyecto.

        Sirve para avisar ANTES de subir: un vídeo de 10 minutos a 1 fps son 600
        imágenes que alguien tendrá que anotar. Enterarse después de la subida es
        peor, y enterarse después de anotar 600 es mucho peor.
        """
        if duracion_segundos <= 0:
            return 0
        por_intervalo = int(duracion_segundos / self.frame_interval_seconds)
        return min(por_intervalo, self.max_frames_per_video)

    def excede_duracion(self, duracion_segundos: float) -> bool:
        return duracion_segundos > self.max_video_duration_secs
