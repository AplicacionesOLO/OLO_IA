"""Lectura de platform.owners.

Sin filtrado por owner en el SQL: lo impone RLS, igual que en el resto de los
repositorios el aislamiento por tenant lo impone la política y no el WHERE. Un
filtro aquí daría una falsa sensación de seguridad y podría divergir de la
política.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

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
