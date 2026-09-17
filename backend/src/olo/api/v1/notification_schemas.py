"""Esquemas de avisos (0104)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from olo.api.v1.schemas import ApiModel


class NotificationOut(ApiModel):
    id: UUID
    kind: str
    title: str
    body: str
    link: str | None
    email_sent_at: datetime | None
    read_at: datetime | None
    created_at: datetime


class NotificationListOut(ApiModel):
    notifications: list[NotificationOut]
    unread_count: int
