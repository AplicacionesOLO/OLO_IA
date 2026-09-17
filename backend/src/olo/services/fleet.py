"""Servicio de la flota de dispositivos de borde (0110). Ver ADR-015."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

import httpx
from sqlalchemy import text

from olo.core.errors import BusinessRuleError, ForbiddenError, NotFoundError
from olo.repositories import identity
from olo.repositories.admin import AdminRepository
from olo.repositories.fleet import FleetRepository
from olo.security.authorization import can_access_warehouse, require_permission
from olo.services.usage import UsageService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings
    from olo.core.context import TenantContext
    from olo.services.notifications import NotificationService

_SUPABASE_TIMEOUT = httpx.Timeout(20.0, connect=5.0)

#: Cuanto puede llevar un dispositivo sin latir antes de que se considere una
#: caida digna de avisar -- mucho mas que los 45 s del punto rojo/verde de la
#: pantalla de Flota (`core.fleet_device_status`): ese umbral es para el
#: estado en vivo, este es para no despertar a un administrador por una wifi
#: que titubea.
_OFFLINE_ALERTA_S = 600


class FleetService:
    def __init__(
        self, session: AsyncSession, ctx: TenantContext, settings: Settings | None = None
    ) -> None:
        # `settings` es opcional porque solo lo necesita `provision` (para
        # llamar a Supabase Auth) -- los otros tres metodos existentes desde
        # 0110 no lo tocan, y obligarlos a pasarlo seria ruido en su firma.
        self._session = session
        self._repo = FleetRepository(session)
        self._ctx = ctx
        self._settings = settings

    async def heartbeat(
        self,
        *,
        device_key: str,
        kind: str,
        name: str,
        warehouse_id: UUID,
        app_version: str | None,
        device_model: str | None,
        current_job_id: UUID | None,
        current_model_version: str | None = None,
    ) -> dict[str, Any]:
        """Registra el dispositivo o refresca su latido.

        No hace falta un `can_access_warehouse` aparte: la FK compuesta
        `(tenant_id, warehouse_id)` de 0110 contra `core.warehouses` ya
        rechaza un almacen de otro tenant, y RLS acota el resto -- el mismo
        criterio que ya sigue `PerceptionService.start_live`.
        """
        return await self._repo.latir(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            device_key=device_key,
            kind=kind,
            name=name,
            app_version=app_version,
            device_model=device_model,
            current_job_id=current_job_id,
            current_model_version=current_model_version,
        )

    async def list_devices(self, *, warehouse_id: UUID | None) -> dict[str, Any]:
        """La flota, con cuantos estan operativos AHORA.

        "Operativo" es `connected` o `live` -- lo contrario de `offline` (sin
        latido reciente) u `out_of_service` (retirado a mano). Contarlo aqui
        y no en el cliente es el mismo criterio que `alive` en
        `PerceptionService.list_workers`: una sola forma de contar lo mismo.
        """
        dispositivos = await self._repo.listar(warehouse_id=warehouse_id)
        online = sum(1 for d in dispositivos if d["status"] in ("connected", "live"))
        return {"devices": dispositivos, "online": online}

    async def retire(self, device_id: UUID, *, reason: str | None) -> dict[str, Any]:
        fila = await self._repo.retirar(device_id, motivo=reason)
        if fila is None:
            raise NotFoundError(f"dispositivo {device_id} no encontrado")
        return fila

    async def reactivate(self, device_id: UUID) -> dict[str, Any]:
        fila = await self._repo.reactivar(device_id)
        if fila is None:
            raise NotFoundError(f"dispositivo {device_id} no encontrado")
        return fila

    async def revisar_dispositivos_offline(
        self, *, notificaciones: NotificationService
    ) -> dict[str, Any]:
        """Avisa a los `tenant_admin` de cada dispositivo que dejo de latir
        sin haber sido retirado a mano -- pensado para un barrido programado,
        idempotente por caida (ver `FleetRepository.caidos_sin_avisar`: se
        limpia solo en el siguiente latido, 0116, #6 del plan de mejoras SaaS).
        """
        caidos = await self._repo.caidos_sin_avisar(umbral_segundos=_OFFLINE_ALERTA_S)
        avisados: list[str] = []
        for dispositivo in caidos:
            enviados = await notificaciones.avisar_admins(
                kind="fleet_device.offline",
                title=f"Dispositivo caido: {dispositivo['name']}",
                body=(
                    f"«{dispositivo['name']}» ({dispositivo['kind']}) no da señal "
                    f"desde {dispositivo['last_seen_at']}. Revisa si sigue en campo."
                ),
                link="/fleet",
            )
            if enviados:
                await self._repo.marcar_alerta_offline(UUID(str(dispositivo["id"])))
                avisados.append(dispositivo["name"])
        return {"dispositivos_avisados": avisados}

    async def provision(
        self, *, warehouse_id: UUID, kind: str, name: str
    ) -> dict[str, Any]:
        """Da de alta un dispositivo con SU PROPIA credencial -- a diferencia
        de `heartbeat`, que solo registra el latido de uno que ya trae su
        `device_key` propio (tipicamente generado por el mismo dispositivo la
        primera vez que arranca, y de ahi en adelante login con el email/
        password de una persona -- ver `gradle.properties` del prototipo S21).

        ── LOS CUATRO PASOS, Y POR QUE EN ESTE ORDEN ─────────────────────────

        1. Una identidad NUEVA en Supabase Auth (anonima -- sin ella no hay
           `auth_id` que darle a `core.users`).
        2. `core.alta_usuario_invitado`: crea `core.users` + la membresia
           activa, en un solo paso atomico -- reutiliza EXACTAMENTE la misma
           funcion que da de alta a una persona invitada, asi que el
           dispositivo pasa por el mismo camino ya auditado, no uno paralelo.
        3. Se le asigna el rol `device` (creado en 0111): SOLO
           `perception:ingest` y `drones:ingest`, nunca lectura de nada mas.
        4. Se registra el dispositivo en `core.fleet_devices` con un
           `device_key` generado aqui (no lo trae el cliente, a diferencia de
           `heartbeat`) y vinculado a la identidad recien creada.

        Si el paso 1 tiene exito pero cualquiera de 2-4 falla, la identidad de
        Auth queda huerfana (sin `core.users` que la use) -- inofensiva: sin
        membresia no autoriza nada, y una fila huerfana en `auth.users` no es
        distinta en riesgo de una cuenta que alguien invito y nunca activo.
        """
        await require_permission(self._session, self._ctx, "roles:assign")
        if not await can_access_warehouse(self._session, warehouse_id):
            raise ForbiddenError("No tienes acceso a ese almacen")
        # ANTES de crear nada en Supabase Auth: fallar por cuota despues de ya
        # haber creado una identidad huerfana seria peor que fallar temprano.
        await UsageService(self._session).verificar_cupo_dispositivos()

        auth_id, refresh_token = await self._crear_identidad_anonima()

        alta = (
            await self._session.execute(
                text(
                    "SELECT * FROM core.alta_usuario_invitado("
                    "CAST(:aid AS uuid), :email, :fn, :ln)"
                ),
                {
                    "aid": str(auth_id),
                    "email": f"device+{auth_id}@devices.olo-ia.internal",
                    "fn": "Dispositivo",
                    "ln": name,
                },
            )
        ).mappings().one()
        user_id = UUID(str(alta["user_id"]))

        rol_id = (
            await self._session.execute(
                text(
                    "SELECT id FROM core.roles WHERE name = 'device' AND tenant_id IS NULL"
                )
            )
        ).scalar_one()
        actor = await identity.fetch_current_user_id(self._session)
        await AdminRepository(self._session).assign_role(user_id, rol_id, actor=actor)

        dispositivo = await self._repo.latir(
            tenant_id=self._ctx.tenant_id,
            warehouse_id=warehouse_id,
            device_key=str(uuid4()),
            kind=kind,
            name=name,
            app_version=None,
            device_model=None,
            current_job_id=None,
        )
        await self._repo.vincular_auth(UUID(str(dispositivo["id"])), user_id)

        return {"device": dispositivo, "refresh_token": refresh_token}

    async def _crear_identidad_anonima(self) -> tuple[UUID, str]:
        """Un usuario NUEVO de Supabase Auth, sin email ni password -- server a
        server, con la anon key (NUNCA `service_role`: decision deliberada del
        proyecto, ver `StorageClient`). Devuelve `(auth_user_id, refresh_token)`.

        El refresh token es lo UNICO que el dispositivo necesita guardar: con
        el consigue access tokens nuevos indefinidamente via `POST /v1/auth/
        refresh` (el mismo endpoint que ya usa `OloApiClient.refrescar()` en
        el S21), sin volver a pasar por este alta ni por ningun login humano.

        Requiere que el proyecto de Supabase tenga habilitados los inicios de
        sesion anonimos (Authentication > Sign In / Up > Anonymous) -- si no
        lo estan, Supabase responde 422 `anonymous_provider_disabled` y aqui
        se traduce a un mensaje que dice exactamente que ajuste falta, en vez
        de un 500 sin explicacion.
        """
        if self._settings is None:
            raise BusinessRuleError("Este servicio no tiene acceso a la configuracion de Supabase")
        anon = self._settings.supabase_anon_key
        if anon is None:
            raise BusinessRuleError("Falta configurar la anon key de Supabase")

        url = f"{self._settings.supabase_url}/auth/v1/signup"
        async with httpx.AsyncClient(timeout=_SUPABASE_TIMEOUT) as cliente:
            resp = await cliente.post(
                url, headers={"apikey": anon.get_secret_value()}, json={}
            )
        if resp.status_code >= 400:
            detalle = resp.text[:300]
            raise BusinessRuleError(
                "No se pudo crear la identidad del dispositivo en Supabase Auth "
                f"(HTTP {resp.status_code}: {detalle}). Si el error menciona "
                "'anonymous_provider_disabled', hay que habilitar los inicios de "
                "sesion anonimos en el proyecto de Supabase: Authentication > "
                "Sign In / Up > Anonymous."
            )
        datos = resp.json()
        auth_id = UUID(str(datos["user"]["id"]))
        refresh_token = str(datos["refresh_token"])
        return auth_id, refresh_token
