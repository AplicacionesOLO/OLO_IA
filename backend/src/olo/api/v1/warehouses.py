"""Endpoints de almacenes. Primer módulo de negocio, CRUD completo.

Cada endpoint declara su permiso en la firma, así que un endpoint sin permiso se
detecta leyendo el router en lugar de auditando el cuerpo.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response, status

from olo.api.deps import CurrentContext, Db, require
from olo.api.v1.schemas import (
    Envelope,
    PagedEnvelope,
    PageMeta,
    WarehouseCreate,
    WarehouseOut,
    WarehouseUpdate,
)
from olo.core.errors import PreconditionRequiredError, VersionConflictError
from olo.domain.warehouse import WarehouseStatus
from olo.services.warehouse import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, WarehouseService

router = APIRouter(prefix="/warehouses", tags=["warehouses"])

_ETAG_PREFIX = "W/"


def _etag(version: int) -> str:
    return f'{_ETAG_PREFIX}"{version}"'


def _parse_if_match(if_match: str | None) -> int:
    """Extrae la versión del `If-Match`. Obligatorio en toda mutación.

    Sin `If-Match` no hay optimistic locking posible: dos usuarios editando el
    mismo almacén se sobrescribirían en silencio. Se responde 428, que existe
    exactamente para «falta una precondición», y no 400.
    """
    if not if_match:
        raise PreconditionRequiredError(
            "Se requiere la cabecera If-Match con el ETag obtenido del GET"
        )
    raw = if_match.strip()
    if raw.startswith(_ETAG_PREFIX):
        raw = raw[len(_ETAG_PREFIX) :]
    raw = raw.strip().strip(chr(34))
    try:
        return int(raw)
    except ValueError as exc:
        raise VersionConflictError(f"ETag no reconocido: {if_match!r}") from exc


@router.get(
    "",
    response_model=PagedEnvelope[WarehouseOut],
    dependencies=[require("warehouses:read")],
    summary="Listar almacenes accesibles",
)
async def list_warehouses(
    db: Db,
    ctx: CurrentContext,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query()] = None,
    company_id: Annotated[UUID | None, Query()] = None,
    status_filter: Annotated[WarehouseStatus | None, Query(alias="status")] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> PagedEnvelope[WarehouseOut]:
    """Devuelve solo los almacenes accesibles para el usuario.

    El filtrado lo aplica RLS: un usuario sin almacenes asignados y sin
    `tenant_wide_access` recibe una lista vacía, no un error.
    """
    page = await WarehouseService(db, ctx).list_warehouses(
        limit=limit,
        cursor=cursor,
        company_id=company_id,
        status=status_filter,
        search=search,
    )
    return PagedEnvelope[WarehouseOut](
        data=[WarehouseOut.model_validate(w) for w in page.items],
        pagination=PageMeta(next_cursor=page.next_cursor, page_size=limit),
    )


@router.get(
    "/{warehouse_id}",
    response_model=Envelope[WarehouseOut],
    dependencies=[require("warehouses:read")],
    summary="Obtener un almacén",
)
async def get_warehouse(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    response: Response,
) -> Envelope[WarehouseOut]:
    """404 si no existe, si es de otro tenant o si no es accesible.

    Los tres casos son indistinguibles a propósito: un 403 confirmaría la
    existencia del recurso.
    """
    wh = await WarehouseService(db, ctx).get_warehouse(warehouse_id)
    response.headers["ETag"] = _etag(wh.version)
    return Envelope[WarehouseOut](data=WarehouseOut.model_validate(wh))


@router.post(
    "",
    response_model=Envelope[WarehouseOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[require("warehouses:create")],
    summary="Crear un almacén",
)
async def create_warehouse(
    payload: WarehouseCreate,
    db: Db,
    ctx: CurrentContext,
    response: Response,
) -> Envelope[WarehouseOut]:
    """Crea un almacén en una compañía del tenant.

    Si `company_id` pertenece a otro tenant, la FK compuesta
    `(tenant_id, company_id)` lo rechaza en el motor y el manejador lo traduce a
    422 `INVALID_REFERENCE`. No se comprueba antes: la garantía está en la base,
    no en una validación que se pueda olvidar.
    """
    wh = await WarehouseService(db, ctx).create_warehouse(
        company_id=payload.company_id,
        name=payload.name,
        code=payload.code,
        timezone=payload.timezone,
        locale=payload.locale,
        currency_code=payload.currency_code,
        latitude=payload.latitude,
        longitude=payload.longitude,
        address=payload.address,
    )
    response.headers["ETag"] = _etag(wh.version)
    response.headers["Location"] = f"/v1/warehouses/{wh.id}"
    return Envelope[WarehouseOut](data=WarehouseOut.model_validate(wh))


@router.patch(
    "/{warehouse_id}",
    response_model=Envelope[WarehouseOut],
    dependencies=[require("warehouses:update")],
    summary="Actualizar un almacén",
)
async def update_warehouse(
    warehouse_id: UUID,
    payload: WarehouseUpdate,
    db: Db,
    ctx: CurrentContext,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Envelope[WarehouseOut]:
    """Actualización parcial. Requiere `If-Match` con el ETag del GET.

    `code` y `company_id` no son actualizables: no existen en el esquema, así
    que enviarlos produce 400 por `extra="forbid"`.
    """
    expected = _parse_if_match(if_match)
    wh = await WarehouseService(db, ctx).update_warehouse(
        warehouse_id, payload.changes(), expected_version=expected
    )
    response.headers["ETag"] = _etag(wh.version)
    return Envelope[WarehouseOut](data=WarehouseOut.model_validate(wh))


@router.delete(
    "/{warehouse_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require("warehouses:delete")],
    summary="Desactivar un almacén",
)
async def delete_warehouse(
    warehouse_id: UUID,
    db: Db,
    ctx: CurrentContext,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> None:
    """Borrado LÓGICO: marca `deleted_at` y pasa el estado a `inactive`.

    Rechaza con 409 si el almacén tiene áreas o ubicaciones activas: el borrado
    es lógico y las claves foráneas no lo ven, así que sin esta comprobación
    quedarían huérfanas apuntando a un almacén borrado.
    """
    expected = _parse_if_match(if_match)
    await WarehouseService(db, ctx).delete_warehouse(warehouse_id, expected_version=expected)
