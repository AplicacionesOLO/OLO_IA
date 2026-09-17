"""Repositorio de avisos (0104): que algo termine no dependa de volver a mirar.

El INSERT no lo hace un usuario desde la pantalla: lo hace OTRO servicio —
entrenamiento, percepcion, incidencias— cuando algo que le importa a un tercero
termina. Por eso `crear()` recibe el `user_id` DESTINATARIO explicito y no lo saca
del contexto de sesion, a diferencia del resto de este repositorio.

── POR QUÉ `crear()` NO USA `RETURNING` ─────────────────────────────────────

Postgres exige que una fila devuelta por `RETURNING` pase también las políticas
de SELECT, no solo el `WITH CHECK` del INSERT. La única política de SELECT de
esta tabla es `leer_propias` (`user_id = core.current_user_id()`) — y el caso
de uso central de 0104 es notificar a OTRA persona (quien encoló un
entrenamiento no es quien lo cierra). Con `RETURNING`, ese INSERT fallaba
entero con «new row violates row-level security policy», aunque el `WITH
CHECK` del propio INSERT (`crear_para_el_operador`, `true`) lo permitía sin
problema: se detectó en vivo notificando la asignación de una incidencia a un
compañero.

Por eso `id` y `created_at` se generan AQUÍ, en Python, y se insertan como
valores explícitos en vez de dejarlos a los `DEFAULT` de la columna: así la
fila devuelta se construye a partir de lo que ya se sabe, sin necesidad de
leerla de vuelta.

Por el mismo motivo `email_sent_at` viaja como parámetro de `crear()` en lugar
de fijarse con un `UPDATE` posterior: ese `UPDATE` tenía el problema simétrico
—`marcar_propias` solo deja tocar la fila propia, y quien manda el correo casi
nunca es el destinatario—. El correo se intenta ANTES de llamar a `crear()`
(ver `NotificationService.avisar`), y el resultado entra en la misma fila.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

_NOTIF_COLS = (
    "id, kind, title, body, link, email_sent_at, read_at, created_at"
)


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def crear(
        self,
        *,
        tenant_id: UUID,
        user_id: UUID,
        kind: str,
        title: str,
        body: str,
        link: str | None,
        email_sent_at: datetime | None = None,
    ) -> dict[str, Any]:
        """`email_sent_at` se recibe ya resuelto — el correo se intenta ANTES de
        llamar aquí, no después con un `UPDATE` aparte. Ver la nota de cabecera:
        un `UPDATE` sobre una fila ajena chocaría con `marcar_propias`, que solo
        deja tocar lo propio; el INSERT, en cambio, ya es operador-amplio
        (`crear_para_el_operador`), así que meter el dato en la misma sentencia
        no necesita ensanchar ningún permiso nuevo."""
        nuevo_id = uuid4()
        creado_en = datetime.now(UTC)
        await self._session.execute(
            text(
                "INSERT INTO core.notifications "
                "(id, tenant_id, user_id, kind, title, body, link, email_sent_at, created_at) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:uid AS uuid), "
                "        :kind, :title, :body, :link, :emailed, :created)"
            ),
            {
                "id": str(nuevo_id),
                "tid": str(tenant_id),
                "uid": str(user_id),
                "kind": kind,
                "title": title,
                "body": body,
                "link": link,
                "emailed": email_sent_at,
                "created": creado_en,
            },
        )
        return {
            "id": nuevo_id,
            "kind": kind,
            "title": title,
            "body": body,
            "link": link,
            "email_sent_at": email_sent_at,
            "read_at": None,
            "created_at": creado_en,
        }

    async def listar(
        self, *, user_id: UUID, solo_no_leidas: bool, limit: int
    ) -> list[dict[str, Any]]:
        filtro = "AND read_at IS NULL " if solo_no_leidas else ""
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {_NOTIF_COLS} FROM core.notifications "  # noqa: S608
                    f"WHERE user_id = CAST(:uid AS uuid) {filtro}"
                    "ORDER BY created_at DESC LIMIT :lim"
                ),
                {"uid": str(user_id), "lim": limit},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def contar_no_leidas(self, user_id: UUID) -> int:
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*) FROM core.notifications "
                    "WHERE user_id = CAST(:uid AS uuid) AND read_at IS NULL"
                ),
                {"uid": str(user_id)},
            )
        ).first()
        return int(fila[0]) if fila else 0

    async def marcar_leida(self, *, notif_id: UUID, user_id: UUID) -> int:
        """Devuelve cuantas filas toco. RLS ya impide marcar la de otro; el filtro
        por `user_id` de aqui es ademas la forma de distinguir «no es tuya» de «no
        existe» sin una consulta aparte."""
        r: Any = await self._session.execute(
            text(
                "UPDATE core.notifications SET read_at = now() "
                "WHERE id = CAST(:nid AS uuid) AND user_id = CAST(:uid AS uuid) "
                "  AND read_at IS NULL"
            ),
            {"nid": str(notif_id), "uid": str(user_id)},
        )
        return int(r.rowcount or 0)

    async def marcar_todas_leidas(self, user_id: UUID) -> int:
        r: Any = await self._session.execute(
            text(
                "UPDATE core.notifications SET read_at = now() "
                "WHERE user_id = CAST(:uid AS uuid) AND read_at IS NULL"
            ),
            {"uid": str(user_id)},
        )
        return int(r.rowcount or 0)

    async def email_de(self, user_id: UUID) -> str | None:
        """El correo del destinatario, para el canal de email.

        No exige que sea "uno mismo": notificar a un compañero de operador de que
        su entrenamiento terminó es exactamente el caso que 0104 existe para cubrir.
        """
        fila = (
            await self._session.execute(
                text("SELECT email FROM core.users WHERE id = CAST(:uid AS uuid)"),
                {"uid": str(user_id)},
            )
        ).first()
        return str(fila[0]) if fila and fila[0] else None

    async def admins_del_tenant(self) -> list[UUID]:
        """IDs de los `tenant_admin` del tenant de la sesion -- ver 0013 (rol
        de sistema, `tenant_id IS NULL`) y 0014 (`role_assignments` es donde
        vive la asignacion por tenant). Filtro explicito por tenant ademas de
        RLS, mismo criterio que `identity._ROLES`.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT DISTINCT ra.user_id FROM core.role_assignments ra "
                    "JOIN core.roles r ON r.id = ra.role_id "
                    "WHERE ra.tenant_id = core.current_tenant_id() "
                    "AND r.name = 'tenant_admin'"
                )
            )
        ).mappings()
        return [UUID(str(f["user_id"])) for f in filas]

    async def eliminar(self, *, notif_id: UUID, user_id: UUID) -> int:
        r: Any = await self._session.execute(
            text(
                "DELETE FROM core.notifications "
                "WHERE id = CAST(:nid AS uuid) AND user_id = CAST(:uid AS uuid)"
            ),
            {"nid": str(notif_id), "uid": str(user_id)},
        )
        return int(r.rowcount or 0)
