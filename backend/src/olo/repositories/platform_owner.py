"""Lectura y escritura de platform.owners.

Sin filtrado por owner en el SQL: lo impone RLS, igual que en el resto de los
repositorios el aislamiento por tenant lo impone la política y no el WHERE. Un
filtro aquí daría una falsa sensación de seguridad y podría divergir de la
política.

── CONCEDER Y REVOCAR NO VALIDAN NADA AQUÍ, A PROPÓSITO ─────────────────────

`chk_owner_no_self_grant`, `chk_owner_reason_no_vacia` y el disparador del último
owner ya viven en la base (0020) y son la autoridad única. Este módulo solo
traduce lo que la base rechaza a algo legible — la validación de verdad no se
duplica aquí por la misma razón que en el resto del proyecto: dos copias de la
misma regla se separan en cuanto alguien corrija una.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

# `granted_by` se resuelve a correo con un LEFT JOIN: el identificador de quien
# concedió no le dice nada a quien audita. Es LEFT porque el owner inicial no lo
# concede nadie.
_LIST_ALL = text(
    """
    SELECT o.user_id,
           u.email,
           u.first_name,
           u.last_name,
           o.granted_at,
           g.email AS granted_by_email,
           o.revoked_at,
           o.reason
    FROM platform.owners o
    JOIN core.users u ON u.id = o.user_id
    LEFT JOIN core.users g ON g.id = o.granted_by
    ORDER BY o.revoked_at NULLS FIRST, o.granted_at
    """
)


async def list_all(session: AsyncSession) -> Sequence[dict[str, Any]]:
    """Owners activos primero, luego los revocados, ambos por antigüedad."""
    rows = (await session.execute(_LIST_ALL)).mappings().all()
    return [dict(r) for r in rows]


async def find_user_by_email(session: AsyncSession, email: str) -> dict[str, Any] | None:
    fila = (
        await session.execute(
            text("SELECT id, email FROM core.users WHERE email = :email AND deleted_at IS NULL"),
            {"email": email},
        )
    ).mappings().first()
    return dict(fila) if fila else None


async def is_active_owner(session: AsyncSession, user_id: UUID) -> bool:
    fila = (
        await session.execute(
            text(
                "SELECT 1 FROM platform.owners "
                "WHERE user_id = CAST(:uid AS uuid) AND revoked_at IS NULL"
            ),
            {"uid": str(user_id)},
        )
    ).first()
    return fila is not None


async def count_active(session: AsyncSession) -> int:
    fila = (
        await session.execute(text("SELECT count(*) FROM platform.owners WHERE revoked_at IS NULL"))
    ).first()
    return int(fila[0]) if fila else 0


async def grant(
    session: AsyncSession, *, user_id: UUID, granted_by: UUID, reason: str
) -> dict[str, Any]:
    """Concede, o REACTIVA si ya tuvo el privilegio y se lo habían revocado.

    `user_id` es la PK: alguien que fue owner, se le revocó, y se le vuelve a
    conceder no puede ser una segunda fila —chocaría con la PK—, así que es un
    UPSERT que reabre la fila existente en vez de un INSERT liso.
    """
    fila = (
        await session.execute(
            text(
                "INSERT INTO platform.owners (user_id, granted_by, reason) "
                "VALUES (CAST(:uid AS uuid), CAST(:by AS uuid), :reason) "
                "ON CONFLICT (user_id) DO UPDATE SET "
                "  granted_by = EXCLUDED.granted_by, "
                "  granted_at = now(), "
                "  revoked_at = NULL, "
                "  reason = EXCLUDED.reason "
                "RETURNING user_id, granted_by, granted_at, revoked_at, reason"
            ),
            {"uid": str(user_id), "by": str(granted_by), "reason": reason},
        )
    ).mappings().one()
    return dict(fila)


async def revoke(session: AsyncSession, user_id: UUID) -> dict[str, Any] | None:
    fila = (
        await session.execute(
            text(
                "UPDATE platform.owners SET revoked_at = now() "
                "WHERE user_id = CAST(:uid AS uuid) AND revoked_at IS NULL "
                "RETURNING user_id, granted_by, granted_at, revoked_at, reason"
            ),
            {"uid": str(user_id)},
        )
    ).mappings().first()
    return dict(fila) if fila else None


async def log_operation(
    session: AsyncSession,
    *,
    actor_user_id: UUID,
    operation: str,
    target_id: UUID,
    before_state: dict[str, Any] | None,
    after_state: dict[str, Any] | None,
) -> None:
    """Registro append-only (0024). `target_type` es siempre 'user' aquí: lo único
    que este módulo concede o revoca es el privilegio de una persona."""
    await session.execute(
        text(
            "INSERT INTO platform.privileged_operation_log "
            "(actor_user_id, operation, target_type, target_id, before_state, after_state) "
            "VALUES (CAST(:actor AS uuid), :op, 'user', CAST(:target AS uuid), "
            "        CAST(:before AS jsonb), CAST(:after AS jsonb))"
        ),
        {
            "actor": str(actor_user_id),
            "op": operation,
            "target": str(target_id),
            "before": None if before_state is None else _json(before_state),
            "after": None if after_state is None else _json(after_state),
        },
    )


def _json(valor: dict[str, Any]) -> str:
    return json.dumps(valor, ensure_ascii=False, default=str)
