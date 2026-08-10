"""Lectura del registro de auditoría.

── SOLO LECTURA, Y NO POR CONVENCIÓN ─────────────────────────────────────────────

Este repositorio no tiene ni un método de escritura, y no es una decisión de estilo:
`olo_app` **no tiene privilegio de INSERT** sobre `audit.entries` (migración 0085). Un
método que intentara escribir fallaría en el motor.

Quien escribe es el trigger `audit.registrar()`, que es SECURITY DEFINER. Así, la única
forma de que un cambio no deje rastro es tener permiso para desactivar el trigger — que
es exactamente el privilegio que se quiere vigilar.

── EL FILTRO VA AL MOTOR ─────────────────────────────────────────────────────────

Igual que en los descuadres del inventario: filtrar en memoria sobre una página ya
descargada da resultados vacíos para filtros que el recuento dice tener cientos. Aquí
sería peor, porque el registro crece sin techo.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID  # noqa: TC003

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class AuditRepository:
    """Consultas sobre `audit.entries`. RLS decide qué filas se ven."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def entries(
        self,
        *,
        limite: int = 50,
        desplazamiento: int = 0,
        tabla: str | None = None,
        operacion: str | None = None,
        actor: UUID | None = None,
        desde: str | None = None,
        hasta: str | None = None,
        pruebas: bool = False,
    ) -> list[dict[str, Any]]:
        """Una página del registro, lo más reciente primero.

        `pruebas=False` deja fuera las escrituras de la suite de tests, que corre contra
        esta misma base y deja ~150 entradas por ejecución. No las borra ni las esconde:
        `total_pruebas()` las cuenta y la interfaz lo dice con un interruptor para
        verlas.

        El orden es `occurred_at DESC, id DESC`. El segundo criterio no es decorativo:
        dos entradas del mismo milisegundo —un INSERT y su UPDATE en la misma
        transacción— saldrían en orden arbitrario, y en un registro de auditoría el
        orden ES el dato.

        El nombre del actor se resuelve con LEFT JOIN a `core.users`, cuyas políticas se
        aplican igual: si la persona no es visible para quien consulta, el nombre viene
        vacío y el `actor_user_id` sigue estando. Preferible a esconder la entrada.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT e.id, e.occurred_at, e.schema_name, e.table_name, "
                    "       e.row_id, e.operation, e.actor_user_id, e.db_role, "
                    "       e.changed, e.before, e.after, e.is_test, "
                    "       u.email       AS actor_email, "
                    "       u.first_name  AS actor_first_name, "
                    "       u.last_name   AS actor_last_name "
                    "  FROM audit.entries e "
                    "  LEFT JOIN core.users u ON u.id = e.actor_user_id "
                    " WHERE (CAST(:tabla AS text) IS NULL "
                    "        OR e.schema_name || '.' || e.table_name "
                    "           = CAST(:tabla AS text)) "
                    "   AND (CAST(:op AS text) IS NULL "
                    "        OR e.operation = CAST(:op AS text)) "
                    "   AND (CAST(:actor AS uuid) IS NULL "
                    "        OR e.actor_user_id = CAST(:actor AS uuid)) "
                    "   AND (CAST(:desde AS timestamptz) IS NULL "
                    "        OR e.occurred_at >= CAST(:desde AS timestamptz)) "
                    "   AND (CAST(:hasta AS timestamptz) IS NULL "
                    "        OR e.occurred_at < CAST(:hasta AS timestamptz)) "
                    "   AND (CAST(:pruebas AS boolean) OR NOT e.is_test) "
                    " ORDER BY e.occurred_at DESC, e.id DESC "
                    " LIMIT :lim OFFSET :off"
                ),
                {
                    "lim": limite,
                    "off": desplazamiento,
                    "tabla": tabla,
                    "op": operacion,
                    "actor": str(actor) if actor else None,
                    "desde": desde,
                    "hasta": hasta,
                    "pruebas": pruebas,
                },
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def total(
        self,
        *,
        tabla: str | None = None,
        operacion: str | None = None,
        actor: UUID | None = None,
        desde: str | None = None,
        hasta: str | None = None,
        pruebas: bool = False,
    ) -> int:
        """Cuántas entradas pasan el filtro. Hace falta para paginar de verdad.

        Contar la página daría el tamaño de la página, que es el error que la
        paginación del inventario ya tuvo que corregir.
        """
        fila = (
            await self._session.execute(
                text(
                    "SELECT count(*) AS n FROM audit.entries e "
                    " WHERE (CAST(:tabla AS text) IS NULL "
                    "        OR e.schema_name || '.' || e.table_name "
                    "           = CAST(:tabla AS text)) "
                    "   AND (CAST(:op AS text) IS NULL "
                    "        OR e.operation = CAST(:op AS text)) "
                    "   AND (CAST(:actor AS uuid) IS NULL "
                    "        OR e.actor_user_id = CAST(:actor AS uuid)) "
                    "   AND (CAST(:desde AS timestamptz) IS NULL "
                    "        OR e.occurred_at >= CAST(:desde AS timestamptz)) "
                    "   AND (CAST(:hasta AS timestamptz) IS NULL "
                    "        OR e.occurred_at < CAST(:hasta AS timestamptz)) "
                    "   AND (CAST(:pruebas AS boolean) OR NOT e.is_test)"
                ),
                {
                    "tabla": tabla,
                    "op": operacion,
                    "actor": str(actor) if actor else None,
                    "desde": desde,
                    "hasta": hasta,
                    "pruebas": pruebas,
                },
            )
        ).mappings().one()
        return int(fila["n"])

    async def historia_de_fila(
        self, schema: str, tabla: str, row_id: str, limite: int = 100
    ) -> list[dict[str, Any]]:
        """Todo lo que le ha pasado a UNA fila, de lo más antiguo a lo más nuevo.

        En orden ASCENDENTE, al contrario que el registro general: aquí se lee como una
        historia —«se creó, luego se le cambió esto, luego se borró»— y una historia al
        revés no se entiende.

        Funciona con filas BORRADAS: el registro sobrevive a lo que registra, y es medio
        sentido de que exista.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT e.id, e.occurred_at, e.schema_name, e.table_name, "
                    "       e.row_id, e.operation, e.actor_user_id, e.db_role, "
                    "       e.changed, e.before, e.after, e.is_test, "
                    "       u.email       AS actor_email, "
                    "       u.first_name  AS actor_first_name, "
                    "       u.last_name   AS actor_last_name "
                    "  FROM audit.entries e "
                    "  LEFT JOIN core.users u ON u.id = e.actor_user_id "
                    " WHERE e.schema_name = :esq AND e.table_name = :tab "
                    "   AND e.row_id = :fila "
                    " ORDER BY e.occurred_at, e.id "
                    " LIMIT :lim"
                ),
                {"esq": schema, "tab": tabla, "fila": row_id, "lim": limite},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def resumen(self, *, pruebas: bool = False) -> list[dict[str, Any]]:
        """Cuántas entradas por tabla y operación, para las pestañas de filtro.

        Sobre el TOTAL visible, no sobre la página: es lo que permite pintar «12
        cambios de permisos» en un filtro mientras se está viendo otro.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT schema_name || '.' || table_name AS tabla, "
                    "       operation, count(*) AS n, max(occurred_at) AS ultima "
                    "  FROM audit.entries "
                    " WHERE CAST(:pruebas AS boolean) OR NOT is_test "
                    " GROUP BY 1, 2 ORDER BY 3 DESC"
                ),
                {"pruebas": pruebas},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def actores(self, *, pruebas: bool = False) -> list[dict[str, Any]]:
        """Quién ha dejado rastro, con cuántas entradas.

        Incluye las entradas SIN actor —`actor_user_id` nulo— agrupadas por su rol del
        motor. Son las de las migraciones y las herramientas, y esconderlas daría la
        impresión de que todo cambio del sistema tiene una persona detrás.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT e.actor_user_id, e.db_role, count(*) AS n, "
                    "       max(e.occurred_at) AS ultima, "
                    "       u.email, u.first_name, u.last_name "
                    "  FROM audit.entries e "
                    "  LEFT JOIN core.users u ON u.id = e.actor_user_id "
                    " WHERE CAST(:pruebas AS boolean) OR NOT e.is_test "
                    " GROUP BY e.actor_user_id, e.db_role, u.email, u.first_name, "
                    "          u.last_name "
                    " ORDER BY count(*) DESC"
                ),
                {"pruebas": pruebas},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def vigiladas(self) -> list[dict[str, Any]]:
        """Qué tablas tienen el trigger puesto.

        ── POR QUE ESTO SE ENSENA EN PANTALLA ────────────────────────────────────

        El silencio de un registro de auditoría se lee como «no pasó nada». Y aquí hay
        cosas que deliberadamente NO se auditan —41.055 filas de stock por importación,
        29.312 ubicaciones—, así que sin esta lista alguien mira un registro sin
        entradas de inventario y concluye que nadie ha importado nada.

        Sale de `pg_trigger`, no de una constante en el código: si el trigger se cae o
        alguien lo desactiva, la pantalla lo dice en vez de seguir prometiendo cobertura.
        """
        filas = (
            await self._session.execute(
                text(
                    "SELECT n.nspname AS schema_name, c.relname AS table_name, "
                    "       t.tgenabled <> 'D' AS activo "
                    "  FROM pg_trigger t "
                    "  JOIN pg_class c ON c.oid = t.tgrelid "
                    "  JOIN pg_namespace n ON n.oid = c.relnamespace "
                    " WHERE t.tgname = 'trg_auditar' AND NOT t.tgisinternal "
                    " ORDER BY 1, 2"
                )
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def total_pruebas(self) -> int:
        """Cuántas entradas de la suite de tests hay.

        Existe para poder DECIRLO. Un filtro por defecto que quita filas sin contarlas
        es lo mismo que perderlas: quien mira el registro no tiene forma de saber que
        había algo más. Mismo criterio que la lista de tablas no auditadas.
        """
        fila = (
            await self._session.execute(
                text("SELECT count(*) AS n FROM audit.entries WHERE is_test")
            )
        ).mappings().one()
        return int(fila["n"])
