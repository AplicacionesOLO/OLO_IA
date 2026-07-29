"""Cliente de Supabase Storage que actua CON EL TOKEN DEL USUARIO.

Sin `service_role` (vacia por decision del proyecto), la autorizacion la imponen las
politicas RLS de `storage.objects` (migracion 0045). El backend reenvia el JWT del
llamante, asi que Storage aplica exactamente los mismos permisos que la base.

El binario NO atraviesa el backend en la subida: el cliente sube directo. Este
modulo solo verifica, firma y borra.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx

from olo.core.logging import get_logger

if TYPE_CHECKING:
    from olo.core.config import Settings

_log = get_logger(__name__)

_TIMEOUT = httpx.Timeout(20.0, connect=5.0)


class StorageError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class StorageClient:
    def __init__(self, settings: Settings, access_token: str) -> None:
        self._base = f"{settings.supabase_url}/storage/v1"
        anon = settings.supabase_anon_key
        self._headers = {
            "Authorization": f"Bearer {access_token}",
            # Storage exige `apikey` ademas del Bearer, incluso con JWT de usuario.
            **({"apikey": anon.get_secret_value()} if anon else {}),
        }

    async def head(self, bucket: str, path: str) -> dict[str, str] | None:
        """Cabeceras del objeto, o `None` si no existe.

        Un 403 vuelve como `None`, no como error: con RLS, «no autorizado a verlo» y
        «no existe» son la misma respuesta observable, y distinguirlas confirmaria
        la existencia de un objeto ajeno.
        """
        url = f"{self._base}/object/authenticated/{bucket}/{path}"
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.head(url, headers=self._headers)
        if r.status_code in (400, 403, 404):
            return None
        if r.status_code >= 400:
            # 5xx y compania si son fallos reales: tratarlos como «no existe»
            # convertiria una caida de Storage en «sube el archivo otra vez».
            raise StorageError(f"Storage respondio {r.status_code}", r.status_code)
        return dict(r.headers)

    async def sign_download(self, bucket: str, path: str, expires_in: int) -> str:
        """URL firmada de vida corta. Los buckets son privados."""
        url = f"{self._base}/object/sign/{bucket}/{path}"
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            r = await c.post(url, headers=self._headers, json={"expiresIn": expires_in})
        if r.status_code >= 400:
            raise StorageError(
                f"No se pudo firmar {path}: HTTP {r.status_code}", r.status_code
            )
        firmada = r.json().get("signedURL") or r.json().get("signedUrl")
        if not firmada:
            raise StorageError("Storage no devolvio signedURL")
        return f"{self._base.removesuffix('/storage/v1')}/storage/v1{firmada}"

    async def delete(self, bucket: str, paths: list[str]) -> bool:
        """Borra objetos. Devuelve si se borraron TODOS.

        No levanta excepcion: abortar aqui revertiria el borrado del metadato y
        dejaria al usuario sin saber si borro algo. Devolver el resultado permite
        que quien llama lo informe en lugar de ocultarlo.
        """
        if not paths:
            return True
        url = f"{self._base}/object/{bucket}"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
                r = await c.request(
                    "DELETE", url, headers=self._headers, json={"prefixes": paths}
                )
        except httpx.HTTPError as exc:
            _log.warning(
                "storage inalcanzable al borrar",
                extra={"bucket": bucket, "n": len(paths), "error": type(exc).__name__},
            )
            return False

        if r.status_code >= 400:
            _log.warning(
                "storage rechazo el borrado",
                extra={"bucket": bucket, "n": len(paths), "status": r.status_code},
            )
            return False
        return True

    def upload_endpoint(self, bucket: str, path: str) -> str:
        """Donde el cliente hace el POST del binario, con su propio token."""
        return f"{self._base}/object/{bucket}/{path}"
