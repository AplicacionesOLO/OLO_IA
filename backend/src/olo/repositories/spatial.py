"""Repositorio del dominio espacial.

Lee de los modelos de lectura de las migraciones 0057 y 0059, no de las tablas:
las vistas ya resuelven el árbol, las etiquetas y los agregados, y llevan
`security_invoker = true`, así que la RLS del invocante sigue en vigor.

Como el resto de repositorios, NO añade `WHERE tenant_id = ...`. Lo hace RLS. El
único filtro de esta capa es `deleted_at IS NULL`, que es negocio.

Ninguna consulta de aquí devuelve las 29.310 ubicaciones de golpe: o agrega, o
pagina. Un endpoint que pueda devolver el catálogo entero es un endpoint que
alguien llamará sin `limit`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

#  `UUID` en tiempo de EJECUCION: `guardar_medidas` lo CONSTRUYE con lo que devuelve la
#  base, no solo lo anota. Dejarlo en `TYPE_CHECKING` daria `NameError` al guardar.
from uuid import UUID

from sqlalchemy import text

from olo.domain.inspeccion import ESTADOS_QUE_DISCREPAN

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.sql.elements import TextClause


# Columnas de `spatial.locations_resolved` que expone la API. Se enumeran en
# lugar de usar `SELECT *` para que añadir una columna a la vista no la publique
# sin decidirlo.
_LOC_SELECT = (
    "SELECT location_id, warehouse_id, warehouse_code, site_id, site_code, "
    "       aisle_id, aisle_code, rack_id, rack_code, rack_external_code, rack_index, "
    "       bay_id, bay_code, bay_index, level, position, full_code, external_code, "
    "       external_location_id, code_form, location_type, location_status, "
    "       location_situation, is_bulk_area, origin, max_weight_kg, max_units, "
    "       node_function, function_label, implies_bulk, logical_x, logical_y, logical_z "
    "  FROM spatial.locations_resolved "
)

# Orden total y estable. `full_code` es único por almacén, y `location_id`
# desempata: sin un orden determinista la paginación por cursor repite o se salta
# filas, y el defecto solo aparece cuando dos filas empatan.
_LOC_ORDER = "full_code ASC, location_id ASC"


def _armar(select_sql: str, clauses: list[str], suffix: str) -> TextClause:
    """Compone una sentencia con su `WHERE` variable.

    Es el único sitio donde se interpola una CLÁUSULA. Lo que se interpola son los
    `clauses`, que salen siempre de literales escritos aquí arriba —nunca de entrada
    del cliente—; los valores viajan como parámetros enlazados. Tener un solo punto de
    interpolación convierte «¿está esto parametrizado?» en una pregunta que se responde
    leyendo cinco líneas en lugar de auditando seis consultas.

    Hay dos consultas más con `noqa: S608`, y no rompen esa idea: concatenan
    `_ORDEN_R` / `_ORDEN_V`, que son constantes de este módulo resueltas al importar.
    Existen para que la regla de «qué lectura gana» esté escrita UNA vez — estaba
    escrita tres, con tres criterios distintos, y las tres pantallas que la usan se
    contradecían.
    """
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return text(f"{select_sql} {where} {suffix}")


#: QUE LECTURA GANA CUANDO UN HUECO TIENE VARIAS.
#:
#: Estaba escrita tres veces con tres reglas distintas, y las tres pantallas que la usan se
#: contradecian: el mapa daba `unexpected_pallet` en `RCL47-C018-N01-2` y el recuento de
#: cobertura decia CERO discrepancias en ese mismo rack, porque una ordenaba por informacion
#: y la otra por hora a secas.
#:
#: Dos escalones, y el orden importa:
#:
#:   1. el RECORRIDO mas reciente. Un vuelo nuevo manda sobre uno viejo, siempre.
#:   2. dentro de el, la lectura que MAS dice: la que identifico el pallet antes que la que
#:      solo vio un bulto, y esa antes que la que no se pronuncio.
#:
#: Al reves, un «vi el pallet X» de hace un mes taparia un «esto esta vacio» de hoy.
#:
#: `{r}` es el alias de `v_reconciliation` y `{s}` el de `inventory.scans`. Las dos variantes
#: se resuelven AQUI, al importar el modulo, y no dentro de las consultas: asi lo que se
#: concatena en cada `text(...)` es una constante y no una expresion, que es la unica forma de
#: tener la regla escrita una vez sin construir SQL sobre la marcha.
_PLANTILLA_ORDEN = (
    "{s}.started_at DESC NULLS LAST, "
    "({r}.pallet_qr = 'read') DESC, "
    "({r}.content <> 'unknown') DESC, "
    "{r}.observed_at DESC"
)

#: Con `r` = `v_reconciliation`, `s` = `scans`.
_ORDEN_R = _PLANTILLA_ORDEN.format(r="r", s="s")

#: Con `v` = `v_reconciliation`, `s` = `scans`.
_ORDEN_V = _PLANTILLA_ORDEN.format(r="v", s="s")


class SpatialRepository:
    """Solo lectura. El catálogo espacial se escribe por importador, no por API.

    No hereda de `BaseRepository` porque este repositorio no tiene una tabla
    única: consulta cuatro vistas y dos tablas. Heredar obligaría a elegir una
    `table` arbitraria y a arrastrar métodos de escritura que aquí no existen.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── Resumen ───────────────────────────────────────────────────────────
    async def summaries(self) -> list[dict[str, Any]]:
        """Un KPI por almacén accesible. Como máximo decenas de filas."""
        stmt = text(
            "SELECT warehouse_id, warehouse_code, warehouse_name, site_count, "
            "       aisle_count, rack_count, bay_count, location_count, "
            "       available_count, blocked_count, inferred_count, opaque_count, "
            "       wms_situation_counts, status_situation_conflicts, "
            "       capacity_unlimited_count, capacity_unknown_count, "
            "       with_world_geometry, last_import_at, total_rows_rejected "
            "  FROM spatial.warehouse_summary "
            " ORDER BY warehouse_code"
        )
        filas = (await self._session.execute(stmt)).mappings().all()
        return [dict(f) for f in filas]

    async def summary(self, warehouse_id: UUID) -> dict[str, Any] | None:
        stmt = text(
            "SELECT warehouse_id, warehouse_code, warehouse_name, site_count, "
            "       aisle_count, rack_count, bay_count, location_count, "
            "       available_count, blocked_count, inferred_count, opaque_count, "
            "       wms_situation_counts, status_situation_conflicts, "
            "       capacity_unlimited_count, capacity_unknown_count, "
            "       with_world_geometry, last_import_at, total_rows_rejected "
            "  FROM spatial.warehouse_summary WHERE warehouse_id = :wid"
        )
        fila = (await self._session.execute(stmt, {"wid": str(warehouse_id)})).mappings().first()
        return dict(fila) if fila else None

    # ── Árbol ─────────────────────────────────────────────────────────────
    async def tree(
        self, warehouse_id: UUID, *, max_depth: int, parent_id: UUID | None
    ) -> list[dict[str, Any]]:
        """Subárbol por recorrido recursivo, con la profundidad ya calculada.

        `max_depth` no es una comodidad: sin él, pedir el árbol de este almacén
        devolvería 3.048 nodos, y con `bay` a profundidad 2 eso son 2.701 filas
        que el cliente casi nunca necesita para dibujar el primer nivel.

        El límite duro de 64 saltos replica el del guardián
        `core.spatial_node_guard()`: si una migración futura introdujera un
        ciclo, esta consulta pararía en lugar de colgarse.
        """
        stmt = text(
            """
            WITH RECURSIVE arbol AS (
                SELECT n.id, n.parent_node_id, n.node_type, n.node_function,
                       n.node_code, n.external_code, n.name, n.logical_index,
                       n.site_id, 0 AS depth
                  FROM spatial.nodes n
                 WHERE n.warehouse_id = :wid
                   AND n.deleted_at IS NULL
                   -- ⚠ El CAST va en TODAS las apariciones de :parent_id, no solo
                   --   en la comparación. Sin él, PostgreSQL no puede inferir el
                   --   tipo de un parámetro que solo aparece en `IS NULL` y falla
                   --   con `could not determine data type of parameter $2`. Con el
                   --   CAST, la segunda rama basta: si el parámetro es NULL,
                   --   `n.id = NULL` da NULL y decide la primera.
                   AND ((CAST(:parent_id AS uuid) IS NULL AND n.parent_node_id IS NULL)
                     OR n.id = CAST(:parent_id AS uuid))
                UNION ALL
                SELECT h.id, h.parent_node_id, h.node_type, h.node_function,
                       h.node_code, h.external_code, h.name, h.logical_index,
                       h.site_id, a.depth + 1
                  FROM spatial.nodes h
                  JOIN arbol a ON a.id = h.parent_node_id
                 WHERE h.warehouse_id = :wid
                   AND h.deleted_at IS NULL
                   AND a.depth < LEAST(:max_depth, 64)
            )
            SELECT a.id AS node_id, a.parent_node_id, a.node_type, a.node_function,
                   nf.display_name AS function_label, a.node_code, a.external_code,
                   a.name, a.logical_index, a.site_id, a.depth,
                   COALESCE(nt.can_hold_locations, false) AS can_hold_locations,
                   COALESCE(h.hijos, 0)      AS child_count,
                   COALESCE(u.ubicaciones, 0) AS location_count
              FROM arbol a
              LEFT JOIN spatial.node_types nt     ON nt.code = a.node_type
              LEFT JOIN spatial.node_functions nf ON nf.code = a.node_function
              LEFT JOIN (
                  SELECT parent_node_id, count(1) AS hijos
                    FROM spatial.nodes
                   WHERE warehouse_id = :wid AND deleted_at IS NULL
                     AND parent_node_id IS NOT NULL
                   GROUP BY 1
              ) h ON h.parent_node_id = a.id
              LEFT JOIN (
                  SELECT node_id, count(1) AS ubicaciones
                    FROM spatial.locations
                   WHERE warehouse_id = :wid AND deleted_at IS NULL
                   GROUP BY 1
              ) u ON u.node_id = a.id
             ORDER BY a.depth, a.node_code
            """
        )
        filas = (
            await self._session.execute(
                stmt,
                {
                    "wid": str(warehouse_id),
                    "max_depth": max_depth,
                    "parent_id": str(parent_id) if parent_id else None,
                },
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def node(self, node_id: UUID) -> dict[str, Any] | None:
        """Un nodo con sus recuentos. Los agregados van correlacionados porque
        aquí hay una sola fila: no hay N+1 que evitar."""
        stmt = text(
            """
            SELECT n.id AS node_id, n.parent_node_id, n.node_type, n.node_function,
                   nf.display_name AS function_label, n.node_code, n.external_code,
                   n.name, n.logical_index, n.site_id,
                   COALESCE(nt.can_hold_locations, false) AS can_hold_locations,
                   (SELECT count(1) FROM spatial.nodes c
                     WHERE c.parent_node_id = n.id AND c.deleted_at IS NULL) AS child_count,
                   (SELECT count(1) FROM spatial.locations l
                     WHERE l.node_id = n.id AND l.deleted_at IS NULL)        AS location_count
              FROM spatial.nodes n
              LEFT JOIN spatial.node_types nt     ON nt.code = n.node_type
              LEFT JOIN spatial.node_functions nf ON nf.code = n.node_function
             WHERE n.id = :nid AND n.deleted_at IS NULL
            """
        )
        fila = (await self._session.execute(stmt, {"nid": str(node_id)})).mappings().first()
        return dict(fila) if fila else None

    async def children(
        self, node_id: UUID, *, limit: int, cursor_code: str | None
    ) -> list[dict[str, Any]]:
        """Hijos directos, paginados por `node_code`.

        Un rack con 60 cuerpos no necesita paginación, pero el endpoint no puede
        asumir la forma de los datos de un tenant que aún no existe.
        """
        clauses = ["n.parent_node_id = :nid", "n.deleted_at IS NULL"]
        params: dict[str, Any] = {"nid": str(node_id), "limit": limit}
        if cursor_code is not None:
            clauses.append("n.node_code > :cursor_code")
            params["cursor_code"] = cursor_code

        stmt = _armar(
            "SELECT n.id AS node_id, n.parent_node_id, n.node_type, n.node_function, "
            "       nf.display_name AS function_label, n.node_code, n.external_code, "
            "       n.name, n.logical_index, n.site_id, "
            "       COALESCE(nt.can_hold_locations, false) AS can_hold_locations, "
            "       (SELECT count(1) FROM spatial.nodes c "
            "         WHERE c.parent_node_id = n.id AND c.deleted_at IS NULL) AS child_count, "
            "       (SELECT count(1) FROM spatial.locations l "
            "         WHERE l.node_id = n.id AND l.deleted_at IS NULL)        AS location_count "
            "  FROM spatial.nodes n "
            "  LEFT JOIN spatial.node_types nt     ON nt.code = n.node_type "
            "  LEFT JOIN spatial.node_functions nf ON nf.code = n.node_function ",
            clauses,
            "ORDER BY n.node_code ASC LIMIT :limit",
        )
        filas = (await self._session.execute(stmt, params)).mappings().all()
        return [dict(f) for f in filas]

    async def count_children(self, node_id: UUID) -> int:
        stmt = text(
            "SELECT count(1) FROM spatial.nodes "
            "WHERE parent_node_id = :nid AND deleted_at IS NULL"
        )
        return int((await self._session.execute(stmt, {"nid": str(node_id)})).scalar_one())

    # ── Plano de planta ───────────────────────────────────────────────────
    async def floor_plan(
        self,
        warehouse_id: UUID,
        *,
        limit: int,
        cursor_code: str | None,
        node_function: str | None,
        search: str | None,
    ) -> list[dict[str, Any]]:
        clauses = ["warehouse_id = :wid"]
        params: dict[str, Any] = {"wid": str(warehouse_id), "limit": limit}
        if cursor_code is not None:
            clauses.append("rack_code > :cursor_code")
            params["cursor_code"] = cursor_code
        if node_function:
            clauses.append("node_function = :node_function")
            params["node_function"] = node_function
        if search:
            clauses.append("(rack_code LIKE :prefix OR rack_external_code LIKE :prefix)")
            params["prefix"] = f"{search.upper()}%"

        stmt = _armar(
            "SELECT rack_id, rack_code, rack_external_code, rack_index, rack_node_type, "
            "       node_function, function_label, aisle_id, aisle_code, site_id, "
            "       bay_count, location_count, available_count, blocked_count, "
            "       inferred_count, bulk_count, wms_situation_counts, "
            "       status_situation_conflicts, min_logical_x, max_logical_x, "
            "       min_logical_y, max_logical_y, max_level "
            "  FROM spatial.floor_plan ",
            clauses,
            "ORDER BY rack_code ASC LIMIT :limit",
        )
        filas = (await self._session.execute(stmt, params)).mappings().all()
        return [dict(f) for f in filas]

    async def count_floor_plan(self, warehouse_id: UUID) -> int:
        stmt = text(
            "SELECT count(1) FROM spatial.nodes WHERE warehouse_id = :wid "
            "AND deleted_at IS NULL AND node_type IN ('rack', 'storage_area')"
        )
        return int((await self._session.execute(stmt, {"wid": str(warehouse_id)})).scalar_one())

    # ── Alzado de un rack ─────────────────────────────────────────────────
    async def rack_front_view(self, rack_id: UUID) -> list[dict[str, Any]]:
        """Todas las celdas del alzado de UN rack.

        Sin paginar a propósito: el rack más poblado del catálogo real tiene 486
        huecos (54 cuerpos x 9), y una vista frontal partida en páginas no es una
        vista frontal. El límite lo pone la forma del dato, no un `LIMIT`.
        """
        stmt = text(
            "SELECT location_id, bay_id, bay_code, bay_index, level, position, "
            "       full_code, external_code, location_status, location_situation, "
            "       is_bulk_area, origin, max_weight_kg, max_units "
            "  FROM spatial.rack_front_view WHERE rack_id = :rid "
            " ORDER BY bay_index, level, position"
        )
        filas = (await self._session.execute(stmt, {"rid": str(rack_id)})).mappings().all()
        return [dict(f) for f in filas]

    # ── Ubicaciones ───────────────────────────────────────────────────────
    async def locations(
        self,
        *,
        limit: int,
        cursor_code: str | None,
        cursor_id: UUID | None,
        offset: int | None,
        warehouse_id: UUID | None,
        rack_id: UUID | None,
        bay_id: UUID | None,
        status: str | None,
        situation: str | None,
        code_form: str | None,
        level: int | None,
        search: str | None,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: dict[str, Any] = {"limit": limit}

        if cursor_code is not None and cursor_id is not None:
            clauses.append("(full_code, location_id) > (:cursor_code, :cursor_id)")
            params["cursor_code"] = cursor_code
            params["cursor_id"] = str(cursor_id)
        if warehouse_id is not None:
            clauses.append("warehouse_id = :wid")
            params["wid"] = str(warehouse_id)
        if rack_id is not None:
            clauses.append("rack_id = :rack_id")
            params["rack_id"] = str(rack_id)
        if bay_id is not None:
            clauses.append("bay_id = :bay_id")
            params["bay_id"] = str(bay_id)
        if status:
            clauses.append("location_status = :status")
            params["status"] = status
        if situation:
            clauses.append("location_situation = :situation")
            params["situation"] = situation
        if code_form:
            clauses.append("code_form = :code_form")
            params["code_form"] = code_form
        if level is not None:
            clauses.append("level = :level")
            params["level"] = level
        if search:
            # Prefijo, no `%texto%`: con comodín por delante el índice sobre
            # `code` no se usa y la consulta pasa a recorrer las 29.310. Medido:
            # 22 ms por prefijo. Buscar «contiene» es una función distinta y
            # necesitaría un índice GIN con `pg_trgm`, que no está instalado.
            clauses.append("(full_code LIKE :prefix OR external_code LIKE :prefix "
                           "OR external_location_id LIKE :prefix)")
            params["prefix"] = f"{search.upper()}%"

        salto = ""
        if offset:
            salto = "OFFSET :offset "
            params["offset"] = offset

        stmt = _armar(
            _LOC_SELECT,
            clauses,
            f"ORDER BY {_LOC_ORDER} {salto}LIMIT :limit",
        )
        filas = (await self._session.execute(stmt, params)).mappings().all()
        return [dict(f) for f in filas]

    async def count_locations(
        self,
        *,
        warehouse_id: UUID | None,
        rack_id: UUID | None,
        bay_id: UUID | None,
        status: str | None,
        situation: str | None,
        code_form: str | None,
        level: int | None,
        search: str | None,
    ) -> int:
        """`count` exacto, solo cuando el cliente lo pide.

        Se cuenta sobre `spatial.locations` y no sobre la vista: la vista une
        cinco relaciones para resolver etiquetas que a un `count` no le sirven de
        nada. Medido: 6,7 ms contra la tabla frente a 165 ms contra la vista.
        Los filtros que dependen de la jerarquía se traducen a la columna
        equivalente de la tabla para que el resultado sea el mismo número.
        """
        clauses = ["l.deleted_at IS NULL"]
        params: dict[str, Any] = {}
        if warehouse_id is not None:
            clauses.append("l.warehouse_id = :wid")
            params["wid"] = str(warehouse_id)
        if bay_id is not None:
            clauses.append("l.node_id = :bay_id")
            params["bay_id"] = str(bay_id)
        if rack_id is not None:
            # `node_id` apunta al cuerpo; el rack es su padre. También se admite
            # que apunte al rack directamente, que es el caso de los nodos que
            # sostienen ubicaciones sin cuerpo intermedio.
            clauses.append(
                "(l.node_id = :rack_id OR l.node_id IN "
                " (SELECT b.id FROM spatial.nodes b WHERE b.parent_node_id = :rack_id "
                "   AND b.deleted_at IS NULL))"
            )
            params["rack_id"] = str(rack_id)
        if status:
            clauses.append("l.status = :status")
            params["status"] = status
        if situation:
            clauses.append("l.location_situation = :situation")
            params["situation"] = situation
        if code_form:
            clauses.append("l.code_form = :code_form")
            params["code_form"] = code_form
        if level is not None:
            clauses.append("l.logical_level = :level")
            params["level"] = level
        if search:
            clauses.append("(l.code LIKE :prefix OR l.external_code LIKE :prefix "
                           "OR l.external_location_id LIKE :prefix)")
            params["prefix"] = f"{search.upper()}%"

        stmt = _armar("SELECT count(1) FROM spatial.locations l ", clauses, "")
        return int((await self._session.execute(stmt, params)).scalar_one())

    async def location(self, location_id: UUID) -> dict[str, Any] | None:
        stmt = _armar(
            _LOC_SELECT,
            ["location_id = :lid"],
            "",
        )
        fila = (await self._session.execute(stmt, {"lid": str(location_id)})).mappings().first()
        return dict(fila) if fila else None

    async def location_extras(
        self, location_ids: Sequence[UUID]
    ) -> dict[UUID, dict[str, Any]]:
        """Los campos que `locations_resolved` no expone, resueltos EN LOTE.

        · `capacity_declared_unlimited` — se deduce de `raw_source`, que es el
          crudo del origen y NO contrato de API, así que la vista no lo expone.

        · `logical_column` — es un atributo de la UBICACIÓN. La vista expone
          `bay_index`, que es el índice del CUERPO padre. Hoy coinciden en las
          29.310 filas importadas (medido: 0 discrepancias) porque el importador
          usa el mismo valor para los dos, pero **no son el mismo campo**: una
          ubicación colgada directamente de un rack tiene `logical_column` y no
          tiene cuerpo, y las 2 opacas del seed tienen ambos NULL. Aliasar uno
          como el otro funcionaría hoy y mentiría el día que dejen de coincidir.

        · `world_x_m/y_m/z_m` — la posición métrica, descompuesta en tres números
          en SQL y no en el cliente. `world_position` es un `geometry(PointZ)` y
          por el cable viaja como WKB hexadecimal; devolverlo tal cual obligaría al
          navegador a traerse una librería de geometría para leer un punto. `ST_X`
          y compañía lo hacen aquí, que es donde ya está PostGIS.

        Una consulta por página, no una por fila: con `page_size=200` la
        diferencia son 200 viajes al pooler, y cada viaje son 260 ms medidos.
        """
        if not location_ids:
            return {}
        stmt = text(
            "SELECT id, (raw_source ? 'peso_max_crudo') AS ilimitada, "
            "       logical_column, "
            "       CASE WHEN world_position IS NULL THEN NULL "
            "            ELSE extensions.ST_X(world_position) END AS wx, "
            "       CASE WHEN world_position IS NULL THEN NULL "
            "            ELSE extensions.ST_Y(world_position) END AS wy, "
            "       CASE WHEN world_position IS NULL THEN NULL "
            "            ELSE extensions.ST_Z(world_position) END AS wz "
            "  FROM spatial.locations WHERE id = ANY(CAST(:ids AS uuid[]))"
        )
        rows = (
            await self._session.execute(stmt, {"ids": [str(i) for i in location_ids]})
        ).mappings().all()
        return {
            r["id"]: {
                "capacity_declared_unlimited": bool(r["ilimitada"]),
                "logical_column": r["logical_column"],
                "world_x_m": r["wx"],
                "world_y_m": r["wy"],
                "world_z_m": r["wz"],
            }
            for r in rows
        }

    # ══════════════════════════════════════════════════════════════════════
    # EL ESTADO OBSERVADO DE CADA HUECO (la capa «Inspección» del visor)
    #
    # El visor 3D tiene la capa dibujada desde 0067 y NUNCA tuvo datos: la página
    # pasaba `undefined` y el boton de la capa estaba deshabilitado con el texto
    # «Disponible al integrar las lecturas del dron». O sea, el mapa enseñaba el
    # catalogo y la ocupacion declarada, y lo que la camara habia VISTO no llegaba
    # nunca — que es justo lo que distingue este producto de un plano.
    #
    # Esto es ese puente. Va contra `inventory.v_reconciliation`, que ya compara lo
    # observado con el corte del WMS, y devuelve UNA fila por hueco.
    # ══════════════════════════════════════════════════════════════════════

    async def estado_observado(
        self, warehouse_id: UUID, rack_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Lo ultimo que se vio en cada hueco, frente a lo que el WMS declara.

        ── QUE LECTURA GANA CUANDO HAY VARIAS ────────────────────────────────────

        Un mismo hueco produce varias lecturas del mismo recorrido: la camara lo mira
        durante segundos y cada escena deja la suya. Medido en `dataset7`: siete lecturas
        de `RCL47-C018-N01-2`, y solo UNA identifico el pallet.

        Quedarse con la mas reciente a secas seria quedarse con la ultima escena de la
        pasada, que suele ser la peor —la camara ya se estaba yendo—. Y quedarse con la
        mas informativa a secas seria peor todavia: un «vi el pallet X» de hace un mes
        taparia un «esto esta vacio» de hoy.

        Asi que se ordena en dos escalones, y el orden importa:

          1. el RECORRIDO mas reciente. Un recorrido nuevo manda sobre uno viejo, siempre.
          2. dentro de el, la lectura que MAS dice: la que identifico el pallet antes que
             la que solo vio un bulto, y esa antes que la que no se pronuncio.

        Asi «lo ultimo que se sabe» es de verdad lo ultimo, y dentro de eso lo mejor visto.

        `location_id IS NULL` se queda fuera: son lecturas que no se pudieron atribuir a
        ningun hueco —o cuyo codigo no esta en el catalogo, `location_unknown` desde 0090—
        y esta capa se pinta POR hueco. Salen en la pantalla de reconciliacion, que es donde
        se pueden leer, no en un mapa donde no hay celda que colorear.
        """
        #  El filtro por rack va como PARAMETRO, no montando la sentencia con un `if`.
        #  Cuando se mira UN alzado no hace falta traerse el almacen entero —son 29.310
        #  huecos y el visor pinta unos cientos—, pero eso no justifica construir SQL a
        #  trozos: una sentencia sola se lee de una vez y no hay nada que concatenar.
        params: dict[str, Any] = {
            "wh": str(warehouse_id),
            "rack": None if rack_id is None else str(rack_id),
        }

        stmt = text(
            #  Los nombres del contrato se ponen AQUI, no en el servicio: la vista habla en
            #  `pallet_code_observed` y la capa del visor en `observed_pallet_code`, y
            #  traducir a mano fila por fila es la clase de costura que se olvida de
            #  actualizar cuando se anade un campo.
            #  `noqa` con motivo: lo unico que se concatena es `_ORDEN_R`, una constante de
            #  este modulo resuelta al importar. Ni un valor del cliente entra en el SQL.
            "SELECT DISTINCT ON (r.location_id) "  # noqa: S608
            "       r.location_id, r.location_code, "
            "       r.pallet_code_observed AS observed_pallet_code, "
            "       COALESCE(r.expected_pallets, '{}') AS expected_pallets, "
            "       r.status, r.content, "
            "       r.content_confidence AS confidence, "
            "       r.observed_at, r.scan_id, "
            #  La prueba visual (0091). Rutas, no URLs: firmarlas es del servicio, y una
            #  firma guardada en la base seria basura con fecha.
            #  De la TABLA y no de la vista: 0091 anadio las columnas a `readings` y la
            #  vista es el modelo de lectura de la reconciliacion, que no las necesita.
            #  Volver a reescribirla para esto arriesgaria mas de lo que ahorra.
            "       rd.crop_location_path, rd.crop_content_path, rd.crop_pallet_path, "
            "       rd.frame_ms, "
            #  DONDE cae el hueco en la rejilla del rack. Sin esto, el plano no puede
            #  pintar la celda: el codigo dice `C018` y los cuerpos de un rack no son
            #  contiguos —21 con codigos propios—, asi que deducir el indice seria
            #  inventarlo. Sale de la vista del alzado, que ya esta unida.
            "       l.rack_id, l.bay_index, l.level, l.position "
            "  FROM inventory.v_reconciliation r "
            "  JOIN inventory.scans s ON s.id = r.scan_id "
            "  JOIN inventory.readings rd ON rd.id = r.reading_id "
            "  LEFT JOIN spatial.rack_front_view l ON l.location_id = r.location_id "
            " WHERE r.warehouse_id = CAST(:wh AS uuid) "
            "   AND r.location_id IS NOT NULL "
            "   AND s.deleted_at IS NULL "
            "   AND (CAST(:rack AS uuid) IS NULL "
            "        OR l.rack_id = CAST(:rack AS uuid)) "
            " ORDER BY r.location_id, " + _ORDEN_R
        )
        filas = (await self._session.execute(stmt, params)).mappings().all()
        return [dict(f) for f in filas]

    async def cobertura_inspeccion(self, warehouse_id: UUID) -> dict[str, Any]:
        """Cuanto del almacen se ha mirado, y cuando por ultima vez.

        ── POR QUE ESTO NO ES UN ADORNO ──────────────────────────────────────────

        Un mapa donde el 99,99 % esta gris y un resumen que no lo dice se lee como «mi
        almacen esta bien». Es la misma trampa que la reconciliacion ya evita agrupando
        «no se pudo ver» aparte de «cuadra», pero a escala de almacen todavia no estaba:
        medido hoy, 4 huecos con lectura de 29.312.

        El silencio no es salud. Sin este numero, cero discrepancias significa las dos
        cosas a la vez —«todo cuadra» y «no has mirado»— y son la conclusion contraria.

        ── LA FECHA IMPORTA TANTO COMO EL PORCENTAJE ─────────────────────────────

        Un almacen inspeccionado al 100 % hace tres meses no esta inspeccionado: esta
        fotografiado. Por eso va la fecha del ultimo recorrido por rack, no solo el
        recuento — «el 40 % visto» y «el 40 % visto en marzo» son informes distintos.

        Se agrega en SQL y no en Python: son 29.310 huecos y traerlos para contarlos aqui
        serian megabytes por cada vez que alguien abre el mapa.
        """
        filas = (
            await self._session.execute(
                text(
                    #  `noqa` con motivo: igual que arriba, solo `_ORDEN_V`.
                    "WITH vistos AS ( "  # noqa: S608
                    "  SELECT DISTINCT ON (v.location_id) v.location_id, v.observed_at, "
                    "         v.status "
                    "    FROM inventory.v_reconciliation v "
                    "    JOIN inventory.scans s ON s.id = v.scan_id "
                    "   WHERE v.warehouse_id = CAST(:wh AS uuid) "
                    "     AND v.location_id IS NOT NULL AND s.deleted_at IS NULL "
                    "   ORDER BY v.location_id, " + _ORDEN_V + ") "
                    "SELECT f.rack_id, f.rack_code, count(*) AS locations, "
                    "       count(v.location_id) AS inspected, "
                    #  Los huecos de ese rack que CONTRADICEN al WMS. Es lo que permite
                    #  colorear el plano por lo que la camara encontro en vez de por lo
                    #  que el WMS declara: un rack con tres discrepancias y uno con
                    #  ninguna se pintan igual si solo se cuenta lo inspeccionado.
                    #
                    #  La lista de estados es la MISMA que abre incidencias
                    #  (`olo.domain.inspeccion`). Escribirla aqui otra vez es como se
                    #  separan las dos y como el mapa acaba discrepando de la bandeja.
                    "       count(v.location_id) FILTER ( "
                    "         WHERE v.status = ANY(CAST(:discrepan AS text[]))) AS mismatched, "
                    "       max(v.observed_at) AS last_seen_at "
                    "  FROM spatial.rack_front_view f "
                    "  LEFT JOIN vistos v ON v.location_id = f.location_id "
                    " WHERE f.warehouse_id = CAST(:wh AS uuid) "
                    " GROUP BY f.rack_id, f.rack_code "
                    #  Los racks CON lecturas primero: son los que alguien quiere abrir.
                    #  Los 346 sin mirar siguen viajando —su ausencia es el dato— pero no
                    #  ocupan las primeras filas.
                    " ORDER BY count(v.location_id) DESC, f.rack_code"
                ),
                {"wh": str(warehouse_id), "discrepan": sorted(ESTADOS_QUE_DISCREPAN)},
            )
        ).mappings().all()

        racks = [dict(f) for f in filas]
        huecos = sum(int(r["locations"]) for r in racks)
        vistos = sum(int(r["inspected"]) for r in racks)
        fechas = [r["last_seen_at"] for r in racks if r["last_seen_at"] is not None]
        return {
            "warehouse_id": str(warehouse_id),
            "locations": huecos,
            "inspected": vistos,
            "racks_total": len(racks),
            "racks_inspected": sum(1 for r in racks if int(r["inspected"]) > 0),
            "mismatched": sum(int(r["mismatched"]) for r in racks),
            "last_seen_at": max(fechas) if fechas else None,
            #  Solo los racks CON algo visto. Los otros son la resta, y mandar 346 filas de
            #  ceros para que el cliente las cuente es trabajo que ya esta hecho aqui.
            "racks": [r for r in racks if int(r["inspected"]) > 0],
        }

    async def cambios_entre_recorridos(
        self, warehouse_id: UUID, rack_id: UUID | None = None
    ) -> list[dict[str, Any]]:
        """Que ve el ultimo recorrido de cada hueco frente a lo que vio el anterior.

        ── POR QUE UNA FOTO SUELTA NO BASTA ──────────────────────────────────────

        «Hay un pallet que el WMS no declara» es un hallazgo. «Hay un pallet que el WMS no
        declara Y SIGUE AHI tres vuelos despues» es otra cosa: dice que nadie lo esta
        arreglando. Y al reves: un hueco que discrepaba y ya no discrepa es la unica prueba
        barata de que el trabajo sirvio.

        Sin esto, cada recorrido es una foto suelta y el producto no tiene memoria.

        ── QUE SE COMPARA CON QUE ────────────────────────────────────────────────

        Por hueco, la ultima lectura de los DOS recorridos mas recientes que lo vieron. No
        las dos ultimas lecturas a secas: un mismo recorrido deja varias del mismo hueco
        —siete en `dataset7` para uno solo— y compararlas entre si diria «cambio» de una
        camara que se movio dos metros.

        Dentro de cada recorrido gana la lectura que MAS dice, igual que en
        `estado_observado`: la que identifico el pallet antes que la que solo vio un bulto.

        Los huecos vistos UNA sola vez no salen: no hay nada que comparar, y devolverlos
        con «antes: nada» los haria parecer cambios.
        """
        params: dict[str, Any] = {
            "wh": str(warehouse_id),
            "rack": None if rack_id is None else str(rack_id),
        }
        stmt = text(
            "WITH por_recorrido AS ( "
            "  SELECT DISTINCT ON (r.location_id, r.scan_id) "
            "         r.location_id, r.location_code, r.scan_id, s.started_at, "
            "         r.status, r.content, r.pallet_code_observed, r.observed_at "
            "    FROM inventory.v_reconciliation r "
            "    JOIN inventory.scans s ON s.id = r.scan_id "
            "    LEFT JOIN spatial.rack_front_view l ON l.location_id = r.location_id "
            "   WHERE r.warehouse_id = CAST(:wh AS uuid) "
            "     AND r.location_id IS NOT NULL AND s.deleted_at IS NULL "
            "     AND (CAST(:rack AS uuid) IS NULL "
            "          OR l.rack_id = CAST(:rack AS uuid)) "
            #  Una fila por hueco Y recorrido: la que mas dice de ese recorrido.
            #  Aqui el desempate es DENTRO de un recorrido —el `scan_id` va en el
            #  `DISTINCT ON`—, asi que el primer escalon no aplica: los dos recorridos se
            #  ordenan despues, en `ordenados`.
            "   ORDER BY r.location_id, r.scan_id, "
            "            (r.pallet_qr = 'read') DESC, "
            "            (r.content <> 'unknown') DESC, r.observed_at DESC), "
            "ordenados AS ( "
            "  SELECT p.*, row_number() OVER ( "
            "           PARTITION BY p.location_id ORDER BY p.started_at DESC) AS n "
            "    FROM por_recorrido p) "
            "SELECT a.location_id, a.location_code, "
            "       a.status AS status_now, a.content AS content_now, "
            "       a.pallet_code_observed AS pallet_now, a.observed_at AS seen_now, "
            "       a.scan_id AS scan_now, "
            "       b.status AS status_before, b.content AS content_before, "
            "       b.pallet_code_observed AS pallet_before, "
            "       b.observed_at AS seen_before, b.scan_id AS scan_before "
            "  FROM ordenados a "
            "  JOIN ordenados b ON b.location_id = a.location_id AND b.n = 2 "
            " WHERE a.n = 1 "
            " ORDER BY a.location_code"
        )
        filas = (await self._session.execute(stmt, params)).mappings().all()
        return [dict(f) for f in filas]


    # ══════════════════════════════════════════════════════════════════════
    # LAS MEDIDAS DEL ALMACEN (0092)
    #
    # Lo que separa un dibujo proporcionado de un modelo a escala. Sin esto, el
    # visor usa convenciones declaradas —1,35 m por posicion, 1,7 m por nivel— y
    # no hay volumen de un hueco ni simulacion posible.
    # ══════════════════════════════════════════════════════════════════════

    _MEDIDAS_COLS = (
        "id, warehouse_id, rack_family, "
        "pallet_width_m, pallet_depth_m, pallet_height_m, "
        "slot_width_m, slot_height_m, slot_depth_m, "
        "bay_width_m, level_height_m, rack_height_m, rack_depth_m, "
        "upright_width_m, beam_height_m, aisle_width_m, aisle_length_m, "
        "double_deep, notes, slot_volume_m3, pallet_volume_m3, medidas_tomadas, "
        "updated_at"
    )

    async def medidas(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Todas las filas de medidas de un almacen: la de por defecto y las excepciones.

        Ordenadas con la de por defecto DELANTE —`rack_family IS NULL`— porque es la que
        se lee primero y de la que heredan las demas.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {self._MEDIDAS_COLS} "  # noqa: S608
                    "  FROM spatial.v_warehouse_metrics "
                    " WHERE warehouse_id = CAST(:wh AS uuid) "
                    " ORDER BY rack_family NULLS FIRST"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def guardar_medidas(
        self, *, tenant_id: UUID, warehouse_id: UUID, familia: str | None,
        valores: dict[str, Any],
    ) -> dict[str, Any]:
        """Crea o actualiza la fila de ese ambito. Una sola sentencia.

        `ON CONFLICT` sobre el indice unico de (almacen, familia): guardar dos veces la
        misma familia tiene que corregir, no duplicar — dos filas del mismo ambito serian
        dos verdades sobre el mismo rack.

        Solo se tocan las columnas que llegan. Mandar el objeto entero obligaria a la
        pantalla a reenviar las trece medidas para corregir una, y el primer despiste
        borraria las demas.
        """
        campos = [
            "pallet_width_m", "pallet_depth_m", "pallet_height_m",
            "slot_width_m", "slot_height_m", "slot_depth_m",
            "bay_width_m", "level_height_m", "rack_height_m", "rack_depth_m",
            "upright_width_m", "beam_height_m", "aisle_width_m", "aisle_length_m",
            "double_deep", "notes",
        ]
        presentes = [c for c in campos if c in valores]
        cols = ", ".join(presentes)
        vals = ", ".join(f":{c}" for c in presentes)
        sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in presentes)

        params: dict[str, Any] = {
            "tid": str(tenant_id),
            "wh": str(warehouse_id),
            "fam": familia,
            **{c: valores[c] for c in presentes},
        }
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO spatial.warehouse_metrics "  # noqa: S608
                    f"(tenant_id, warehouse_id, rack_family{', ' + cols if cols else ''}, "
                    " created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :fam"
                    f"{', ' + vals if vals else ''}, "
                    " core.current_user_id(), core.current_user_id()) "
                    "ON CONFLICT (warehouse_id, COALESCE(rack_family, '')) "
                    "  WHERE deleted_at IS NULL DO UPDATE SET "
                    f"{sets + ', ' if sets else ''}"
                    "  updated_at = now(), updated_by = core.current_user_id(), "
                    "  version = spatial.warehouse_metrics.version + 1 "
                    "RETURNING id"
                ),
                params,
            )
        ).first()
        creado = UUID(str(fila[0]))  # type: ignore[index]
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {self._MEDIDAS_COLS} FROM spatial.v_warehouse_metrics "  # noqa: S608
                    " WHERE id = CAST(:i AS uuid)"
                ),
                {"i": str(creado)},
            )
        ).mappings().first()
        return dict(filas) if filas else {}

    # ══════════════════════════════════════════════════════════════════════
    # FIGURAS 3D (0093)
    # ══════════════════════════════════════════════════════════════════════

    #: Las columnas del catalogo. Una constante y no `SELECT *`: el dia que se añada una
    #: columna, `*` la sacaria por la API sin que nadie lo decidiera — y `ApiModel` prohibe
    #: los campos de mas, asi que el endpoint responderia 500. Ya paso con `crop_path`.
    _FIGURA_COLS = (
        "id, tenant_id, name, kind, glb_path, builtin_key, thumb_path, byte_count, "
        "size_x_m, size_y_m, size_z_m, scale, license, attribution, source_url, notes, "
        "created_at, updated_at, version"
    )

    #: Las de una figura COLOCADA, con lo que hace falta del modelo para dibujarla.
    _INSTANCIA_COLS = (
        "i.id, i.warehouse_id, i.model_id, i.x_m, i.y_m, i.z_m, i.rotation_deg, "
        "i.scale, i.label, i.notes, i.created_at, i.updated_at, i.version, "
        "m.name AS model_name, m.kind AS model_kind, m.glb_path, m.builtin_key, "
        "m.scale AS model_scale, m.size_y_m AS model_size_y_m"
    )

    async def figuras_catalogo(self) -> list[dict[str, Any]]:
        """El catalogo visible: la biblioteca comun MAS la propia.

        Quien decide que se ve es la politica de RLS de 0093, no un WHERE de aqui. Repetir
        el criterio en la consulta seria tener dos reglas de visibilidad: el dia que una
        cambiara, la otra seguiria diciendo lo suyo.

        La comun va DELANTE porque es la que todos tienen y de la que se parte.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {self._FIGURA_COLS} "  # noqa: S608
                    "  FROM spatial.asset_models "
                    " WHERE deleted_at IS NULL "
                    " ORDER BY tenant_id NULLS FIRST, kind, lower(name)"
                )
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def figura(self, model_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {self._FIGURA_COLS} FROM spatial.asset_models "  # noqa: S608
                    " WHERE id = CAST(:i AS uuid) AND deleted_at IS NULL"
                ),
                {"i": str(model_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def crear_figura(
        self, *, model_id: UUID, tenant_id: UUID | None, valores: dict[str, Any]
    ) -> dict[str, Any]:
        """Registra el modelo. El id lo trae quien llamo, porque la RUTA se derivo de el.

        Es la misma regla que la subida de un medio: el id se genera al reservar sitio y se
        reutiliza al confirmar, asi no hay forma de subir a un sitio y reclamar otro.
        """
        columnas = [
            "name", "kind", "glb_path", "thumb_path", "byte_count",
            "size_x_m", "size_y_m", "size_z_m", "scale",
            "license", "attribution", "source_url", "notes",
        ]
        presentes = [c for c in columnas if c in valores]
        cols = ", ".join(presentes)
        vals = ", ".join(f":{c}" for c in presentes)
        await self._session.execute(
            text(
                "INSERT INTO spatial.asset_models "  # noqa: S608
                f"(id, tenant_id, {cols}, created_by, updated_by) "
                f"VALUES (CAST(:mid AS uuid), CAST(:tid AS uuid), {vals}, "
                " core.current_user_id(), core.current_user_id())"
            ),
            {
                "mid": str(model_id),
                "tid": None if tenant_id is None else str(tenant_id),
                **{c: valores[c] for c in presentes},
            },
        )
        creada = await self.figura(model_id)
        return creada or {}

    async def borrar_figura(self, model_id: UUID) -> bool:
        """Baja logica. `deleted_at` y no DELETE: una figura puede estar colocada en un
        plano, y borrarla de verdad dejaria apariciones apuntando a nada.
        """
        #  `RETURNING` y no `rowcount`: dice si de verdad se toco una fila, con el tipo
        #  que declara SQLAlchemy —`rowcount` no esta en `Result`— y sin depender de que
        #  el driver lo informe.
        fila = (
            await self._session.execute(
                text(
                    "UPDATE spatial.asset_models "
                    "   SET deleted_at = now(), updated_by = core.current_user_id() "
                    " WHERE id = CAST(:i AS uuid) AND deleted_at IS NULL "
                    "RETURNING id"
                ),
                {"i": str(model_id)},
            )
        ).first()
        return fila is not None

    async def figuras_colocadas(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Las figuras de ese almacen, con lo que hace falta del modelo para dibujarlas.

        JOIN y no dos consultas: el plano necesita la ruta del `.glb` de cada aparicion, y
        pedirla aparte serian tantas idas y vueltas como figuras.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {self._INSTANCIA_COLS} "  # noqa: S608
                    "  FROM spatial.asset_instances i "
                    "  JOIN spatial.asset_models m ON m.id = i.model_id "
                    " WHERE i.warehouse_id = CAST(:wh AS uuid) "
                    "   AND i.deleted_at IS NULL AND m.deleted_at IS NULL "
                    " ORDER BY i.created_at"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def instancia(self, instance_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {self._INSTANCIA_COLS} "  # noqa: S608
                    "  FROM spatial.asset_instances i "
                    "  JOIN spatial.asset_models m ON m.id = i.model_id "
                    " WHERE i.id = CAST(:i AS uuid) AND i.deleted_at IS NULL"
                ),
                {"i": str(instance_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def colocar_figura(
        self, *, tenant_id: UUID, warehouse_id: UUID, model_id: UUID, valores: dict[str, Any]
    ) -> dict[str, Any]:
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO spatial.asset_instances "
                    "(tenant_id, warehouse_id, model_id, x_m, y_m, z_m, rotation_deg, "
                    " scale, label, notes, created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), CAST(:mid AS uuid), "
                    " :x, :y, :z, :rot, :esc, :etq, :notas, "
                    " core.current_user_id(), core.current_user_id()) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "mid": str(model_id),
                    "x": valores["x_m"],
                    "y": valores["y_m"],
                    "z": valores.get("z_m", 0),
                    "rot": valores.get("rotation_deg", 0),
                    "esc": valores.get("scale", 1),
                    "etq": valores.get("label"),
                    "notas": valores.get("notes"),
                },
            )
        ).first()
        creada = await self.instancia(UUID(str(fila[0])))  # type: ignore[index]
        return creada or {}

    async def mover_figura(
        self, *, instance_id: UUID, valores: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Cambia solo lo que llega.

        Mandar el objeto entero obligaria a la pantalla a reenviar la posicion para cambiar
        una etiqueta, y el primer despiste moveria la figura.
        """
        campos = ["x_m", "y_m", "z_m", "rotation_deg", "scale", "label", "notes"]
        presentes = [c for c in campos if c in valores]
        if not presentes:
            return await self.instancia(instance_id)
        sets = ", ".join(f"{c} = :{c}" for c in presentes)
        fila = (
            await self._session.execute(
                text(
                    "UPDATE spatial.asset_instances "  # noqa: S608
                    f"   SET {sets}, updated_at = now(), "
                    "       updated_by = core.current_user_id(), version = version + 1 "
                    " WHERE id = CAST(:i AS uuid) AND deleted_at IS NULL "
                    "RETURNING id"
                ),
                {"i": str(instance_id), **{c: valores[c] for c in presentes}},
            )
        ).first()
        #  `None` significa «no existe o ya estaba borrada», y quien llama lo convierte en
        #  404. Devolver la figura sin cambios diria que se movio y no se movio.
        if fila is None:
            return None
        return await self.instancia(instance_id)

    async def quitar_figura(self, instance_id: UUID) -> bool:
        fila = (
            await self._session.execute(
                text(
                    "UPDATE spatial.asset_instances "
                    "   SET deleted_at = now(), updated_by = core.current_user_id() "
                    " WHERE id = CAST(:i AS uuid) AND deleted_at IS NULL "
                    "RETURNING id"
                ),
                {"i": str(instance_id)},
            )
        ).first()
        return fila is not None

    # ══════════════════════════════════════════════════════════════════════
    # RECORRIDOS (0094)
    # ══════════════════════════════════════════════════════════════════════

    _TRIP_COLS = (
        "id, warehouse_id, name, model_id, speed_mps, notes, "
        "created_at, updated_at, version"
    )

    _STOP_COLS = (
        "id, trip_id, seq, operation, dwell_s, notes, location_id, location_code, "
        "rack_node_id, bay_index, level, position, created_at, updated_at, version"
    )

    async def recorridos(self, warehouse_id: UUID) -> list[dict[str, Any]]:
        """Los recorridos de un almacen, con cuantas paradas tiene cada uno.

        El recuento va en la lista porque es lo que permite distinguir un recorrido a medio
        escribir de uno completo sin abrirlo. Sin el, todos se ven iguales.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {self._TRIP_COLS}, "  # noqa: S608
                    "       (SELECT count(*) FROM spatial.trip_stops s "
                    "         WHERE s.trip_id = t.id AND s.deleted_at IS NULL) AS stop_count "
                    "  FROM spatial.trips t "
                    " WHERE warehouse_id = CAST(:wh AS uuid) AND deleted_at IS NULL "
                    " ORDER BY lower(name)"
                ),
                {"wh": str(warehouse_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def recorrido(self, trip_id: UUID) -> dict[str, Any] | None:
        fila = (
            await self._session.execute(
                text(
                    f"SELECT {self._TRIP_COLS} FROM spatial.trips "  # noqa: S608
                    " WHERE id = CAST(:i AS uuid) AND deleted_at IS NULL"
                ),
                {"i": str(trip_id)},
            )
        ).mappings().first()
        return dict(fila) if fila else None

    async def paradas(self, trip_id: UUID) -> list[dict[str, Any]]:
        """Las paradas EN ORDEN, con la estructura del hueco.

        Se ordena en la consulta y no se confia en el orden de llegada: las mismas paradas en
        otro orden son otro recorrido, casi siempre con otra distancia.
        """
        filas = (
            await self._session.execute(
                text(
                    f"SELECT {self._STOP_COLS} FROM spatial.v_trip_stops "  # noqa: S608
                    " WHERE trip_id = CAST(:i AS uuid) ORDER BY seq"
                ),
                {"i": str(trip_id)},
            )
        ).mappings().all()
        return [dict(f) for f in filas]

    async def crear_recorrido(
        self, *, tenant_id: UUID, warehouse_id: UUID, valores: dict[str, Any]
    ) -> dict[str, Any]:
        fila = (
            await self._session.execute(
                text(
                    "INSERT INTO spatial.trips "
                    "(tenant_id, warehouse_id, name, model_id, speed_mps, notes, "
                    " created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:wh AS uuid), :nombre, "
                    " CAST(:modelo AS uuid), :vel, :notas, "
                    " core.current_user_id(), core.current_user_id()) "
                    "RETURNING id"
                ),
                {
                    "tid": str(tenant_id),
                    "wh": str(warehouse_id),
                    "nombre": valores["name"],
                    "modelo": (
                        str(valores["model_id"]) if valores.get("model_id") else None
                    ),
                    "vel": valores.get("speed_mps", 1.2),
                    "notas": valores.get("notes"),
                },
            )
        ).first()
        creado = await self.recorrido(UUID(str(fila[0])))  # type: ignore[index]
        return creado or {}

    async def actualizar_recorrido(
        self, *, trip_id: UUID, valores: dict[str, Any]
    ) -> dict[str, Any] | None:
        campos = {"name": "name", "speed_mps": "speed_mps", "notes": "notes"}
        sets = [f"{col} = :{k}" for k, col in campos.items() if k in valores]
        params: dict[str, Any] = {
            "i": str(trip_id),
            **{k: valores[k] for k in campos if k in valores},
        }
        #  `model_id` aparte porque hay que convertirlo, y porque `None` es un valor valido:
        #  quitar la figura de un recorrido es una decision, no un olvido.
        if "model_id" in valores:
            sets.append("model_id = CAST(:modelo AS uuid)")
            params["modelo"] = str(valores["model_id"]) if valores["model_id"] else None
        if not sets:
            return await self.recorrido(trip_id)
        fila = (
            await self._session.execute(
                text(
                    "UPDATE spatial.trips "  # noqa: S608
                    f"   SET {', '.join(sets)}, updated_at = now(), "
                    "       updated_by = core.current_user_id(), version = version + 1 "
                    " WHERE id = CAST(:i AS uuid) AND deleted_at IS NULL "
                    "RETURNING id"
                ),
                params,
            )
        ).first()
        if fila is None:
            return None
        return await self.recorrido(trip_id)

    async def guardar_paradas(
        self, *, tenant_id: UUID, trip_id: UUID, paradas: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Reemplaza TODAS las paradas del recorrido.

        ── POR QUE ENTERAS Y NO UNA A UNA ────────────────────────────────────────

        Porque lo que se edita es la LISTA: se reordena, se mete una en medio, se quita otra.
        Con altas y bajas sueltas, reordenar seria una secuencia de operaciones que puede
        quedarse a medias y dejar dos paradas con el mismo orden — y el indice unico de 0094
        lo rechazaria a mitad, dejando el recorrido peor de como estaba—.

        Las viejas se dan de baja LOGICA en vez de borrarse: el indice unico de `seq` solo
        mira las vivas, asi que no estorban, y un recorrido que alguien deshizo por error se
        puede recuperar mirando la base.
        """
        await self._session.execute(
            text(
                "UPDATE spatial.trip_stops "
                "   SET deleted_at = now(), updated_by = core.current_user_id() "
                " WHERE trip_id = CAST(:i AS uuid) AND deleted_at IS NULL"
            ),
            {"i": str(trip_id)},
        )
        for i, p in enumerate(paradas):
            await self._session.execute(
                text(
                    "INSERT INTO spatial.trip_stops "
                    "(tenant_id, trip_id, seq, location_id, operation, dwell_s, notes, "
                    " created_by, updated_by) "
                    "VALUES (CAST(:tid AS uuid), CAST(:trip AS uuid), :seq, "
                    " CAST(:loc AS uuid), :op, :dwell, :notas, "
                    " core.current_user_id(), core.current_user_id())"
                ),
                {
                    "tid": str(tenant_id),
                    "trip": str(trip_id),
                    #  El orden lo pone el SERVIDOR por la posicion en la lista, no el
                    #  cliente: asi no hay forma de mandar dos paradas con el mismo `seq` ni
                    #  huecos en la numeracion.
                    "seq": i,
                    "loc": str(p["location_id"]),
                    "op": p.get("operation", "pasar"),
                    "dwell": p.get("dwell_s", 0),
                    "notas": p.get("notes"),
                },
            )
        return await self.paradas(trip_id)

    async def borrar_recorrido(self, trip_id: UUID) -> bool:
        fila = (
            await self._session.execute(
                text(
                    "UPDATE spatial.trips "
                    "   SET deleted_at = now(), updated_by = core.current_user_id() "
                    " WHERE id = CAST(:i AS uuid) AND deleted_at IS NULL "
                    "RETURNING id"
                ),
                {"i": str(trip_id)},
            )
        ).first()
        return fila is not None
