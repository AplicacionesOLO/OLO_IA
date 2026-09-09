"""Servicio de medicion de uso (0112). Ver ADR de cuotas/facturacion (#4/#10
del plan de mejoras SaaS) -- este servicio es la base de ambas: ninguna de
las dos puede decidir nada sin saber primero cuanto consume el tenant."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from olo.core.errors import BusinessRuleError
from olo.domain.perception import BUCKET as PERCEPTION_BUCKET
from olo.repositories.usage import UsageRepository
from olo.storage.supabase_storage import StorageClient

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings


def _inicio_de_mes(referencia: datetime) -> datetime:
    return referencia.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


# Probado en vivo: un DELETE de Storage con unos cientos de rutas devolvio 413
# Payload Too Large. 50 es conservador a proposito -- no hay documentado un
# limite exacto, y un lote mas pequeño de lo necesario solo cuesta mas
# llamadas, mientras que uno demasiado grande vuelve a fallar entero.
_LOTE_BORRADO = 50


class UsageService:
    def __init__(
        self, session: AsyncSession, settings: Settings | None = None, access_token: str | None = None
    ) -> None:
        # `settings`/`access_token` solo hacen falta para `limpiar_recortes_
        # vencidos` (habla con Storage) -- igual criterio que
        # `PerceptionService`: opcionales para no obligar a los demas
        # metodos, que no tocan un solo byte, a cargar con credenciales que
        # no usan.
        self._repo = UsageRepository(session)
        self._storage = (
            StorageClient(settings, access_token)
            if settings is not None and access_token is not None
            else None
        )

    async def resumen(
        self, *, desde: datetime | None = None, hasta: datetime | None = None
    ) -> dict[str, Any]:
        """El uso del periodo. Sin fechas, el MES CALENDARIO en curso -- la
        pregunta que de verdad se hace un administrador al abrir esto es
        "¿cuanto llevamos consumido este mes?", no un rango arbitrario que
        tendria que calcular el a mano cada vez.
        """
        ahora = datetime.now(UTC)
        inicio = desde or _inicio_de_mes(ahora)
        fin = hasta or ahora
        datos = await self._repo.resumen(desde=inicio, hasta=fin)
        return {"period_start": inicio, "period_end": fin, **datos}

    async def cuota(self) -> dict[str, Any]:
        return await self._repo.cuota()

    async def fijar_cuota(
        self,
        tenant_id: UUID,
        *,
        max_detecciones: int | None,
        max_dispositivos: int | None,
        retencion_dias: int | None,
    ) -> dict[str, Any]:
        """`core.fijar_cuota_tenant` ya comprueba `is_platform_owner()` por su
        cuenta -- ver 0113. La dependencia `PlatformOwnerRequired` del
        endpoint es la primera puerta; esta es la segunda, la que no se
        puede saltar aunque alguien llame a la funcion SQL directo."""
        return await self._repo.fijar_cuota(
            tenant_id,
            max_detecciones=max_detecciones,
            max_dispositivos=max_dispositivos,
            retencion_dias=retencion_dias,
        )

    async def verificar_cupo_detecciones(self, *, nuevas: int) -> None:
        """Rechaza ANTES de insertar si el lote haria que el tenant supere su
        cuota mensual -- llamar desde `PerceptionService.ingest_detections`.

        Se compara `ya_van + nuevas > limite` y no `ya_van > limite`: sin
        esto, el ultimo lote que de verdad cruza la linea siempre se
        aceptaria (la comprobacion se hace ANTES de sumarlo), y la cuota se
        excederia en exactamente el tamaño de un lote cada vez.
        """
        cuota = await self.cuota()
        limite = cuota["max_detections_monthly"]
        if limite is None:
            return
        ahora = datetime.now(UTC)
        ya_van = await self._repo.detecciones_del_mes(referencia=ahora)
        if ya_van + nuevas > limite:
            raise BusinessRuleError(
                f"Cuota mensual de detecciones alcanzada ({ya_van}/{limite} este mes). "
                "Contacta a tu administrador para ampliarla."
            )

    async def verificar_cupo_dispositivos(self) -> None:
        """Igual que `verificar_cupo_detecciones` pero para la flota -- llamar
        desde `FleetService.provision` ANTES de crear el dispositivo nuevo."""
        cuota = await self.cuota()
        limite = cuota["max_devices"]
        if limite is None:
            return
        activos = await self._repo.dispositivos_activos()
        if activos >= limite:
            raise BusinessRuleError(
                f"Cuota de dispositivos alcanzada ({activos}/{limite}). Retira uno que ya "
                "no uses, o contacta a tu administrador para ampliar la cuota."
            )

    async def limpiar_recortes_vencidos(self) -> dict[str, Any]:
        """Borra de Storage los recortes mas viejos que `crop_retention_days`
        (0115) -- llamar desde `POST /v1/usage/cleanup/crops`, tipicamente
        via `backend/tools/limpiar_recortes.py` como tarea programada.

        NO toca `Detection.crop_path`: la fila se queda apuntando a un
        objeto que ya no existe, y `crop_url`/`getCropUrl` ya lo manejan --
        `CapturasGallery` (frontend) muestra "Sin acceso" en vez de romperse.
        Es el mismo criterio que `AiAssetService.delete_asset`: "se prefiere
        el huerfano al inverso" (ver su comentario de clase) -- limpiar la
        fila ademas del binario es una segunda pasada que esto no hace.

        Sin cuota de retencion fijada (`crop_retention_days IS NULL`), no
        borra nada -- "conservar para siempre" es una respuesta valida, no
        una configuracion a medias.
        """
        if self._storage is None:
            raise BusinessRuleError(
                "Este servicio no tiene acceso a Storage -- hace falta el token del llamante"
            )
        cuota = await self.cuota()
        dias = cuota["crop_retention_days"]
        if dias is None:
            return {"borrados": 0, "retencion_dias": None}

        rutas = await self._repo.recortes_vencidos(referencia=datetime.now(UTC), dias=dias)
        if not rutas:
            return {"borrados": 0, "retencion_dias": dias}

        # En LOTES: probado en vivo contra el proyecto real, un solo DELETE con
        # unos cientos de rutas de un dia normal de pruebas ya devolvio 413
        # Payload Too Large -- el limite de Supabase Storage para este
        # endpoint es mas bajo de lo que parece a simple vista. Un lote que
        # falla no detiene a los demas: es mejor borrar 90 de 100 que
        # ninguno por culpa de un unico lote grande.
        borrados = 0
        algun_fallo = False
        for inicio in range(0, len(rutas), _LOTE_BORRADO):
            lote = rutas[inicio : inicio + _LOTE_BORRADO]
            if await self._storage.delete(PERCEPTION_BUCKET, lote):
                borrados += len(lote)
            else:
                algun_fallo = True

        return {"borrados": borrados, "retencion_dias": dias, "fallo": algun_fallo}
