"""Anotaciones de una imagen: leer el conjunto y reemplazarlo.

Dos endpoints y ninguno más, a propósito. Ver `services/ai/annotation.py` para el
razonamiento completo; en corto: quien anota dibuja, corrige y borra varias cajas
antes de guardar, el estado de la imagen depende del conjunto y no de una caja
suelta, y `ai.annotations` no tiene política de DELETE en RLS.

El `PUT` es idempotente: enviar dos veces la misma lista deja el mismo conjunto. Lo
que no es idempotente es el `If-Match`, y con razón — el segundo intento con el ETag
viejo recibe un 409, que es lo que evita que dos anotadores se pisen.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Response

from olo.api.deps import Db, PlatformOwnerRequired, require
from olo.api.v1.ai_schemas import (
    AnnotationOut,
    AnnotationsReplaceIn,
    AnnotationsSavedOut,
)
from olo.api.v1.schemas import Envelope
from olo.api.v1.warehouses import _etag, _parse_if_match
from olo.core.errors import BusinessRuleError
from olo.domain.ai.annotation import Annotation, AnnotationDraft, BBox
from olo.domain.warehouse import DomainRuleError
from olo.repositories import identity
from olo.services.ai.annotation import AiAnnotationService

router = APIRouter(prefix="/ai", tags=["ai-annotations"])

#: Escala de `numeric(9,8)`. El JSON llega como doble y hay que cuantizarlo ANTES de
#: validar rangos: `0.30000000000000004` —un clásico del coma flotante— tiene 17
#: decimales y el motor lo redondearía al insertar, de modo que la caja validada y
#: la guardada no serían la misma. Cuantizando aquí, lo que se valida es lo que se
#: guarda.
_ESCALA = Decimal("0.00000001")


def _a_decimal(valor: float) -> Decimal:
    return Decimal(str(valor)).quantize(_ESCALA)


def _salida(a: Annotation) -> AnnotationOut:
    return AnnotationOut(
        id=a.id,
        project_id=a.project_id,
        image_id=a.image_id,
        class_id=a.class_id,
        kind=a.kind,
        cx=float(a.box.cx) if a.box else None,
        cy=float(a.box.cy) if a.box else None,
        w=float(a.box.w) if a.box else None,
        h=float(a.box.h) if a.box else None,
        origin=a.origin,
        confidence=float(a.confidence) if a.confidence is not None else None,
        version=a.version,
        created_at=a.created_at,
        updated_at=a.updated_at,
        class_name=a.class_name,
        class_color=a.class_color,
        class_index=a.class_index,
    )


@router.get(
    "/images/{image_id}/annotations",
    response_model=Envelope[list[AnnotationOut]],
    dependencies=[PlatformOwnerRequired, require("annotations:read")],
    summary="Anotaciones de una imagen, con su clase resuelta",
)
async def list_annotations(db: Db, image_id: UUID) -> Envelope[list[AnnotationOut]]:
    filas = await AiAnnotationService(db).list_for_image(image_id)
    return Envelope[list[AnnotationOut]](data=[_salida(a) for a in filas])


@router.put(
    "/images/{image_id}/annotations",
    response_model=Envelope[AnnotationsSavedOut],
    dependencies=[PlatformOwnerRequired, require("annotations:write")],
    summary="Reemplazar TODAS las anotaciones de una imagen",
)
async def replace_annotations(
    db: Db,
    image_id: UUID,
    payload: AnnotationsReplaceIn,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Envelope[AnnotationsSavedOut]:
    """El `If-Match` es la versión de la IMAGEN, no la de una anotación.

    Es el cerrojo del conjunto completo: dos personas anotando la misma imagen es el
    conflicto real, y quien guarda segundo recibe 409 y vuelve a leer. Llevar una
    versión por caja obligaría al cliente a resolver N conflictos y no protegería de
    nada más.

    Guardar puede mover la imagen de `pending` a `annotated`, o devolverla a
    `pending` si se quedó sin cajas. NO toca `validated` ni `rejected`: los pone una
    persona revisando, y ajustar una caja no puede deshacer una validación.
    """
    esperada = _parse_if_match(if_match)
    user_id = await identity.fetch_current_user_id(db)

    # La conversión a `Decimal` y la construcción de `BBox` validan la geometría
    # antes de tocar la base. El índice va en el mensaje: con ocho cajas, «la caja
    # se sale por los lados» sin decir cuál no sirve de nada.
    borradores: list[AnnotationDraft] = []
    for posicion, a in enumerate(payload.annotations):
        try:
            caja = BBox(
                cx=_a_decimal(a.cx),
                cy=_a_decimal(a.cy),
                w=_a_decimal(a.w),
                h=_a_decimal(a.h),
            )
        except DomainRuleError as exc:
            raise BusinessRuleError(f"anotación {posicion + 1}: {exc}") from exc
        borradores.append(AnnotationDraft(class_id=a.class_id, box=caja, id=a.id))

    resultado = await AiAnnotationService(db).replace_for_image(
        image_id, borradores, expected_version=esperada, updated_by=user_id
    )

    response.headers["ETag"] = _etag(resultado.image.version)
    return Envelope[AnnotationsSavedOut](
        data=AnnotationsSavedOut(
            annotations=[_salida(a) for a in resultado.annotations],
            image_id=resultado.image.id,
            image_status=resultado.image.status.value,
            image_version=resultado.image.version,
        )
    )
