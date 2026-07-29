"""Entidad de dominio Warehouse.

Sin dependencias de FastAPI, SQLAlchemy ni Pydantic: la capa de dominio no
conoce frameworks. Las reglas que puede comprobar por sí sola viven aquí; las
que dependen del estado de otras filas las impone la base de datos.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

_CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]*$")


class WarehouseStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    MAINTENANCE = "maintenance"


class DomainRuleError(ValueError):
    """Regla de dominio violada. La API la traduce a 422."""


@dataclass(slots=True)
class Warehouse:
    id: UUID
    tenant_id: UUID
    company_id: UUID
    name: str
    code: str
    status: WarehouseStatus
    timezone: str
    locale: str
    version: int
    created_at: datetime
    updated_at: datetime
    currency_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    address: dict[str, Any] | None = None
    settings: dict[str, Any] = field(default_factory=dict)
    deleted_at: datetime | None = None

    # ── Invariantes que el dominio puede comprobar solo ───────────────────
    def __post_init__(self) -> None:
        if len(self.name.strip()) < 2:
            msg = "El nombre del almacén debe tener al menos 2 caracteres"
            raise DomainRuleError(msg)
        if not _CODE_RE.match(self.code):
            msg = (
                f"El código {self.code!r} debe empezar por letra mayúscula o dígito "
                "y contener solo mayúsculas, dígitos y guiones"
            )
            raise DomainRuleError(msg)
        # Una coordenada sola no ubica nada. Mismo invariante que el CHECK
        # chk_wh_coords: se comprueba aquí para dar un error de negocio claro
        # antes de llegar al motor.
        if (self.latitude is None) != (self.longitude is None):
            msg = "Latitud y longitud deben indicarse juntas o ninguna de las dos"
            raise DomainRuleError(msg)

    @property
    def is_active(self) -> bool:
        return self.status is WarehouseStatus.ACTIVE and self.deleted_at is None

    @property
    def is_operational(self) -> bool:
        """Un almacén en mantenimiento existe pero no admite operaciones."""
        return self.is_active

    def has_coordinates(self) -> bool:
        return self.latitude is not None and self.longitude is not None
