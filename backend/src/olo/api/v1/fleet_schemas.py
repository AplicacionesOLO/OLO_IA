"""Esquemas de la flota de dispositivos de borde (0110). Ver ADR-015."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field

from olo.api.v1.schemas import ApiModel


class DeviceHeartbeatIn(ApiModel):
    """El latido de un dispositivo de flota.

    Un solo endpoint para registrarse y para latir, igual que
    `WorkerHeartbeatIn`: un dispositivo que arranca no sabe si ya tenia fila
    -puede venir de una reinstalacion del APK que borro todo menos
    `device_key`-, y obligarlo a consultar antes abriria una carrera entre la
    consulta y el registro. El `ON CONFLICT` de 0110 la absorbe.
    """

    #: Identidad que el PROPIO dispositivo persiste entre reinicios de la
    #: app (ver la cabecera de la migracion 0110) -- no la genera el servidor.
    device_key: Annotated[str, Field(min_length=1, max_length=120)]
    kind: Literal["phone", "drone", "onboard_compute"]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    warehouse_id: UUID
    app_version: Annotated[str, Field(max_length=40)] | None = None
    device_model: Annotated[str, Field(max_length=80)] | None = None
    #: En que job esta ahora, si esta en alguno. Informativo, igual que
    #: `WorkerHeartbeatIn.current_job`: la autoridad sobre un job es el job.
    current_job_id: UUID | None = None


class DeviceRetireIn(ApiModel):
    reason: Annotated[str, Field(max_length=200)] | None = None


class DeviceProvisionIn(ApiModel):
    """Da de alta un dispositivo CON credencial propia -- a diferencia de
    `DeviceHeartbeatIn`, que solo registra el latido de uno que ya trae su
    `device_key`. Aqui el backend genera todo, incluida la identidad."""

    warehouse_id: UUID
    kind: Literal["phone", "drone", "onboard_compute"]
    name: Annotated[str, Field(min_length=1, max_length=120)]


class DeviceOut(ApiModel):
    id: UUID
    warehouse_id: UUID
    device_key: str
    kind: str
    name: str
    app_version: str | None
    device_model: str | None
    registered_at: datetime
    last_seen_at: datetime
    current_job_id: UUID | None
    status: Literal["connected", "live", "offline", "out_of_service"]
    retired_at: datetime | None
    retired_reason: str | None


class DeviceListOut(ApiModel):
    devices: list[DeviceOut]
    #: Cuantos estan conectados o en vivo AHORA -- la cifra que responde
    #: "¿tenemos flota operativa en este momento?" de un vistazo.
    online: int


class DeviceProvisionOut(ApiModel):
    device: DeviceOut
    #: El secreto que el dispositivo necesita para autenticarse -- ver
    #: `POST /auth/refresh`. Se devuelve UNA sola vez, en esta respuesta: el
    #: backend no lo vuelve a guardar en ningun sitio que pueda leerse despues
    #: (vive solo como refresh token vigente en Supabase Auth).
    refresh_token: str


class FleetOfflineAlertOut(ApiModel):
    #: Nombres de los dispositivos de los que se aviso en este barrido --
    #: vacio si ninguno lleva lo suficiente sin latir, o si ya se habia
    #: avisado de esta misma caida (idempotente).
    dispositivos_avisados: list[str]
