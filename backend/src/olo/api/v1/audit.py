"""Auditoría: quién cambió qué, y cuándo.

── SOLO GET, Y ES LA PROPIEDAD QUE DEFINE EL MODULO ─────────────────────────

No hay POST, PATCH ni DELETE. No es que falten: `olo_app` **no tiene privilegio de
INSERT** sobre `audit.entries` (migración 0085), así que un endpoint de escritura
fallaría en el motor. Quien escribe es el trigger `audit.registrar()`, con SECURITY
DEFINER.

Eso hace que la única forma de cambiar algo sin dejar rastro sea tener permiso para
desactivar el trigger — que es exactamente el privilegio que se quiere vigilar. Y si
alguien lo desactiva, `watched` lo dice en la respuesta.

── EL PERMISO ───────────────────────────────────────────────────────────────

    audit:read    ver el registro   · tenant_admin y auditor

Y NO se hereda de poder entrar al sistema: el registro dice quién hizo qué, o sea que
es información sobre las personas que trabajan aquí. Un operario no tiene por qué poder
mirar lo que hicieron sus compañeros.

── EL AISLAMIENTO ES DE RLS, NO DE ESTE ARCHIVO ─────────────────────────────

`audit.entries` tiene una política RESTRICTIVE que exige
`tenant_id = core.current_tenant_id()` o ser dueño de la plataforma. Un administrador
del tenant A no ve las entradas del tenant B, y no porque aquí se filtre.

Las entradas SIN tenant —las de las migraciones y las herramientas— solo las ve el dueño
de la plataforma. Es coherente: no son eventos de ningún tenant.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query

from olo.api.deps import CurrentContext, Db, require
from olo.api.v1.audit_schemas import AuditEntryOut, AuditLogOut
from olo.api.v1.schemas import Envelope
from olo.services.audit import AuditService

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get(
    "/log",
    response_model=Envelope[AuditLogOut],
    dependencies=[require("audit:read")],
    summary="El registro de cambios, lo mas reciente primero",
)
async def log(
    db: Db,
    ctx: CurrentContext,
    table: Annotated[str | None, Query(description="Acota a `esquema.tabla`")] = None,
    operation: Annotated[Literal["INSERT", "UPDATE", "DELETE"] | None, Query()] = None,
    actor: Annotated[UUID | None, Query(description="Quien lo hizo")] = None,
    since: Annotated[str | None, Query(description="Desde, inclusive (ISO-8601)")] = None,
    until: Annotated[str | None, Query(description="Hasta, exclusive (ISO-8601)")] = None,
    include_tests: Annotated[
        bool,
        Query(description="Incluir las escrituras de la suite de tests"),
    ] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Envelope[AuditLogOut]:
    """La página, el total, el resumen por tabla, los actores y qué se vigila.

    Todo en UNA respuesta. Cuatro peticiones serían cuatro viajes al pooler —~260 ms
    cada uno— para pintar una pantalla, y tres de las cuatro no cambian al pasar de
    página.

    Las escrituras de la **suite de tests** quedan fuera por defecto: corre contra esta
    misma base y deja ~150 entradas por ejecución. No se pierden — `test_total` dice
    cuántas son y `include_tests=true` las trae. Un filtro que quita filas sin contarlas
    es lo mismo que perderlas.

    `until` es EXCLUSIVO. Con los dos extremos inclusivos, filtrar «el día 5» y luego
    «el día 6» contaría dos veces todo lo ocurrido a las 00:00:00 del 6.
    """
    datos = await AuditService(db, ctx).registro(
        pagina=page,
        por_pagina=page_size,
        tabla=table,
        operacion=operation,
        actor=actor,
        desde=since,
        hasta=until,
        pruebas=include_tests,
    )
    return Envelope[AuditLogOut](data=AuditLogOut.model_validate(datos))


@router.get(
    "/history/{schema_name}/{table_name}/{row_id}",
    response_model=Envelope[list[AuditEntryOut]],
    dependencies=[require("audit:read")],
    summary="Todo lo que le ha pasado a una fila",
)
async def history(
    schema_name: str, table_name: str, row_id: str, db: Db, ctx: CurrentContext
) -> Envelope[list[AuditEntryOut]]:
    """En orden ASCENDENTE, al contrario que el registro general.

    Aquí se lee como una historia —«se creó, luego le cambiaron esto, luego se borró»— y
    una historia al revés no se entiende.

    Devuelve **200 con lista vacía**, no 404, cuando no hay entradas: «esta fila no tiene
    historia» es una respuesta legítima —se creó antes de que existiera el registro, o su
    tabla no se audita— y un 404 haría pensar que la fila no existe.

    Funciona con filas ya BORRADAS. Es medio sentido de que el registro exista: sobrevive
    a lo que registra.
    """
    filas = await AuditService(db, ctx).historia(schema_name, table_name, row_id)
    return Envelope[list[AuditEntryOut]](
        data=[AuditEntryOut.model_validate(f) for f in filas]
    )
