"""Servicio de la #7 del plan de mejoras SaaS -- actualizacion remota del
modelo. Ver la cabecera de la migracion 0117 para el porque del bucket propio
`fleet-models` y la separacion de `ai-assets`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from olo.core.errors import BusinessRuleError, NotFoundError
from olo.domain.ai.asset import BUCKET as AI_ASSETS_BUCKET
from olo.repositories.fleet_model import FleetModelRepository
from olo.storage.supabase_storage import StorageClient

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.config import Settings

#: Bucket propio para lo que un dispositivo SI puede leer con su credencial
#: normal -- ver la cabecera de 0117 sobre por que esto no puede ser
#: `ai-assets`.
FLEET_MODELS_BUCKET = "fleet-models"

#: Vida de la URL firmada que recibe el dispositivo -- corta, igual criterio
#: que `_SIGNED_URL_TTL` de `ai_assets.py`: es un archivo de varios MB, no
#: necesita durar mas de lo que tarda en empezar la descarga.
_DESCARGA_TTL_S = 300


class FleetModelService:
    def __init__(self, session: AsyncSession, settings: Settings, access_token: str) -> None:
        self._repo = FleetModelRepository(session)
        self._storage = StorageClient(settings, access_token)

    async def publicar(self, *, tenant_id: UUID, model_version_id: UUID) -> dict[str, Any]:
        """Copia los pesos de una version PUBLICADA de `ai-assets` a
        `fleet-models`, y la fija como la version que le toca a la flota de
        `tenant_id`.

        Requiere que quien llama sea platform owner por PARTIDA DOBLE: la
        lectura de `ai-assets` lo exige por su propia politica de Storage
        (0045) -- este metodo fallaria con cualquier otro token -- y la
        escritura en `core.tenant_fleet_model` lo exige `core.
        fijar_modelo_flota` (0117). No hay un tercer chequeo aqui que se
        pueda saltar: los dos primeros ya bastan.
        """
        publicado = await self._repo.modelo_publicado(model_version_id)
        if publicado is None:
            raise NotFoundError(
                "Esa version no existe o no esta publicada -- publica el modelo "
                "primero desde el catalogo de IA.",
                resource_id=str(model_version_id),
            )
        ruta_origen = publicado["weights_object_path"]
        if not ruta_origen:
            raise BusinessRuleError(
                "Esta version no tiene pesos disponibles (el asset se borro). "
                "No hay nada que publicar a la flota."
            )

        contenido = await self._storage.download(AI_ASSETS_BUCKET, ruta_origen)
        if contenido is None:
            raise BusinessRuleError(
                "No se pudieron leer los pesos de esta version desde Storage."
            )

        nombre = ruta_origen.rsplit("/", 1)[-1]
        ruta_destino = f"{tenant_id}/{model_version_id}/{nombre}"
        await self._storage.upload(
            FLEET_MODELS_BUCKET, ruta_destino, contenido, "application/octet-stream"
        )

        return await self._repo.fijar_modelo_flota(
            tenant_id=tenant_id,
            model_version_id=model_version_id,
            architecture_code=publicado["architecture_code"],
            # `ai.model_versions.version` es un entero (numero de version, no
            # texto) -- se guarda como cadena aqui porque el dispositivo solo
            # lo COMPARA contra lo que ya trae instalado, nunca lo aritmetiza.
            version_label=str(publicado["version"]),
            object_path=ruta_destino,
        )

    async def actual(self) -> dict[str, Any] | None:
        return await self._repo.modelo_flota_actual()

    async def revisar_actualizacion(self) -> dict[str, Any]:
        """Lo que un dispositivo necesita para decidir si actualizar: version
        y arquitectura vigentes, mas una URL de descarga de vida corta.

        LA DECISION DE ACTUALIZAR ES DEL DISPOSITIVO, no de este metodo: aqui
        no se compara contra ningun `current_model_version` -- el dispositivo
        ya sabe que trae instalado (ver la cabecera de 0117) y compara el
        `version` de esta respuesta contra eso. Mandar siempre la misma
        respuesta, este o no al dia, mantiene el endpoint sin estado por
        dispositivo: no hace falta saber CUAL dispositivo pregunta, solo de
        que tenant es.
        """
        actual = await self.actual()
        if actual is None:
            return {"model_available": False}

        url = await self._storage.sign_download(
            FLEET_MODELS_BUCKET, actual["object_path"], _DESCARGA_TTL_S
        )
        return {
            "model_available": True,
            "version": actual["version_label"],
            "architecture_code": actual["architecture_code"],
            "download_url": url,
            "expires_in": _DESCARGA_TTL_S,
        }
