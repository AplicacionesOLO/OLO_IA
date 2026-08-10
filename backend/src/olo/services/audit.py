"""Auditoría: quién cambió qué, y cuándo.

═══════════════════════════════════════════════════════════════════════════════
UN SERVICIO SIN NI UNA ESCRITURA

No hay método de creación, edición ni borrado, y no es una omisión: `olo_app` no tiene
privilegio de INSERT sobre `audit.entries` (0085). El registro lo escriben los triggers
del motor, con SECURITY DEFINER, así que la aplicación no puede reescribir su propio
rastro ni por error.

═══════════════════════════════════════════════════════════════════════════════
LO QUE NO SE ENSEÑA, SE CUENTA

`vigiladas()` sale de `pg_trigger`, y va en la misma respuesta que el registro. La razón
es que **el silencio de un registro de auditoría se lee como «no pasó nada»**, y aquí hay
cosas que deliberadamente no se auditan: las 41.055 filas de stock de cada importación,
las 29.312 ubicaciones del catálogo, las imágenes y anotaciones del dataset.

Sin esa lista, alguien mira un registro sin entradas de inventario y concluye que nadie
ha importado nada — cuando lo que pasa es que una importación es UNA decisión, ya
registrada en `inventory.wms_snapshots`, y auditarla fila a fila enterraría los cambios
que sí importan bajo 41.055 entradas idénticas.

El mismo criterio vale para las escrituras de la suite de tests, que corre contra esta
misma base y deja **~150 entradas por ejecución** (medido). Se dejan fuera por defecto y
`test_total` dice cuántas son, con `pruebas=True` para verlas. Un filtro que quita filas
sin contarlas es lo mismo que perderlas.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from olo.repositories.audit import AuditRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from olo.core.context import TenantContext

#: Techo por página. El registro crece sin límite: sin techo, una petición sin
#: `page_size` acabaría trayéndolo entero por el pooler.
MAX_POR_PAGINA = 200


class AuditService:
    def __init__(self, session: AsyncSession, ctx: TenantContext) -> None:
        self._repo = AuditRepository(session)
        self._ctx = ctx

    async def registro(
        self,
        *,
        pagina: int = 1,
        por_pagina: int = 50,
        tabla: str | None = None,
        operacion: str | None = None,
        actor: UUID | None = None,
        desde: str | None = None,
        hasta: str | None = None,
        pruebas: bool = False,
    ) -> dict[str, Any]:
        """Una página del registro con todo lo que hace falta para entenderla.

        Se devuelve junto: la página, el total filtrado, el resumen por tabla y las
        tablas vigiladas. Cuatro peticiones separadas serían cuatro viajes al pooler
        —~260 ms cada uno— para pintar una pantalla, y las tres últimas no cambian entre
        páginas.
        """
        por_pagina = max(1, min(por_pagina, MAX_POR_PAGINA))
        pagina = max(1, pagina)
        filtro = {
            "tabla": tabla,
            "operacion": operacion,
            "actor": actor,
            "desde": desde,
            "hasta": hasta,
            "pruebas": pruebas,
        }

        total = await self._repo.total(**filtro)
        filas = await self._repo.entries(
            limite=por_pagina, desplazamiento=(pagina - 1) * por_pagina, **filtro
        )
        return {
            "entries": [_presentar(f) for f in filas],
            "total": total,
            "page": pagina,
            "page_size": por_pagina,
            "pages": max(1, -(-total // por_pagina)),
            "summary": await self._repo.resumen(pruebas=pruebas),
            "actors": [
                _presentar_actor(a) for a in await self._repo.actores(pruebas=pruebas)
            ],
            "watched": await self._repo.vigiladas(),
            # Cuántas se están dejando fuera. Va SIEMPRE, incluso con `pruebas=True`,
            # para que la interfaz pueda decir «además hay N de la suite de tests» en vez
            # de que desaparezcan sin dejar constancia.
            "test_total": await self._repo.total_pruebas(),
            "including_tests": pruebas,
        }

    async def historia(self, schema: str, tabla: str, row_id: str) -> list[dict[str, Any]]:
        """La vida entera de una fila, de lo más antiguo a lo más nuevo.

        No hay 404 cuando no hay entradas: «esta fila no tiene historia» es una
        respuesta legítima —se creó antes de que existiera el registro, o su tabla no se
        audita— y no un error. Devolver 404 haría pensar que la fila no existe.
        """
        return [_presentar(f) for f in await self._repo.historia_de_fila(schema, tabla, row_id)]


def _presentar(fila: dict[str, Any]) -> dict[str, Any]:
    """Añade el nombre del actor y el diff ya resuelto.

    ── EL DIFF SE CALCULA AQUI, NO EN EL NAVEGADOR ───────────────────────────────

    `changed` dice QUÉ columnas cambiaron; esto añade de qué a qué. Hacerlo en el
    cliente obligaría a mandar dos objetos completos por entrada y a recorrerlos por
    cada fila pintada, y el registro se lee de 50 en 50.
    """
    antes = fila.get("before") or {}
    despues = fila.get("after") or {}
    cambios = sorted(fila.get("changed") or [], key=_orden_de_campo)
    return {
        **_sin_partes_del_nombre(fila),
        "actor_name": _nombre(fila),
        "diff": [
            {"field": c, "from": antes.get(c), "to": despues.get(c)}
            for c in cambios
        ],
    }


#: Columnas de contabilidad. Cambian en casi todas las escrituras y no son lo que nadie
#: fue a mirar.
_CONTABILIDAD = ("updated_at", "updated_by", "version", "created_at", "created_by")


def _orden_de_campo(campo: str) -> tuple[int, str]:
    """La contabilidad va AL FINAL, el resto por orden alfabético.

    No se esconde —un registro de auditoría que oculta campos es peor que uno
    farragoso—, pero se aparta. El motivo es la línea colapsada de la interfaz, que
    resume el diff con los tres primeros campos: en orden alfabético, un cambio de
    estado quedaba resumido como «resolution, resolved_at, resolved_by +3» y, en otras
    tablas, directamente como «updated_at, updated_by, version», que es exactamente la
    parte que no dice nada.
    """
    return (1 if campo in _CONTABILIDAD else 0, campo)


def _presentar_actor(fila: dict[str, Any]) -> dict[str, Any]:
    return {**_sin_partes_del_nombre(fila), "actor_name": _nombre(fila)}


#: Columnas del JOIN a `core.users` que existen para COMPONER el nombre y no forman
#: parte del contrato. Dejarlas pasar las convertiría en API pública por accidente:
#: `extra="forbid"` las rechaza, y menos mal — es lo que las cazó.
_PARTES = ("actor_first_name", "actor_last_name", "first_name", "last_name")


def _sin_partes_del_nombre(fila: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in fila.items() if k not in _PARTES}


def _nombre(fila: dict[str, Any]) -> str | None:
    """El nombre de quien lo hizo, o None si no fue una persona.

    Devuelve None —no «Sistema» ni «Desconocido»— cuando no hay usuario: quien decide
    cómo llamar a eso es la interfaz, que es la que sabe si está pintando una tabla o
    una frase. Y el `db_role` viaja aparte para que pueda distinguir «lo hizo una
    migración» de «lo hizo alguien y no puedo ver quién».
    """
    nombre = " ".join(
        p for p in (fila.get("actor_first_name"), fila.get("actor_last_name")) if p
    ).strip()
    return nombre or fila.get("actor_email") or None
