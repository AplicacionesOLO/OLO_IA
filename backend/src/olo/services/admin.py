"""Configuración del sistema: la vista completa y la matriz de permisos.

─────────────────────────────────────────────────────────────────────────────
UNA SOLA LECTURA PARA TODA LA PANTALLA

`overview()` hace las nueve consultas en UNA petición. Contra el pooler cada viaje
cuesta ~260 ms, así que la pantalla tarda ~2,3 s en abrirse.

⚠ NO se paralelizan, y no por descuido: `AsyncSession` de SQLAlchemy **no es
  reentrante**. Lanzar nueve consultas concurrentes sobre la misma sesión produce
  `InterfaceError: another operation is in progress`. Hacerlo bien exigiría una sesión
  por consulta, lo que multiplica por nueve las conexiones del pool para ahorrar dos
  segundos en una pantalla que se abre dos veces al día.

  Si algún día molesta, la salida correcta es una vista materializada o un único
  `SELECT` con `json_agg` por bloque — no nueve sesiones.

─────────────────────────────────────────────────────────────────────────────
LA MATRIZ TIENE CASILLAS IMPOSIBLES, Y HAY QUE DECIRLO ANTES DEL CLIC

De 61 permisos, **27 son de alcance `platform`**. El trigger
`trg_role_permissions_scope_guard` ABORTA cualquier intento de asignarlos a un rol de
tenant, porque eso sería una escalada de privilegios: un administrador de tenant
concediéndose acceso al módulo de IA.

Con 5 roles, eso son **135 casillas de 305 que no se pueden marcar nunca**. Una
interfaz que las pinte como simples casillas vacías produce 135 clics que fallan.

Por eso `overview()` devuelve `scope` en cada permiso: la interfaz sabe qué casilla
ofrecer y cuál explicar. El motor sigue siendo la autoridad — esto solo evita
proponer un gesto que va a fallar.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy.exc import DBAPIError

from olo.core.errors import BusinessRuleError, ConflictError, NotFoundError
from olo.repositories.admin import AdminRepository
from olo.services.ai.errors import translate_pg_error

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

SCOPE_PLATFORM = "platform"

#: Mismo patron que el CHECK `chk_roles_name`. Se repite aqui a proposito: permite
#: decir «minusculas y guion bajo» en lugar de devolver una violacion de restriccion.
_NOMBRE_ROL = re.compile(r"^[a-z][a-z0-9_]*$")


class AdminService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = AdminRepository(session)

    async def overview(self) -> dict[str, Any]:
        """Todo lo que la pantalla de configuración necesita, en una respuesta.

        No se pagina nada: son 37 países, 1 entidad legal, 2 clientes, 3 almacenes
        reales, 2 usuarios, 5 roles, 61 permisos y 72 asignaciones. Paginar obligaría
        al cliente a recomponer la matriz antes de pintar una sola casilla.
        """
        # En secuencia a propósito: ver la advertencia de la cabecera del módulo.
        countries = await self._repo.countries()
        tenant_countries = await self._repo.tenant_countries()
        companies = await self._repo.companies()
        clients = await self._repo.clients()
        warehouses = await self._repo.warehouses()
        users = await self._repo.users()
        roles = await self._repo.roles()
        permissions = await self._repo.permissions()
        asignaciones = await self._repo.role_permissions()

        return {
            "countries": [dict(r) for r in countries],
            "tenant_countries": [dict(r) for r in tenant_countries],
            "companies": [dict(r) for r in companies],
            "clients": [dict(r) for r in clients],
            "warehouses": [dict(r) for r in warehouses],
            "users": [dict(r) for r in users],
            "roles": [dict(r) for r in roles],
            "permissions": [dict(r) for r in permissions],
            "role_permissions": [dict(r) for r in asignaciones],
        }

    async def set_permission(
        self, role_id: UUID, code: str, *, granted: bool, actor: UUID
    ) -> None:
        """Marca o desmarca una casilla de la matriz.

        Una sola operación para los dos sentidos: la interfaz tiene un `checkbox`, no
        dos botones, y partirlo en `grant`/`revoke` obligaría al cliente a decidir el
        verbo a partir del estado que acaba de leer — con la carrera correspondiente.

        Es IDEMPOTENTE en ambos sentidos: marcar lo ya marcado o desmarcar lo ya
        desmarcado no es un error. Con dos pestañas abiertas eso pasa.
        """
        if not await self._repo.role_exists(role_id):
            raise NotFoundError("Rol no encontrado", resource_id=str(role_id))

        # Un rol GLOBAL (`tenant_id IS NULL`) lo comparten todos los tenants. La
        # politica `rp_isolation` rechaza el INSERT con un error de privilegios que no
        # dice que hacer; aqui se explica la salida: crear un rol propio.
        if await self._repo.role_is_global(role_id):
            raise BusinessRuleError(
                "Este es un rol de sistema GLOBAL, compartido por todos los tenants: "
                "sus permisos no se pueden cambiar desde aqui porque afectaria a todo "
                "el producto. Crea un rol propio del tenant —puede heredar de este con "
                "`parent_role_id`— y edita ese."
            )

        scope = await self._repo.permission_scope(code)
        if scope is None:
            raise NotFoundError("Permiso no encontrado", resource_id=code)

        # Se comprueba ANTES de escribir para dar un mensaje que explique el modelo.
        # El trigger del motor aborta igual, pero con un error de privilegios que no
        # dice qué hacer en su lugar.
        if granted and scope == SCOPE_PLATFORM:
            raise BusinessRuleError(
                f"El permiso «{code}» es de alcance PLATAFORMA y no puede asignarse a "
                "un rol de tenant: seria una escalada de privilegios. Se concede "
                "registrando al usuario en platform.owners, no por rol."
            )

        if granted:
            await self._repo.grant(role_id, code, granted_by=actor)
        else:
            await self._repo.revoke(role_id, code)

    # ══════════════════════════════════════════════════════════════════════════
    # ESCRITURAS
    #
    # Cada método valida ANTES de tocar la base. No para sustituir al motor —que sigue
    # siendo la autoridad— sino porque una violación de CHECK o de FK llega como un
    # error de Postgres que no dice qué hacer, y quien está rellenando un formulario
    # necesita saber qué campo corregir.
    # ══════════════════════════════════════════════════════════════════════════

    # ── Países ────────────────────────────────────────────────────────────────
    async def open_country(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        """Abre un país para el operador.

        No crea el país: `public.countries` es un catálogo global. Crea la PRESENCIA
        del operador en él, que es lo que después permite tener entidades legales.
        """
        ya = {str(tc["country_id"]) for tc in await self._repo.tenant_countries()}
        if str(datos["country_id"]) in ya:
            raise ConflictError(
                "Ese país ya está abierto para este operador.", field="country_id"
            )
        try:
            return await self._repo.open_country(datos, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

    # ── Entidades legales ─────────────────────────────────────────────────────
    async def create_company(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        """Una entidad legal necesita un país ABIERTO.

        `tenant_country_id` es NOT NULL con FK compuesta: sin el país abierto la fila no
        entra, y el error de FK no explicaría que lo que falta es abrir el país.
        """
        paises = {str(tc["id"]) for tc in await self._repo.tenant_countries()}
        if str(datos["tenant_country_id"]) not in paises:
            raise BusinessRuleError(
                "Ese país no está abierto para este operador. Ábrelo primero: una "
                "entidad legal existe en un país concreto."
            )
        try:
            return await self._repo.create_company(datos, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

    async def update_company(
        self, company_id: UUID, cambios: dict[str, Any], *, actor: UUID
    ) -> None:
        try:
            n = await self._repo.update_company(company_id, cambios, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        if n == 0:
            raise NotFoundError("Entidad legal no encontrada", resource_id=str(company_id))

    async def delete_company(self, company_id: UUID, *, actor: UUID) -> None:
        """Da de baja una entidad legal, si no queda nada colgando de ella.

        Se comprueba ANTES y se responde 409 con las cifras: «tiene 2 almacenes y 3
        clientes» dice qué hacer, mientras que un error de restricción no dice nada y una
        baja silenciosa deja almacenes perteneciendo a una empresa que ya no opera.
        """
        dep = await self._repo.company_dependencies(company_id)
        if dep["almacenes"] or dep["clientes"]:
            partes = []
            if dep["almacenes"]:
                partes.append(f"{dep['almacenes']} almacen(es)")
            if dep["clientes"]:
                partes.append(f"{dep['clientes']} cliente(s)")
            raise ConflictError(
                "No se puede dar de baja: la entidad legal todavía tiene "
                + " y ".join(partes)
                + ". Reasígnalos o dalos de baja primero."
            )
        n = await self._repo.soft_delete_company(company_id, actor=actor)
        if n == 0:
            raise NotFoundError("Entidad legal no encontrada", resource_id=str(company_id))

    # ── Países del operador ───────────────────────────────────────────────────
    async def update_tenant_country(
        self, tenant_country_id: UUID, cambios: dict[str, Any], *, actor: UUID
    ) -> None:
        try:
            n = await self._repo.update_tenant_country(
                tenant_country_id, cambios, actor=actor
            )
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        if n == 0:
            raise NotFoundError(
                "País no encontrado", resource_id=str(tenant_country_id)
            )

    async def close_country(self, tenant_country_id: UUID, *, actor: UUID) -> None:
        """Cierra la presencia en un país, si no hay entidades legales dentro."""
        dep = await self._repo.tenant_country_dependencies(tenant_country_id)
        if dep["empresas"]:
            raise ConflictError(
                f"No se puede cerrar: quedan {dep['empresas']} entidad(es) legal(es) "
                "en ese país. Dalas de baja primero."
            )
        n = await self._repo.soft_delete_tenant_country(tenant_country_id, actor=actor)
        if n == 0:
            raise NotFoundError(
                "País no encontrado", resource_id=str(tenant_country_id)
            )

    # ── Usuarios ──────────────────────────────────────────────────────────────
    async def update_user(
        self, user_id: UUID, cambios: dict[str, Any], *, actor: UUID
    ) -> None:
        """Edita perfil y estado, con dos guardas.

        · Nadie se suspende a sí mismo. Un administrador que se desactiva pierde el
          acceso a la pantalla donde se reactivaría, y hay que arreglarlo por SQL.

        · Un owner de plataforma no se suspende desde aquí. Su condición no viene de un
          rol sino de `platform.owners`, así que desactivar la fila de usuario lo dejaría
          siendo owner y sin poder entrar: un estado que ninguna pantalla explica.
        """
        if cambios.get("status") in {"suspended", "inactive"}:
            if user_id == actor:
                raise ConflictError(
                    "No puedes suspender tu propia cuenta: perderías el acceso a esta "
                    "pantalla y haría falta reactivarla por base de datos."
                )
            if await self._repo.user_is_platform_owner(user_id):
                raise ConflictError(
                    "Ese usuario es owner de plataforma. Revócale primero esa condición: "
                    "suspender la cuenta lo dejaría siendo owner y sin poder entrar."
                )
        try:
            n = await self._repo.update_user(user_id, cambios, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        if n == 0:
            raise NotFoundError("Usuario no encontrado", resource_id=str(user_id))

    # ── Clientes ──────────────────────────────────────────────────────────────
    async def create_client(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        """Un cliente cuelga de la entidad legal que le presta el servicio.

        El mismo cliente en dos países son dos filas: son dos contratos distintos.
        """
        empresas = {str(c["id"]) for c in await self._repo.companies()}
        if str(datos["company_id"]) not in empresas:
            raise BusinessRuleError(
                "Esa entidad legal no existe en este operador. Un cliente lo atiende "
                "una entidad legal concreta, que determina su país y su facturación."
            )
        try:
            return await self._repo.create_client(datos, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

    async def update_client(
        self, client_id: UUID, cambios: dict[str, Any], *, actor: UUID
    ) -> None:
        try:
            n = await self._repo.update_client(client_id, cambios, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        if n == 0:
            raise NotFoundError("Cliente no encontrado", resource_id=str(client_id))

    async def delete_client(self, client_id: UUID, *, actor: UUID) -> None:
        """Baja lógica. No comprueba inventario porque el inventario no existe todavía.

        Cuando exista, aquí irá la guarda: un cliente con mercadería en el almacén no se
        puede dar de baja sin decidir qué pasa con ella.
        """
        n = await self._repo.soft_delete_client(client_id, actor=actor)
        if n == 0:
            raise NotFoundError("Cliente no encontrado", resource_id=str(client_id))

    # ── Roles ─────────────────────────────────────────────────────────────────
    async def create_role(self, datos: dict[str, Any], *, actor: UUID) -> UUID:
        """Crea un rol PROPIO del tenant. Es lo que desbloquea la matriz.

        Los 5 roles del sistema son globales y de solo lectura. Para tener permisos
        distintos hay que crear uno propio, opcionalmente heredando de uno global con
        `parent_role_id`.

        El nombre se valida contra el mismo patrón que el CHECK `chk_roles_name`
        (`^[a-z][a-z0-9_]*$`) para poder decir «minúsculas y guion bajo» en lugar de
        devolver una violación de restricción.
        """
        nombre = str(datos["name"]).strip()
        if not _NOMBRE_ROL.match(nombre):
            raise BusinessRuleError(
                f"«{nombre}» no es un nombre de rol válido: solo minúsculas, dígitos y "
                "guion bajo, empezando por letra. Ejemplo: jefe_de_turno."
            )
        if await self._repo.role_name_taken(nombre):
            raise ConflictError(f"Ya existe un rol llamado «{nombre}».", field="name")

        padre = datos.get("parent_role_id")
        if padre and not await self._repo.role_exists(UUID(str(padre))):
            raise NotFoundError("El rol del que quiere heredar no existe", resource_id=str(padre))

        try:
            return await self._repo.create_role(datos, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

    async def update_role(self, role_id: UUID, cambios: dict[str, Any], *, actor: UUID) -> None:
        if await self._repo.role_is_global(role_id):
            raise BusinessRuleError(
                "Es un rol de sistema global, compartido por todos los tenants: no se "
                "puede editar desde aquí."
            )
        if "name" in cambios:
            nombre = str(cambios["name"]).strip()
            if not _NOMBRE_ROL.match(nombre):
                raise BusinessRuleError(
                    f"«{nombre}» no es válido: solo minúsculas, dígitos y guion bajo."
                )
            if await self._repo.role_name_taken(nombre, excluding=role_id):
                raise ConflictError(f"Ya existe un rol llamado «{nombre}».", field="name")

        # Un rol no puede ser su propio padre. Lo impide `chk_roles_no_self`, y los
        # ciclos indirectos los impide el trigger `prevent_role_cycle`.
        if cambios.get("parent_role_id") and str(cambios["parent_role_id"]) == str(role_id):
            raise BusinessRuleError("Un rol no puede heredar de sí mismo.")

        try:
            n = await self._repo.update_role(role_id, cambios, actor=actor)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
        if n == 0:
            raise NotFoundError("Rol no encontrado", resource_id=str(role_id))

    async def delete_role(self, role_id: UUID, *, actor: UUID) -> None:
        """Baja lógica de un rol del tenant.

        ABORTA si alguien lo tiene asignado: borrar un rol en uso dejaría a usuarios sin
        los permisos que tenían, en silencio y sin forma de saber qué perdieron.
        """
        if await self._repo.role_is_global(role_id):
            raise BusinessRuleError(
                "Es un rol de sistema global: no se puede borrar desde un tenant."
            )
        asignados = await self._repo.role_assignment_count(role_id)
        if asignados > 0:
            raise ConflictError(
                f"{asignados} usuario(s) tienen este rol asignado. Quítaselo antes de "
                "borrarlo, o se quedarían sin esos permisos sin saberlo."
            )
        n = await self._repo.soft_delete_role(role_id, actor=actor)
        if n == 0:
            raise NotFoundError("Rol no encontrado", resource_id=str(role_id))

    # ── Usuarios: asignaciones y acceso ───────────────────────────────────────
    async def set_role_assignment(
        self, user_id: UUID, role_id: UUID, *, assigned: bool, actor: UUID
    ) -> None:
        """Asigna o quita un rol a un usuario. Idempotente en los dos sentidos.

        ⚠ NO crea usuarios. Un usuario nuevo necesita una identidad en Supabase Auth
          además de la fila en `core.users`, y eso es un flujo de invitación con correo
          — no un POST. Aquí solo se administran los usuarios que ya existen.
        """
        if not await self._repo.role_exists(role_id):
            raise NotFoundError("Rol no encontrado", resource_id=str(role_id))
        if not await self._repo.user_exists(user_id):
            raise NotFoundError("Usuario no encontrado", resource_id=str(user_id))

        try:
            if assigned:
                await self._repo.assign_role(user_id, role_id, actor=actor)
            else:
                await self._repo.unassign_role(user_id, role_id)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc

    async def set_warehouse_access(
        self, user_id: UUID, warehouse_id: UUID, *, granted: bool, actor: UUID
    ) -> None:
        """Concede o revoca acceso a un almacén. Idempotente.

        Esto es lo que decide qué ve el usuario en TODO el producto: `spatial.locations`
        filtra por `core.accessible_warehouse_ids()`, así que revocar aquí vacía el
        explorador para esa persona en la petición siguiente.
        """
        if not await self._repo.user_exists(user_id):
            raise NotFoundError("Usuario no encontrado", resource_id=str(user_id))

        try:
            if granted:
                await self._repo.grant_warehouse(user_id, warehouse_id, actor=actor)
            else:
                await self._repo.revoke_warehouse(user_id, warehouse_id)
        except DBAPIError as exc:
            raise (translate_pg_error(exc) or exc) from exc
