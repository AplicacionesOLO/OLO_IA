"""Repositorio de la #7 del plan de mejoras SaaS -- que modelo le toca correr
a la flota de un tenant, y como publicar uno nuevo. Ver la cabecera de la
migracion 0117 para el porque de separar esto de `ai-assets`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


class FleetModelRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def modelo_publicado(self, model_version_id: UUID) -> dict[str, Any] | None:
        """Fila de `perception.v_published_models` para esa version -- la
        vista YA filtra `status = 'published'` (0077), asi que `None` aqui
        significa "no existe" o "no esta publicada", indistintamente: ninguna
        de las dos se puede publicar a la flota.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT model_version_id, version, architecture_code, weights_object_path "
                    "FROM perception.v_published_models "
                    "WHERE model_version_id = CAST(:mvid AS uuid)"
                ),
                {"mvid": str(model_version_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def fijar_modelo_flota(
        self,
        *,
        tenant_id: UUID,
        model_version_id: UUID,
        architecture_code: str,
        version_label: str,
        object_path: str,
    ) -> dict[str, Any]:
        """Unico camino de escritura de `core.tenant_fleet_model` --
        `core.fijar_modelo_flota` comprueba `is_platform_owner()` por su
        cuenta (0117), igual que `fijar_cuota_tenant` (0113)."""
        fila = (
            await self._session.execute(
                text(
                    "SELECT out_tenant_id AS tenant_id, "
                    "       out_model_version_id AS model_version_id, "
                    "       out_architecture_code AS architecture_code, "
                    "       out_version_label AS version_label, "
                    "       out_object_path AS object_path, "
                    "       out_published_at AS published_at "
                    "FROM core.fijar_modelo_flota("
                    "CAST(:tid AS uuid), CAST(:mvid AS uuid), :arch, :ver, :path)"
                ),
                {
                    "tid": str(tenant_id),
                    "mvid": str(model_version_id),
                    "arch": architecture_code,
                    "ver": version_label,
                    "path": object_path,
                },
            )
        ).mappings().one()
        return dict(fila)

    async def modelo_flota_actual(self) -> dict[str, Any] | None:
        """El modelo asignado a la flota del tenant de la sesion -- RLS-scoped
        (0117: `fleet_model_read`), `None` si nunca se publico ninguno."""
        fila = (
            await self._session.execute(
                text(
                    "SELECT model_version_id, architecture_code, version_label, "
                    "       object_path, published_at "
                    "FROM core.tenant_fleet_model "
                    "WHERE tenant_id = core.current_tenant_id()"
                )
            )
        ).mappings().first()
        return dict(fila) if fila else None
