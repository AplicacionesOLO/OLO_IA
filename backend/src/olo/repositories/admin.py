"""Lecturas y escrituras de la configuración del sistema.

─────────────────────────────────────────────────────────────────────────────
NO ES UN REPOSITORIO DE ENTIDAD, ES UN CONJUNTO DE CONSULTAS

Igual que `repositories/identity.py`: la pantalla de Administración necesita
componer países, entidades legales, clientes, almacenes, usuarios, roles y permisos
en una sola respuesta. Siete repositorios de entidad para una pantalla de lectura
serían siete round-trips de 260 ms contra el pooler.

─────────────────────────────────────────────────────────────────────────────
NINGUNA CONSULTA FILTRA POR TENANT

Lo hace RLS. `core.clients`, `core.companies`, `core.roles` y `core.warehouses`
tienen política restrictiva `tenant_id = core.current_tenant_id()`, así que un
`WHERE tenant_id = ...` aquí daría falsa sensación de seguridad y ocultaría un fallo
de política en lugar de dejarlo a la vista.

Las dos excepciones son deliberadas y no son datos de tenant:

  · `public.countries` es un catálogo global de 37 países, sin dueño;
  · `core.permissions` es el catálogo de permisos del producto, también global.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy import RowMapping
    from sqlalchemy.ext.asyncio import AsyncSession


class AdminRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _rows(self, sql: str, params: dict[str, Any] | None = None) -> Sequence[RowMapping]:
        return (await self._session.execute(text(sql), params or {})).mappings().all()

    # ── Catálogos globales ────────────────────────────────────────────────────
    async def countries(self) -> Sequence[RowMapping]:
        """Los 37 países. Catálogo global: no pasa por RLS de tenant.

        Se devuelven todos y no solo los que el tenant usa: el selector de un país
        nuevo necesita la lista completa, y son 37 filas.
        """
        return await self._rows(
            "SELECT id, iso_code, iso_code_3, numeric_code, name_en, name_es, "
            "       phone_code, default_currency_code "
            "FROM public.countries ORDER BY name_es"
        )

    async def permissions(self) -> Sequence[RowMapping]:
        """El catálogo de permisos, con su módulo, acción y ALCANCE.

        `scope` es lo que decide si una casilla de la matriz es posible: un permiso
        `platform` NO se puede asignar a un rol de tenant —lo aborta el trigger
        `trg_role_permissions_scope_guard`— y la interfaz tiene que saberlo ANTES de
        ofrecer el clic.
        """
        return await self._rows(
            "SELECT code, module, action, description, is_privileged, scope "
            "FROM core.permissions ORDER BY scope, module, action"
        )

    # ── Estructura del operador ───────────────────────────────────────────────
    async def tenant_countries(self) -> Sequence[RowMapping]:
        return await self._rows(
            "SELECT tc.id, tc.country_id, c.iso_code, c.name_es, tc.status, "
            "       tc.default_currency_code, tc.default_timezone "
            "FROM core.tenant_countries tc "
            "JOIN public.countries c ON c.id = tc.country_id "
            "WHERE tc.deleted_at IS NULL ORDER BY c.name_es"
        )

    async def companies(self) -> Sequence[RowMapping]:
        """Entidades legales del OPERADOR. No son clientes: ver `core.clients`."""
        return await self._rows(
            "SELECT co.id, co.name, co.legal_name, co.tax_id, co.status, "
            "       c.name_es AS country_name, c.iso_code AS country_code, "
            "       (SELECT count(*) FROM core.warehouses w "
            "         WHERE w.company_id = co.id AND w.deleted_at IS NULL) AS warehouse_count, "
            "       (SELECT count(*) FROM core.clients cl "
            "         WHERE cl.company_id = co.id AND cl.deleted_at IS NULL) AS client_count "
            "FROM core.companies co "
            "LEFT JOIN core.tenant_countries tc ON tc.id = co.tenant_country_id "
            "LEFT JOIN public.countries c ON c.id = tc.country_id "
            "WHERE co.deleted_at IS NULL ORDER BY co.name"
        )

    async def clients(self) -> Sequence[RowMapping]:
        """Dueños de la mercadería (3PL)."""
        return await self._rows(
            "SELECT cl.id, cl.code, cl.name, cl.legal_name, cl.tax_id, cl.status, "
            "       co.name AS company_name "
            "FROM core.clients cl "
            "JOIN core.companies co ON co.id = cl.company_id "
            "WHERE cl.deleted_at IS NULL ORDER BY cl.code"
        )

    async def warehouses(self) -> Sequence[RowMapping]:
        """Almacenes, con el recuento REAL de su catálogo espacial.

        El recuento sale de `spatial.locations` y no de una columna: es lo que
        distingue un almacén operativo de uno que solo existe en la tabla. Sin él, 24
        residuos de pruebas parecen almacenes de verdad.
        """
        return await self._rows(
            "SELECT w.id, w.code, w.name, w.status, "
            "       co.name AS company_name, "
            "       (SELECT count(*) FROM spatial.locations l "
            "         WHERE l.warehouse_id = w.id AND l.deleted_at IS NULL) AS location_count, "
            "       (SELECT count(*) FROM spatial.nodes n "
            "         WHERE n.warehouse_id = w.id AND n.deleted_at IS NULL) AS node_count "
            "FROM core.warehouses w "
            "LEFT JOIN core.companies co ON co.id = w.company_id "
            "WHERE w.deleted_at IS NULL ORDER BY w.code"
        )

    async def users(self) -> Sequence[RowMapping]:
        """Usuarios con su membresía, sus roles y si son owner de plataforma.

        `is_platform_owner` se resuelve contra `platform.owners` y NO viaja en el JWT:
        revocar el privilegio surte efecto en la petición siguiente. Mostrarlo aquí es
        lo que evita la pregunta «¿por qué este usuario ve el módulo de IA?».
        """
        return await self._rows(
            "SELECT u.id, u.email, u.first_name, u.last_name, u.status, "
            "       EXISTS (SELECT 1 FROM platform.owners o "
            "                WHERE o.user_id = u.id AND o.revoked_at IS NULL) "
            "         AS is_platform_owner, "
            "       (SELECT count(*) FROM core.user_warehouse_access uwa "
            "         WHERE uwa.user_id = u.id AND uwa.revoked_at IS NULL) "
            "         AS warehouse_access_count, "
            "       coalesce((SELECT array_agg(r.name ORDER BY r.name) "
            "                   FROM core.role_assignments ra "
            "                   JOIN core.roles r ON r.id = ra.role_id "
            "                  WHERE ra.user_id = u.id AND r.deleted_at IS NULL), '{}') "
            "         AS role_names, "
            "       m.status AS membership_status "
            "FROM core.users u "
            "LEFT JOIN core.tenant_memberships m "
            "       ON m.user_id = u.id AND m.revoked_at IS NULL "
            "WHERE u.deleted_at IS NULL ORDER BY u.email"
        )

    # ── La matriz ─────────────────────────────────────────────────────────────
    async def roles(self) -> Sequence[RowMapping]:
        """Roles con su recuento de permisos y su padre resuelto.

        `is_system` importa en la interfaz: un rol de sistema se puede consultar pero
        cambiarle los permisos altera el comportamiento de todo el producto, y quien
        lo haga tiene que saberlo.
        """
        return await self._rows(
            "SELECT r.id, r.name, r.description, r.is_system, r.parent_role_id, "
            "       p.name AS parent_name, "
            # `tenant_id IS NULL` = rol GLOBAL, compartido por todos los tenants. La
            # politica `rp_isolation` exige `r.tenant_id = current_tenant_id()` en su
            # WITH CHECK, asi que sus permisos NO se pueden editar desde un tenant.
            "       r.tenant_id IS NULL AS is_global, "
            "       (SELECT count(*) FROM core.role_permissions rp "
            "         WHERE rp.role_id = r.id) AS permission_count "
            "FROM core.roles r "
            "LEFT JOIN core.roles p ON p.id = r.parent_role_id "
            "WHERE r.deleted_at IS NULL ORDER BY r.name"
        )

    async def role_permissions(self) -> Sequence[RowMapping]:
        """Las asignaciones vigentes. El cliente arma la matriz con esto.

        Se devuelven planas y no agrupadas por rol: son decenas de filas y agruparlas
        aquí obligaría al cliente a deshacer el agrupamiento para pintar una tabla que
        es, por naturaleza, plana.
        """
        return await self._rows(
            "SELECT rp.role_id, rp.permission_code FROM core.role_permissions rp "
            "ORDER BY rp.role_id, rp.permission_code"
        )

    async def grant(self, role_id: UUID, code: str, *, granted_by: UUID) -> None:
        """Concede un permiso a un rol.

        `ON CONFLICT DO NOTHING`: la operación es IDEMPOTENTE. Marcar dos veces la
        misma casilla —doble clic, o dos pestañas abiertas— no puede ser un error.

        ⚠ El trigger `trg_role_permissions_scope_guard` ABORTA si el permiso es de
          alcance `platform`. No se comprueba aquí además: el servicio ya lo valida
          para dar un mensaje útil, y el motor es la autoridad.
        """
        await self._session.execute(
            text(
                "INSERT INTO core.role_permissions (role_id, permission_code, created_by) "
                "VALUES (CAST(:rid AS uuid), :code, CAST(:by AS uuid)) "
                "ON CONFLICT DO NOTHING"
            ),
            {"rid": str(role_id), "code": code, "by": str(granted_by)},
        )

    async def revoke(self, role_id: UUID, code: str) -> None:
        """Retira un permiso de un rol.

        DELETE de verdad y no baja lógica: `core.role_permissions` es una tabla de
        unión sin `deleted_at`. La huella de quién lo quitó vive en el registro de
        auditoría, no en la fila.

        Idempotente también: desmarcar algo ya desmarcado afecta a cero filas y no es
        un fallo.
        """
        await self._session.execute(
            text(
                "DELETE FROM core.role_permissions "
                "WHERE role_id = CAST(:rid AS uuid) AND permission_code = :code"
            ),
            {"rid": str(role_id), "code": code},
        )

    async def role_exists(self, role_id: UUID) -> bool:
        rows = await self._rows(
            "SELECT 1 FROM core.roles WHERE id = CAST(:rid AS uuid) AND deleted_at IS NULL",
            {"rid": str(role_id)},
        )
        return len(rows) > 0

    async def role_is_global(self, role_id: UUID) -> bool:
        """`true` si el rol es de sistema global (`tenant_id IS NULL`).

        Los roles globales los comparten todos los tenants, asi que cambiar sus
        permisos cambiaria el comportamiento del producto para todo el mundo. La
        politica `rp_isolation` lo impide en el motor; esto permite explicarlo antes.
        """
        rows = await self._rows(
            "SELECT tenant_id IS NULL AS es_global FROM core.roles "
            "WHERE id = CAST(:rid AS uuid) AND deleted_at IS NULL",
            {"rid": str(role_id)},
        )
        return bool(rows[0]["es_global"]) if rows else False

    async def user_exists(self, user_id: UUID) -> bool:
        rows = await self._rows(
            "SELECT 1 FROM core.users WHERE id = CAST(:u AS uuid) AND deleted_at IS NULL",
            {"u": str(user_id)},
        )
        return len(rows) > 0

    async def permission_scope(self, code: str) -> str | None:
        rows = await self._rows(
            "SELECT scope FROM core.permissions WHERE code = :code", {"code": code}
        )
        return str(rows[0]["scope"]) if rows else None

    # ══════════════════════════════════════════════════════════════════════════
    # ESCRITURAS
    #
    # `tenant_id` NUNCA llega desde Python: se toma de `core.current_tenant_id()` en la
    # propia sentencia. Es la misma función que evalúa RLS, así que es imposible
    # insertar una fila que la política vaya a rechazar — o peor, que acepte por
    # pertenecer a otro tenant.
    # ══════════════════════════════════════════════════════════════════════════

    # ── Países del operador ───────────────────────────────────────────────────
    async def open_country(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        """Abre un país para el operador.

        NO crea un país: `public.countries` es un catálogo global de 37 filas que nadie
        edita. Lo que se crea es la PRESENCIA del operador en ese país, con su moneda,
        su locale y su zona horaria por omisión.
        """
        row = (
            await self._session.execute(
                text(
                    "INSERT INTO core.tenant_countries "
                    "(tenant_id, country_id, status, default_currency_code, "
                    " default_locale, default_timezone, created_by) "
                    "VALUES (core.current_tenant_id(), CAST(:country AS uuid), 'active', "
                    "        :currency, :locale, :tz, CAST(:by AS uuid)) "
                    "RETURNING id"
                ),
                {
                    "country": str(datos["country_id"]),
                    "currency": datos["default_currency_code"],
                    "locale": datos.get("default_locale") or "es-CR",
                    "tz": datos.get("default_timezone") or "America/Costa_Rica",
                    "by": str(actor),
                },
            )
        ).first()
        return UUID(str(row[0]))  # type: ignore[index]

    # ── Entidades legales ─────────────────────────────────────────────────────
    async def create_company(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        row = (
            await self._session.execute(
                text(
                    "INSERT INTO core.companies "
                    "(tenant_id, tenant_country_id, name, legal_name, tax_id, "
                    " status, created_by) "
                    "VALUES (core.current_tenant_id(), CAST(:tc AS uuid), :name, "
                    "        :legal, :tax, 'active', CAST(:by AS uuid)) "
                    "RETURNING id"
                ),
                {
                    "tc": str(datos["tenant_country_id"]),
                    "name": datos["name"],
                    "legal": datos.get("legal_name"),
                    "tax": datos.get("tax_id"),
                    "by": str(actor),
                },
            )
        ).first()
        return UUID(str(row[0]))  # type: ignore[index]

    async def update_company(
        self, company_id: UUID, cambios: dict[str, Any], *, actor: UUID
    ) -> int:
        return await self._update(
            "core.companies",
            company_id,
            cambios,
            permitidos={"name", "legal_name", "tax_id", "status"},
            actor=actor,
        )

    # ── Clientes ──────────────────────────────────────────────────────────────
    async def create_client(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        row = (
            await self._session.execute(
                text(
                    "INSERT INTO core.clients "
                    "(tenant_id, company_id, code, name, legal_name, tax_id, "
                    " status, notes, created_by) "
                    "VALUES (core.current_tenant_id(), CAST(:co AS uuid), :code, :name, "
                    "        :legal, :tax, 'active', :notes, CAST(:by AS uuid)) "
                    "RETURNING id"
                ),
                {
                    "co": str(datos["company_id"]),
                    "code": datos["code"],
                    "name": datos["name"],
                    "legal": datos.get("legal_name"),
                    "tax": datos.get("tax_id"),
                    "notes": datos.get("notes"),
                    "by": str(actor),
                },
            )
        ).first()
        return UUID(str(row[0]))  # type: ignore[index]

    async def update_client(
        self, client_id: UUID, cambios: dict[str, Any], *, actor: UUID
    ) -> int:
        return await self._update(
            "core.clients",
            client_id,
            cambios,
            permitidos={"code", "name", "legal_name", "tax_id", "status", "notes"},
            actor=actor,
        )

    async def soft_delete_client(self, client_id: UUID, *, actor: UUID) -> int:
        """Baja lógica. El `code` se libera: `uq_client_code` filtra por `deleted_at`."""
        res = await self._session.execute(
            text(
                "UPDATE core.clients SET deleted_at = now(), status = 'inactive', "
                "    updated_by = CAST(:by AS uuid), version = version + 1 "
                "WHERE id = CAST(:id AS uuid) AND deleted_at IS NULL"
            ),
            {"id": str(client_id), "by": str(actor)},
        )
        return res.rowcount or 0

    # ── Roles ─────────────────────────────────────────────────────────────────
    async def create_role(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        """Crea un rol PROPIO del tenant.

        ⚠ `is_system = false` es OBLIGATORIO, no una elección: el CHECK
          `chk_roles_system` exige `is_system = (tenant_id IS NULL)`. Como el
          `tenant_id` se toma de `core.current_tenant_id()` —que nunca es NULL en una
          petición autenticada—, `is_system` tiene que ser false o la fila no entra.

        `parent_role_id` permite heredar de un rol del sistema. El trigger
        `prevent_role_cycle` impide los ciclos.
        """
        row = (
            await self._session.execute(
                text(
                    "INSERT INTO core.roles "
                    "(tenant_id, name, description, is_system, parent_role_id, created_by) "
                    "VALUES (core.current_tenant_id(), :name, :desc, false, "
                    "        CAST(:parent AS uuid), CAST(:by AS uuid)) "
                    "RETURNING id"
                ),
                {
                    "name": datos["name"],
                    "desc": datos.get("description"),
                    "parent": (
                        str(datos["parent_role_id"]) if datos.get("parent_role_id") else None
                    ),
                    "by": str(actor),
                },
            )
        ).first()
        return UUID(str(row[0]))  # type: ignore[index]

    async def update_role(self, role_id: UUID, cambios: dict[str, Any], *, actor: UUID) -> int:
        return await self._update(
            "core.roles",
            role_id,
            cambios,
            permitidos={"name", "description", "parent_role_id"},
            actor=actor,
        )

    async def soft_delete_role(self, role_id: UUID, *, actor: UUID) -> int:
        """Baja lógica, y SOLO de roles del tenant.

        `AND tenant_id IS NOT NULL` en el WHERE: un rol global no se puede borrar desde
        un tenant ni por accidente. RLS ya lo impediría, pero un filtro explícito
        convierte «cero filas» en un resultado esperado en lugar de un misterio.
        """
        res = await self._session.execute(
            text(
                "UPDATE core.roles SET deleted_at = now(), "
                "    updated_by = CAST(:by AS uuid), version = version + 1 "
                "WHERE id = CAST(:id AS uuid) AND deleted_at IS NULL "
                "  AND tenant_id IS NOT NULL"
            ),
            {"id": str(role_id), "by": str(actor)},
        )
        return res.rowcount or 0

    async def role_assignment_count(self, role_id: UUID) -> int:
        rows = await self._rows(
            "SELECT count(*) AS n FROM core.role_assignments "
            "WHERE role_id = CAST(:r AS uuid)",
            {"r": str(role_id)},
        )
        return int(rows[0]["n"])

    async def role_name_taken(self, name: str, *, excluding: UUID | None = None) -> bool:
        rows = await self._rows(
            # `CAST(:ex AS uuid) IS NULL` y NO `:ex IS NULL`: sin el casteo, Postgres no
            # puede inferir el tipo de un parametro que solo se compara con NULL y
            # responde `AmbiguousParameterError: could not determine data type`.
            "SELECT 1 FROM core.roles WHERE name = :n AND deleted_at IS NULL "
            "  AND (CAST(:ex AS uuid) IS NULL OR id <> CAST(:ex AS uuid))",
            {"n": name, "ex": str(excluding) if excluding else None},
        )
        return len(rows) > 0

    # ── Asignación de roles y acceso a almacenes ───────────────────────────────
    async def assign_role(self, user_id: UUID, role_id: UUID, *, actor: UUID) -> None:
        """Asigna un rol a un usuario con alcance `global` dentro del tenant.

        `scope_type = 'global'` con los dos `scope_*` en NULL: lo exige
        `chk_ra_scope_coherent`. El alcance por company o por almacén existe en el
        esquema y NO se expone todavía — ofrecerlo sin interfaz para elegir el alcance
        produciría asignaciones a ciegas.
        """
        await self._session.execute(
            text(
                "INSERT INTO core.role_assignments "
                "(tenant_id, user_id, role_id, scope_type, assigned_by) "
                "SELECT core.current_tenant_id(), CAST(:u AS uuid), CAST(:r AS uuid), "
                "       'global', CAST(:by AS uuid) "
                "WHERE NOT EXISTS (SELECT 1 FROM core.role_assignments x "
                "                   WHERE x.user_id = CAST(:u AS uuid) "
                "                     AND x.role_id = CAST(:r AS uuid))"
            ),
            {"u": str(user_id), "r": str(role_id), "by": str(actor)},
        )

    async def unassign_role(self, user_id: UUID, role_id: UUID) -> None:
        await self._session.execute(
            text(
                "DELETE FROM core.role_assignments "
                "WHERE user_id = CAST(:u AS uuid) AND role_id = CAST(:r AS uuid)"
            ),
            {"u": str(user_id), "r": str(role_id)},
        )

    async def grant_warehouse(self, user_id: UUID, warehouse_id: UUID, *, actor: UUID) -> None:
        """Concede acceso a un almacén.

        Si existiera una concesión REVOCADA para el mismo par, se reactiva en lugar de
        insertar otra: acumular filas revocadas haría que un futuro recuento las sume.
        """
        await self._session.execute(
            text(
                "UPDATE core.user_warehouse_access SET revoked_at = NULL, "
                "    granted_at = now(), granted_by = CAST(:by AS uuid) "
                "WHERE user_id = CAST(:u AS uuid) AND warehouse_id = CAST(:w AS uuid) "
                "  AND revoked_at IS NOT NULL"
            ),
            {"u": str(user_id), "w": str(warehouse_id), "by": str(actor)},
        )
        await self._session.execute(
            text(
                "INSERT INTO core.user_warehouse_access "
                "(tenant_id, user_id, warehouse_id, granted_by) "
                "SELECT core.current_tenant_id(), CAST(:u AS uuid), CAST(:w AS uuid), "
                "       CAST(:by AS uuid) "
                "WHERE NOT EXISTS (SELECT 1 FROM core.user_warehouse_access x "
                "                   WHERE x.user_id = CAST(:u AS uuid) "
                "                     AND x.warehouse_id = CAST(:w AS uuid))"
            ),
            {"u": str(user_id), "w": str(warehouse_id), "by": str(actor)},
        )

    async def revoke_warehouse(self, user_id: UUID, warehouse_id: UUID) -> None:
        """Revoca marcando `revoked_at`, no borrando: la concesión es historia."""
        await self._session.execute(
            text(
                "UPDATE core.user_warehouse_access SET revoked_at = now() "
                "WHERE user_id = CAST(:u AS uuid) AND warehouse_id = CAST(:w AS uuid) "
                "  AND revoked_at IS NULL"
            ),
            {"u": str(user_id), "w": str(warehouse_id)},
        )

    # ── Actualización genérica ────────────────────────────────────────────────
    async def _update(
        self,
        tabla: str,
        entity_id: UUID,
        cambios: dict[str, Any],
        *,
        permitidos: set[str],
        actor: UUID,
    ) -> int:
        """UPDATE parcial con lista blanca de columnas.

        ⚠ `permitidos` es lo que impide que un cuerpo JSON escriba `tenant_id`,
          `version` o `deleted_at`. Los nombres de columna se interpolan en el SQL
          —no existe forma de parametrizar un identificador— así que la lista blanca
          es la ÚNICA barrera. **Nunca se debe construir desde las claves del cuerpo.**

        `tabla` viene siempre de una constante de este archivo, jamás de una petición.
        """
        campos = {k: v for k, v in cambios.items() if k in permitidos}
        if not campos:
            return 0

        sets = ", ".join(f"{k} = :{k}" for k in campos)
        res = await self._session.execute(
            text(
                f"UPDATE {tabla} SET {sets}, updated_by = CAST(:_by AS uuid), "  # noqa: S608
                "    version = version + 1 "
                "WHERE id = CAST(:_id AS uuid) AND deleted_at IS NULL"
            ),
            {**campos, "_id": str(entity_id), "_by": str(actor)},
        )
        return res.rowcount or 0
