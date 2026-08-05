"""Repositorio de OLOBOT (0073): niveles, conversaciones, mensajes y auditoría.

Como el resto, NO añade `WHERE tenant_id = ...`: lo hace RLS. Sí pasa `tenant_id` en
los INSERT porque la columna es `NOT NULL` y la policy lo comprueba con `WITH CHECK`.

── LAS CONSULTAS DE LAS HERRAMIENTAS VIVEN AQUÍ, Y NO EN EL SERVICIO ────────

Las once herramientas de lectura de OLOBOT son once consultas, y están en este
archivo por la misma razón que las demás: para que RLS las filtre. El bot lee con la
sesión del usuario, así que «los almacenes» significa los suyos y «los clientes»
significa los que él ve. Eso no es una comprobación que este archivo hace: es una que
no puede evitar.

── POR QUÉ NINGUNA DEVUELVE UN OBJETO DE DOMINIO ───────────────────────────

Devuelven `dict` y listas de `dict`, y de ahí van a `json.dumps` para el modelo. Un
objeto de dominio en medio obligaría a serializarlo otra vez, y el modelo no gana
nada con la diferencia: lo que ve es texto JSON en los dos casos.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def _filas(resultado: Any) -> int:
    """Las filas que tocó un UPDATE o un DELETE.

    `rowcount` vive en `CursorResult`, pero `session.execute()` está anotado como
    `Result`, que no lo declara. En ejecución está siempre —esto es DML—, y el resto
    del proyecto lo llama directamente y arrastra el aviso de mypy en ocho sitios.

    Aquí se concentra en uno, con el motivo escrito. El `Any` del parámetro es
    deliberado y es lo único que se pierde: a cambio, las ocho llamadas leen `_filas(r)`
    y nadie tiene que volver a preguntarse por qué el tipo no cuadra.
    """
    return int(resultado.rowcount or 0)


class OlobotRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ══════════════════════════════════════════════════════════════════════
    # NIVEL DE ACCESO
    # ══════════════════════════════════════════════════════════════════════

    async def nivel_de(self, user_id: UUID) -> str | None:
        """El nivel de este usuario, o `None` si no tiene OLOBOT.

        `None` es una respuesta legítima y frecuente: sin fila no hay bot. Es lo
        correcto por omisión —un asistente con acceso a los datos del almacén
        aparece porque alguien lo concedió, no solo—.
        """
        fila = (
            await self._session.execute(
                text("SELECT level FROM olobot.access WHERE user_id = CAST(:uid AS uuid)"),
                {"uid": str(user_id)},
            )
        ).first()
        return None if fila is None else str(fila[0])

    async def niveles(self) -> list[dict[str, Any]]:
        """Quién tiene qué nivel, con el nombre de quien lo concedió.

        Incluye a los usuarios SIN nivel, con `level` a `None`. Es la diferencia
        entre una lista para administrar y una lista para mirar: para conceder un
        nivel hay que ver primero a quién no lo tiene.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT u.id, u.email, u.first_name, u.last_name, u.status, "
                    "       a.level, a.granted_at, a.note, "
                    "       g.email AS granted_by_email "
                    "  FROM core.users u "
                    "  JOIN core.tenant_memberships m "
                    "    ON m.user_id = u.id AND m.revoked_at IS NULL "
                    "  LEFT JOIN olobot.access a ON a.user_id = u.id "
                    "  LEFT JOIN core.users g    ON g.id = a.granted_by "
                    " ORDER BY a.level IS NULL, u.email"
                )
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def poner_nivel(
        self,
        *,
        tenant_id: UUID,
        user_id: UUID,
        nivel: str,
        actor: UUID,
        nota: str | None,
    ) -> int:
        """Concede o cambia el nivel. Devuelve las filas afectadas.

        `ON CONFLICT` y no un INSERT o un UPDATE según el caso: quien concede no
        tiene por qué saber si la persona ya tenía nivel, y consultarlo antes abriría
        una carrera entre la consulta y la escritura.
        """
        r = await self._session.execute(
            text(
                "INSERT INTO olobot.access "
                "  (tenant_id, user_id, level, granted_by, note) "
                "VALUES (CAST(:tid AS uuid), CAST(:uid AS uuid), CAST(:lvl AS varchar), "
                "        CAST(:actor AS uuid), :nota) "
                "ON CONFLICT (tenant_id, user_id) DO UPDATE "
                "   SET level = CAST(:lvl AS varchar), "
                "       granted_by = CAST(:actor AS uuid), "
                "       note = :nota"
            ),
            {
                "tid": str(tenant_id),
                "uid": str(user_id),
                "lvl": nivel,
                "actor": str(actor),
                "nota": nota,
            },
        )
        return _filas(r)

    async def quitar_nivel(self, user_id: UUID) -> int:
        """Retira el acceso a OLOBOT. Las conversaciones se conservan."""
        r = await self._session.execute(
            text("DELETE FROM olobot.access WHERE user_id = CAST(:uid AS uuid)"),
            {"uid": str(user_id)},
        )
        return _filas(r)

    # ══════════════════════════════════════════════════════════════════════
    # CONVERSACIONES Y MENSAJES
    # ══════════════════════════════════════════════════════════════════════

    async def crear_conversacion(
        self, *, tenant_id: UUID, user_id: UUID, warehouse_id: UUID | None, titulo: str
    ) -> UUID:
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO olobot.conversations "
                    "  (tenant_id, user_id, warehouse_id, title) "
                    "VALUES (CAST(:tid AS uuid), CAST(:uid AS uuid), "
                    "        CAST(:wid AS uuid), :titulo) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id),
                    "uid": str(user_id),
                    "wid": str(warehouse_id) if warehouse_id else None,
                    "titulo": titulo,
                },
            )
        ).one()
        return UUID(str(fila[0]))

    async def conversaciones(self, limite: int = 30) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    "SELECT c.id, c.title, c.created_at, c.last_message_at, "
                    "       (SELECT count(*) FROM olobot.messages m "
                    "         WHERE m.conversation_id = c.id AND m.role <> 'tool') AS messages "
                    "  FROM olobot.conversations c "
                    " WHERE c.deleted_at IS NULL "
                    " ORDER BY c.last_message_at DESC "
                    " LIMIT :lim"
                ),
                {"lim": limite},
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def conversacion(self, conv_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, title, warehouse_id, created_at, last_message_at "
                    "  FROM olobot.conversations "
                    " WHERE id = CAST(:cid AS uuid) AND deleted_at IS NULL"
                ),
                {"cid": str(conv_id)},
            )
        ).mappings().first()
        return None if fila is None else dict(fila)

    async def retirar_conversacion(self, conv_id: UUID) -> int:
        r = await self._session.execute(
            text(
                "UPDATE olobot.conversations SET deleted_at = now() "
                " WHERE id = CAST(:cid AS uuid) AND deleted_at IS NULL"
            ),
            {"cid": str(conv_id)},
        )
        return _filas(r)

    async def renombrar_conversacion(self, conv_id: UUID, titulo: str) -> int:
        r = await self._session.execute(
            text(
                "UPDATE olobot.conversations SET title = :t "
                " WHERE id = CAST(:cid AS uuid) AND deleted_at IS NULL"
            ),
            {"cid": str(conv_id), "t": titulo},
        )
        return _filas(r)

    async def añadir_mensaje(
        self,
        *,
        tenant_id: UUID,
        conv_id: UUID,
        rol: str,
        contenido: str | None,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_call_id: str | None = None,
        tokens_in: int | None = None,
        tokens_out: int | None = None,
        modelo: str | None = None,
    ) -> int:
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO olobot.messages "
                    "  (tenant_id, conversation_id, role, content, tool_calls, "
                    "   tool_call_id, tokens_in, tokens_out, model) "
                    "VALUES (CAST(:tid AS uuid), CAST(:cid AS uuid), "
                    "        CAST(:rol AS varchar), :cont, CAST(:tc AS jsonb), "
                    "        :tcid, :ti, :to, CAST(:modelo AS varchar)) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id),
                    "cid": str(conv_id),
                    "rol": rol,
                    "cont": contenido,
                    "tc": json.dumps(tool_calls) if tool_calls else None,
                    "tcid": tool_call_id,
                    "ti": tokens_in,
                    "to": tokens_out,
                    "modelo": modelo,
                },
            )
        ).one()
        # `last_message_at` se toca aquí y no con un disparador: es una sola
        # sentencia más en el mismo camino, y un disparador sobre una tabla que
        # recibe cuatro filas por turno se paga en cada una.
        await self._session.execute(
            text(
                "UPDATE olobot.conversations SET last_message_at = now() "
                " WHERE id = CAST(:cid AS uuid)"
            ),
            {"cid": str(conv_id)},
        )
        return int(fila[0])

    async def historial(self, conv_id: UUID, limite: int) -> list[dict[str, Any]]:
        """Los últimos `limite` mensajes, en orden cronológico.

        Se piden los últimos y se devuelven en orden: el modelo necesita la
        secuencia, y un `ORDER BY id DESC LIMIT n` la daría del revés.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT * FROM ( "
                    "  SELECT id, role, content, tool_calls, tool_call_id, created_at "
                    "    FROM olobot.messages "
                    "   WHERE conversation_id = CAST(:cid AS uuid) "
                    "   ORDER BY id DESC LIMIT :lim "
                    ") q ORDER BY q.id"
                ),
                {"cid": str(conv_id), "lim": limite},
            )
        ).mappings()
        return [dict(f) for f in filas]

    # ══════════════════════════════════════════════════════════════════════
    # AUDITORÍA DE ESCRITURAS
    # ══════════════════════════════════════════════════════════════════════

    async def proponer_accion(
        self,
        *,
        tenant_id: UUID,
        conv_id: UUID,
        user_id: UUID,
        herramienta: str,
        argumentos: dict[str, Any],
        resumen: str,
    ) -> UUID:
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO olobot.actions "
                    "  (tenant_id, conversation_id, user_id, tool, arguments, summary) "
                    "VALUES (CAST(:tid AS uuid), CAST(:cid AS uuid), CAST(:uid AS uuid), "
                    "        CAST(:tool AS varchar), CAST(:args AS jsonb), :resumen) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id),
                    "cid": str(conv_id),
                    "uid": str(user_id),
                    "tool": herramienta,
                    "args": json.dumps(argumentos),
                    "resumen": resumen,
                },
            )
        ).one()
        return UUID(str(fila[0]))

    async def accion(self, accion_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, conversation_id, user_id, tool, arguments, summary, "
                    "       status, error_message, result, proposed_at, decided_at "
                    "  FROM olobot.actions WHERE id = CAST(:aid AS uuid)"
                ),
                {"aid": str(accion_id)},
            )
        ).mappings().first()
        return None if fila is None else dict(fila)

    async def cerrar_accion(
        self,
        *,
        accion_id: UUID,
        estado: str,
        actor: UUID,
        resultado: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> int:
        """Pasa una acción de `proposed` a su destino final.

        El `AND status = 'proposed'` del WHERE es lo que hace que confirmar dos veces
        no ejecute dos veces: la segunda afecta a cero filas y el servicio lo traduce
        a «ya estaba decidida». Sin esa condición, dos clics en el botón de confirmar
        —o un doble envío de la red— aplicarían el cambio dos veces.
        """
        r = await self._session.execute(
            text(
                "UPDATE olobot.actions "
                "   SET status = CAST(:est AS varchar), "
                "       decided_at = now(), "
                "       decided_by = CAST(:actor AS uuid), "
                "       result = CAST(:res AS jsonb), "
                "       error_message = :err "
                " WHERE id = CAST(:aid AS uuid) AND status = 'proposed'"
            ),
            {
                "aid": str(accion_id),
                "est": estado,
                "actor": str(actor),
                "res": json.dumps(resultado) if resultado is not None else None,
                "err": error,
            },
        )
        return _filas(r)

    async def acciones(self, limite: int = 50) -> list[dict[str, Any]]:
        """El registro, para todo el tenant. Ver la nota de privacidad de 0073: esto
        se ve, las conversaciones no."""
        filas = (
            await self._session.execute(
                text(
                    "SELECT a.id, a.tool, a.summary, a.status, a.error_message, "
                    "       a.proposed_at, a.decided_at, u.email AS user_email "
                    "  FROM olobot.actions a "
                    "  JOIN core.users u ON u.id = a.user_id "
                    " ORDER BY a.proposed_at DESC LIMIT :lim"
                ),
                {"lim": limite},
            )
        ).mappings()
        return [dict(f) for f in filas]

    # ══════════════════════════════════════════════════════════════════════
    # LAS CONSULTAS DE LAS HERRAMIENTAS
    # ══════════════════════════════════════════════════════════════════════

    async def almacenes(self) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    "SELECT w.id, w.code, w.name, w.status, w.timezone, "
                    "       (SELECT count(*) FROM spatial.locations l "
                    "         WHERE l.warehouse_id = w.id) AS ubicaciones "
                    "  FROM core.warehouses w "
                    " WHERE w.deleted_at IS NULL "
                    " ORDER BY w.code"
                )
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def almacen_por_codigo(self, codigo: str) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT id, code, name, status FROM core.warehouses "
                    " WHERE upper(code) = upper(:c) AND deleted_at IS NULL"
                ),
                {"c": codigo},
            )
        ).mappings().first()
        return None if fila is None else dict(fila)

    async def resumen_ocupacion(self, warehouse_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*)                                  AS ubicaciones, "
                    "       count(*) FILTER (WHERE occupied)           AS ocupadas, "
                    "       count(*) FILTER (WHERE NOT occupied)       AS libres, "
                    "       round(100.0 * count(*) FILTER (WHERE occupied) "
                    "             / nullif(count(*), 0), 1)            AS porcentaje, "
                    "       coalesce(sum(pallets), 0)                  AS pallets, "
                    "       coalesce(sum(units), 0)                    AS unidades, "
                    "       max(taken_at)                              AS corte_wms "
                    "  FROM inventory.v_location_occupancy "
                    " WHERE warehouse_id = CAST(:wid AS uuid)"
                ),
                {"wid": str(warehouse_id)},
            )
        ).mappings().first()
        return None if fila is None else dict(fila)

    async def racks_mas_llenos(self, warehouse_id: UUID, cuantos: int) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    "SELECT rack_code, locations AS ubicaciones, occupied AS ocupadas, "
                    "       occupancy_pct AS porcentaje, pallets, units AS unidades, "
                    "       blocked AS bloqueadas "
                    "  FROM inventory.v_rack_occupancy "
                    " WHERE warehouse_id = CAST(:wid AS uuid) "
                    " ORDER BY occupancy_pct DESC NULLS LAST, pallets DESC "
                    " LIMIT :lim"
                ),
                {"wid": str(warehouse_id), "lim": cuantos},
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def ubicacion(self, warehouse_id: UUID, codigo: str) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    "SELECT location_code, level, spatial_status, wms_situation, "
                    "       occupied, pallets, skus, clients, units, first_expiry "
                    "  FROM inventory.v_location_occupancy "
                    " WHERE warehouse_id = CAST(:wid AS uuid) "
                    "   AND upper(location_code) = upper(:c)"
                ),
                {"wid": str(warehouse_id), "c": codigo},
            )
        ).mappings().first()
        return None if fila is None else dict(fila)

    async def discrepancias(self, warehouse_id: UUID, cuantos: int) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    #  Sin `pallets`: la vista no lo trae, y no es un olvido suyo. Una
                    #  discrepancia se describe con «el WMS dice OCUP y hay 0 líneas»;
                    #  contar pallets de un hueco que el WMS cree vacío no significa nada.
                    "SELECT location_code, spatial_status, wms_situation, "
                    "       lines, units, mismatch AS tipo "
                    "  FROM inventory.v_occupancy_mismatch "
                    " WHERE warehouse_id = CAST(:wid AS uuid) "
                    " ORDER BY location_code "
                    " LIMIT :lim"
                ),
                {"wid": str(warehouse_id), "lim": cuantos},
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def trabajos_percepcion(
        self, estado: str | None, cuantos: int
    ) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    "SELECT j.id, j.status, j.created_at, j.error_message, "
                    #  `model_label`, que ya viene compuesto en la vista. No hay
                    #  `model_name` ni `model_version` sueltos ahi.
                    "       j.model_label, "
                    "       (SELECT count(*) FROM perception.detections d "
                    "         WHERE d.job_id = j.id) AS detecciones "
                    "  FROM perception.v_inference_jobs j "
                    " WHERE (:est IS NULL OR j.status = CAST(:est AS varchar)) "
                    " ORDER BY j.created_at DESC "
                    " LIMIT :lim"
                ),
                {"est": estado, "lim": cuantos},
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def modelos_publicados(self) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    #  Sin `metrics`: la vista no las expone. Para elegir un modelo
                    #  desde una conversacion, lo que decide es la tarea, el proposito y
                    #  QUE CLASES reconoce; una cifra de mAP sin contexto no decide nada.
                    "SELECT name, version, task, purpose, architecture_name, "
                    "       classes, published_at "
                    "  FROM perception.v_published_models "
                    " ORDER BY name, version DESC"
                )
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def estructura(self) -> dict[str, Any]:
        """Los recuentos de la estructura del operador, en una sola ida.

        Siete subconsultas en una sentencia y no siete sentencias: con 260 ms de
        latencia al pooler, la diferencia entre una ida y siete es un segundo y
        medio de espera en cada pregunta que el bot conteste con esto.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT "
                    " (SELECT count(*) FROM core.tenant_countries WHERE deleted_at IS NULL) "
                    "   AS paises, "
                    " (SELECT count(*) FROM core.companies WHERE deleted_at IS NULL) "
                    "   AS entidades_legales, "
                    " (SELECT count(*) FROM core.clients WHERE deleted_at IS NULL) "
                    "   AS clientes, "
                    " (SELECT count(*) FROM core.warehouses WHERE deleted_at IS NULL) "
                    "   AS almacenes, "
                    " (SELECT count(*) FROM core.users u JOIN core.tenant_memberships m "
                    "    ON m.user_id = u.id AND m.revoked_at IS NULL) AS usuarios, "
                    " (SELECT count(*) FROM core.roles WHERE tenant_id IS NOT NULL) "
                    "   AS roles_propios, "
                    " (SELECT count(*) FROM spatial.locations) AS ubicaciones"
                )
            )
        ).mappings().one()
        return dict(fila)

    async def clientes(self) -> list[dict[str, Any]]:
        filas = (
            await self._session.execute(
                text(
                    "SELECT code, name, legal_name, tax_id, status "
                    "  FROM core.clients WHERE deleted_at IS NULL ORDER BY code"
                )
            )
        ).mappings()
        return [dict(f) for f in filas]

    async def quien_soy(self, user_id: UUID) -> dict[str, Any]:
        fila = (
            await self._session.execute(
                text(
                    "SELECT u.email, u.first_name, u.last_name, u.locale, u.timezone, "
                    "       t.name AS operador, "
                    "       (SELECT string_agg(r.name, ', ' ORDER BY r.name) "
                    "          FROM core.role_assignments ra "
                    "          JOIN core.roles r ON r.id = ra.role_id "
                    "         WHERE ra.user_id = u.id) AS roles, "
                    "       (SELECT a.level FROM olobot.access a WHERE a.user_id = u.id) "
                    "         AS nivel_olobot, "
                    "       (SELECT string_agg(w.code, ', ' ORDER BY w.code) "
                    "          FROM core.warehouses w WHERE w.deleted_at IS NULL) "
                    "         AS almacenes_accesibles "
                    "  FROM core.users u "
                    "  JOIN core.tenant_memberships m "
                    "    ON m.user_id = u.id AND m.revoked_at IS NULL "
                    "  JOIN core.tenants t ON t.id = m.tenant_id "
                    " WHERE u.id = CAST(:uid AS uuid)"
                ),
                {"uid": str(user_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else {}

    # ── Escrituras que las herramientas pueden proponer ────────────────────

    async def bloquear_ubicacion(
        self, *, warehouse_id: UUID, codigo: str, bloqueada: bool, actor: UUID
    ) -> int:
        r = await self._session.execute(
            text(
                "UPDATE spatial.locations "
                "   SET status = CAST(:est AS varchar), updated_by = CAST(:actor AS uuid) "
                " WHERE warehouse_id = CAST(:wid AS uuid) "
                "   AND upper(code) = upper(:c)"
            ),
            {
                "wid": str(warehouse_id),
                "c": codigo,
                "est": "blocked" if bloqueada else "available",
                "actor": str(actor),
            },
        )
        return _filas(r)

    async def renombrar_cliente(self, *, codigo: str, nombre: str, actor: UUID) -> int:
        r = await self._session.execute(
            text(
                "UPDATE core.clients "
                "   SET name = :n, updated_by = CAST(:actor AS uuid), "
                "       version = version + 1 "
                " WHERE upper(code) = upper(:c) AND deleted_at IS NULL"
            ),
            {"c": codigo, "n": nombre, "actor": str(actor)},
        )
        return _filas(r)

    async def estado_almacen(self, *, codigo: str, estado: str, actor: UUID) -> int:
        r = await self._session.execute(
            text(
                "UPDATE core.warehouses "
                "   SET status = CAST(:est AS varchar), updated_by = CAST(:actor AS uuid), "
                "       version = version + 1 "
                " WHERE upper(code) = upper(:c) AND deleted_at IS NULL"
            ),
            {"c": codigo, "est": estado, "actor": str(actor)},
        )
        return _filas(r)
