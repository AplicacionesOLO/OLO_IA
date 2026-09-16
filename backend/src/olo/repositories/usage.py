"""Medicion de uso del tenant (0112) -- base de cuotas y facturacion.

Sin tabla nueva: `perception.detections`, `perception.inference_jobs` y
`core.fleet_devices` ya tienen `tenant_id` y marca de tiempo, y RLS ya acota
cualquier consulta al tenant de la sesion -- igual que `FleetRepository.
listar()` no filtra por tenant a mano, esto tampoco.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from datetime import timedelta

if TYPE_CHECKING:
    from datetime import datetime
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


class UsageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def resumen(self, *, desde: datetime, hasta: datetime) -> dict[str, Any]:
        """Cuatro recuentos en una sola ida y vuelta -- una CTE por metrica en
        vez de cuatro consultas separadas, para no pagar cuatro round-trips
        por algo que se pide junto siempre.

        `dispositivos_registrados` NO esta acotado por fecha a proposito: es
        "cuantos hay AHORA", no "cuantos se dieron de alta en el periodo" --
        la pregunta que de verdad importa para una cuota es cuanta flota estas
        usando hoy, no cuanta diste de alta el mes pasado.
        """
        fila = (
            await self._session.execute(
                text(
                    """
                    SELECT
                        (SELECT count(*) FROM perception.detections
                          WHERE observed_at >= :desde AND observed_at < :hasta)
                            AS detecciones,
                        (SELECT count(*) FROM perception.inference_jobs
                          WHERE created_at >= :desde AND created_at < :hasta)
                            AS trabajos_de_inspeccion,
                        (SELECT count(*) FROM core.fleet_devices
                          WHERE registered_at >= :desde AND registered_at < :hasta)
                            AS dispositivos_nuevos,
                        (SELECT count(*) FROM core.fleet_devices
                          WHERE status_override IS NULL
                             OR status_override <> 'out_of_service')
                            AS dispositivos_registrados
                    """
                ),
                {"desde": desde, "hasta": hasta},
            )
        ).mappings().one()
        return dict(fila)

    async def cuota(self) -> dict[str, Any]:
        """La cuota del tenant de la sesion -- RLS-scoped, lectura normal (ver
        `quota_read` en 0113). Sin fila = sin cuota fijada = sin limite, y se
        devuelve como si la fila existiera con todos los campos en NULL: quien
        llama no deberia tener que distinguir "no hay fila" de "hay fila y
        dice ilimitado", son la misma cosa desde afuera.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT max_detections_monthly, max_devices, crop_retention_days, "
                    "       updated_at "
                    "FROM core.tenant_quotas WHERE tenant_id = core.current_tenant_id()"
                )
            )
        ).mappings().first()
        if fila is None:
            return {
                "max_detections_monthly": None,
                "max_devices": None,
                "crop_retention_days": None,
                "updated_at": None,
            }
        return dict(fila)

    async def detecciones_del_mes(self, *, referencia: datetime) -> int:
        """Cuenta desde el inicio del MES CALENDARIO de `referencia` -- la
        misma ventana que `UsageService.resumen` usa por defecto, para que la
        cuota se agote exactamente cuando la pantalla de Uso dice que se
        agota, no en una ventana movil distinta que nadie ve.
        """
        inicio = referencia.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*) AS n FROM perception.detections "
                    "WHERE observed_at >= :inicio"
                ),
                {"inicio": inicio},
            )
        ).mappings().one()
        return int(fila["n"])

    async def dispositivos_activos(self) -> int:
        """Igual que la columna `dispositivos_registrados` de `resumen()`,
        aislada para no traer las otras tres metricas solo para comprobar
        una cuota."""
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*) AS n FROM core.fleet_devices "
                    "WHERE status_override IS NULL OR status_override <> 'out_of_service'"
                )
            )
        ).mappings().one()
        return int(fila["n"])

    async def fijar_cuota(
        self,
        tenant_id: UUID,
        *,
        max_detecciones: int | None,
        max_dispositivos: int | None,
        retencion_dias: int | None,
    ) -> dict[str, Any]:
        """Unico llamador de `core.fijar_cuota_tenant` -- la funcion comprueba
        `is_platform_owner()` por su cuenta (ver 0113); esto es solo el envio."""
        # Alias de vuelta a los nombres de columna reales: la funcion los
        # prefija `out_` para no chocar con `ON CONFLICT (tenant_id)` -- ver
        # 0114/0115. Este es el UNICO sitio que necesita saberlo.
        fila = (
            await self._session.execute(
                text(
                    "SELECT out_tenant_id AS tenant_id, "
                    "       out_max_detections_monthly AS max_detections_monthly, "
                    "       out_max_devices AS max_devices, "
                    "       out_crop_retention_days AS crop_retention_days, "
                    "       out_updated_at AS updated_at "
                    "FROM core.fijar_cuota_tenant("
                    "CAST(:tid AS uuid), CAST(:md AS int), CAST(:dd AS int), CAST(:rd AS int))"
                ),
                {
                    "tid": str(tenant_id),
                    "md": max_detecciones,
                    "dd": max_dispositivos,
                    "rd": retencion_dias,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def recortes_vencidos(self, *, referencia: datetime, dias: int) -> list[str]:
        """Rutas UNICAS de recortes cuya deteccion es mas vieja que `dias` --
        candidatas a borrar de Storage. Distintas detecciones del mismo
        instante comparten `crop_path` (el S21 sube uno cada ~2s y lo reparte
        entre el lote, ver `adjuntarFotogramaSiToca`), asi que se deduplica
        aqui: borrar el mismo objeto dos veces no es un problema, pero
        pedirselo dos veces a Storage si lo es -- trabajo doble para nada.

        Acotado a `inference_jobs.origin = 'edge_device'` (0109) A PROPOSITO:
        `perception.detections.crop_path` tiene DOS productores independientes
        -- el S21/borde (esto) y `save_detected_frames` del worker de nube
        para trabajos de video reales (`origin` default `'stream'`). Sin este
        filtro, una retencion corta borra recortes de analisis de video
        legitimos que no tienen nada que ver con pruebas de campo del borde --
        eso ya paso una vez contra datos reales, no se repite.
        """
        corte = referencia - timedelta(days=dias)
        filas = (
            await self._session.execute(
                text(
                    "SELECT DISTINCT d.crop_path FROM perception.detections d "
                    "JOIN perception.inference_jobs j ON j.id = d.job_id "
                    "WHERE d.crop_path IS NOT NULL AND d.observed_at < :corte "
                    "AND j.origin = 'edge_device'"
                ),
                {"corte": corte},
            )
        ).mappings()
        return [f["crop_path"] for f in filas]
