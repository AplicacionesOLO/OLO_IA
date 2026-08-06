"""Esquemas de petición y respuesta.

Solo estructura y validación de forma: las reglas de negocio están en el
dominio y en la base. Estos modelos existen para rechazar entrada malformada
antes de que llegue a la lógica.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


# ── Envoltorios ───────────────────────────────────────────────────────────
class Envelope[T](ApiModel):
    data: T


class PageMeta(ApiModel):
    """Metadatos de página con LAS DOS formas de paginar a la vez.

    `next_cursor` es la correcta para recorrer: su coste no crece con la
    profundidad. `page` / `total` / `total_pages` existen porque una tabla con
    «página 7 de 294» necesita saber cuántas hay, y eso un cursor no lo dice.

    Los tres campos numéricos son OPCIONALES: `total` obliga a un `count`, y en
    una navegación por cursor sobre 29.310 ubicaciones contarlas en cada página
    es trabajo que nadie pidió. El endpoint los rellena solo cuando el cliente
    los pide con `with_total=true`; si no, valen `None` y el cliente sabe que no
    se contó, en lugar de recibir un cero que parecería «no hay nada».
    """

    next_cursor: str | None = None
    page_size: int
    page: int | None = None
    total: int | None = None
    total_pages: int | None = None


class PagedEnvelope[T](ApiModel):
    data: list[T]
    pagination: PageMeta


# ── Warehouse ─────────────────────────────────────────────────────────────
class WarehouseOut(ApiModel):
    id: UUID
    company_id: UUID
    name: str
    code: str
    status: str
    timezone: str
    locale: str
    currency_code: str | None
    latitude: float | None
    longitude: float | None
    address: dict[str, Any] | None
    version: int
    created_at: datetime
    updated_at: datetime

    # `tenant_id` NO se expone: el cliente ya opera dentro de un solo tenant y
    # devolverlo solo añadiría un identificador que no necesita.


class WarehouseCreate(ApiModel):
    company_id: UUID
    name: Annotated[str, Field(min_length=2, max_length=200)]
    code: Annotated[str, Field(min_length=2, max_length=20, pattern=r"^[A-Za-z0-9][A-Za-z0-9-]*$")]
    timezone: Annotated[str, Field(min_length=3, max_length=50)]
    locale: Annotated[str, Field(pattern=r"^[a-z]{2}(-[A-Z]{2})?$")] = "es"
    currency_code: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None = None
    latitude: Annotated[float, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180)] | None = None
    address: dict[str, Any] | None = None

    @field_validator("code")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("timezone")
    @classmethod
    def _plausible_timezone(cls, v: str) -> str:
        """Valida el timezone contra la base de datos de zonas de Python.

        La base no puede hacerlo: la única fuente fiable en PostgreSQL es
        `pg_timezone_names`, que es una vista no inmutable y por tanto
        inadmisible en un CHECK. Por eso la validación es responsabilidad de
        esta capa.
        """
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
            msg = f"Zona horaria desconocida: {v!r}"
            raise ValueError(msg) from exc
        return v


# ── Identidad ─────────────────────────────────────────────────────────────
class TenantOut(ApiModel):
    id: UUID
    name: str
    slug: str
    status: str
    plan: str


class RoleAssignmentOut(ApiModel):
    name: str
    scope_type: str
    scope_company_id: UUID | None = None
    scope_warehouse_id: UUID | None = None


class MeOut(ApiModel):
    id: UUID
    email: str
    first_name: str
    last_name: str
    locale: str
    timezone: str
    status: str
    tenant: TenantOut
    roles: list[RoleAssignmentOut]
    permissions: list[str]
    accessible_warehouse_ids: list[UUID]
    tenant_wide_access: bool

    is_platform_owner: bool = False
    """Administración de plataforma, por encima de los tenants.

    Se resuelve contra la base en cada petición, NO desde el JWT: revocar el
    privilegio más potente del sistema debe surtir efecto de inmediato, no en
    hasta una hora.

    Cuando es `true`, `permissions` incluye además los permisos de alcance
    plataforma. El cliente no necesita saber de dónde vienen: sigue ocultando por
    permiso, igual que con los de tenant.
    """


class PlatformOwnerOut(ApiModel):
    """Un Platform Owner. Solo visible para otros Platform Owners."""

    user_id: UUID
    email: str
    first_name: str
    last_name: str
    granted_at: datetime
    granted_by_email: str | None
    revoked_at: datetime | None
    reason: str


class WarehouseUpdate(ApiModel):
    """Actualización parcial. Solo los campos presentes se modifican.

    `code` y `company_id` NO son actualizables: cambiar el código rompe las
    referencias operativas que el personal de almacén usa a diario, y mover un
    almacén de compañía es una operación de reestructuración, no una edición.
    """

    name: Annotated[str, Field(min_length=2, max_length=200)] | None = None
    status: Literal["active", "inactive", "maintenance"] | None = None
    timezone: Annotated[str, Field(min_length=3, max_length=50)] | None = None
    locale: Annotated[str, Field(pattern=r"^[a-z]{2}(-[A-Z]{2})?$")] | None = None
    currency_code: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None = None
    latitude: Annotated[float, Field(ge=-90, le=90)] | None = None
    longitude: Annotated[float, Field(ge=-180, le=180)] | None = None
    address: dict[str, Any] | None = None

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
            msg = f"Zona horaria desconocida: {v!r}"
            raise ValueError(msg) from exc
        return v

    def changes(self) -> dict[str, Any]:
        """Solo los campos que el cliente envió realmente.

        `exclude_unset` distingue "no lo mandé" de "lo mandé como null", que en
        una actualización parcial son cosas distintas.
        """
        return self.model_dump(exclude_unset=True)


# ── Autenticación ─────────────────────────────────────────────────────────
class LoginRequest(ApiModel):
    """Credenciales de acceso.

    `password` NO lleva longitud mínima de política, a propósito. La política de
    contraseñas se aplica al crearlas y cambiarlas, no al usarlas: en el login,
    una contraseña demasiado corta es simplemente incorrecta.

    Tenerla aquí producía dos defectos reales, ambos medidos:
      • una cuenta cuya contraseña es más corta que la política vigente —porque
        se creó antes, o porque el mínimo de GoTrue es menor— no podía entrar por
        este endpoint aunque sus credenciales son válidas. Devolvía 400
        VALIDATION_ERROR en lugar de autenticar;
      • el 400 revela el mínimo exigido antes de comprobar nada.

    El único límite que queda es el superior, y no es política sino protección:
    evita que se hashee una entrada arbitrariamente grande. La validez la decide
    el proveedor de identidad, y su respuesta es 401 INVALID_CREDENTIALS.
    """

    email: Annotated[str, Field(min_length=5, max_length=320)]
    password: Annotated[str, Field(min_length=1, max_length=200)]


class RefreshRequest(ApiModel):
    refresh_token: Annotated[str, Field(min_length=10)]


class TokenOut(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int
    expires_at: int

# ── Spatial ───────────────────────────────────────────────────────────────
#
# Estos modelos son planos a propósito: el frontend NO debe parsear `full_code`
# para saber el nivel ni la posición, así que cada componente viaja como campo
# propio (ADR-013). Un cliente que tenga que hacer `code.split('-')` es un
# cliente al que le hemos pasado nuestro problema.


class WarehouseSpatialSummaryOut(ApiModel):
    """KPIs de un almacén. Refleja `spatial.warehouse_summary` de 0059.

    No hay `occupied_count`: la ocupación es del inventario, no del estante
    (SPA-11, y R3 del ADR-009). Lo que sí hay es el histograma completo del
    vocabulario del WMS y el número de contradicciones entre sus dos columnas
    de estado, que es el dato que hay que mirar antes de fiarse de cualquiera.
    """

    warehouse_id: UUID
    warehouse_code: str
    warehouse_name: str
    site_count: int
    aisle_count: int
    rack_count: int
    bay_count: int
    location_count: int
    available_count: int
    blocked_count: int
    inferred_count: int
    opaque_count: int
    wms_situation_counts: dict[str, int]
    status_situation_conflicts: int
    capacity_unlimited_count: int
    capacity_unknown_count: int
    with_world_geometry: int
    last_import_at: datetime | None
    total_rows_rejected: int | None


class SpatialNodeOut(ApiModel):
    """Un nodo del árbol. `child_count` evita una petición por nodo solo para
    saber si se puede expandir."""

    node_id: UUID
    parent_node_id: UUID | None
    node_type: str
    node_function: str | None
    function_label: str | None
    node_code: str
    external_code: str | None
    name: str | None
    logical_index: int | None
    site_id: UUID | None
    can_hold_locations: bool
    child_count: int
    location_count: int


class SpatialTreeNodeOut(SpatialNodeOut):
    """Igual que `SpatialNodeOut` más la profundidad, para que el cliente
    dibuje la indentación sin recalcular el camino."""

    depth: int


class FloorPlanCellOut(ApiModel):
    """Una fila por rack: 347 en lugar de 29.310.

    `available_count` + `blocked_count` = `location_count`, siempre. Es una
    partición real y la migración 0059 lo verifica sobre datos reales.
    """

    rack_id: UUID
    rack_code: str
    rack_external_code: str | None
    rack_index: int | None
    rack_node_type: str
    node_function: str | None
    function_label: str | None
    aisle_id: UUID | None
    aisle_code: str | None
    site_id: UUID | None
    bay_count: int
    location_count: int
    available_count: int
    blocked_count: int
    inferred_count: int
    bulk_count: int
    wms_situation_counts: dict[str, int]
    status_situation_conflicts: int
    min_logical_x: int | None
    max_logical_x: int | None
    min_logical_y: int | None
    max_logical_y: int | None
    max_level: int | None


class RackFrontCellOut(ApiModel):
    """Un hueco del alzado: cuerpo x nivel x posición, ya descompuesto."""

    location_id: UUID
    bay_id: UUID
    bay_code: str
    bay_index: int
    level: int | None
    position: int | None
    full_code: str
    external_code: str | None
    location_status: str
    location_situation: str | None
    is_bulk_area: bool
    origin: str
    max_weight_kg: float | None
    max_units: int | None


class RackFrontViewOut(ApiModel):
    """El alzado completo de un rack, con sus dimensiones ya calculadas.

    `bay_count`, `max_level` y `max_position` van en la respuesta para que el
    cliente dimensione la rejilla antes de recorrer las celdas, en lugar de
    tener que hacer un `max()` sobre ellas.
    """

    rack_id: UUID
    rack_code: str
    rack_external_code: str | None
    node_function: str | None
    function_label: str | None
    bay_count: int
    max_level: int | None
    max_position: int | None
    cells: list[RackFrontCellOut]


class LocationOut(ApiModel):
    """Contrato plano de una ubicación. CERO parseo en el cliente.

    `capacity_declared_unlimited` distingue «el WMS dijo ilimitado» (26.244
    ubicaciones del catálogo real) de «el WMS no dijo nada» (727). Antes de la
    migración 0058 ambas eran el mismo `max_weight_kg IS NULL`.
    """

    location_id: UUID
    warehouse_id: UUID
    warehouse_code: str
    site_id: UUID | None
    site_code: str | None
    aisle_id: UUID | None
    aisle_code: str | None
    rack_id: UUID | None
    rack_code: str | None
    rack_external_code: str | None
    rack_index: int | None
    bay_id: UUID | None
    bay_code: str | None
    bay_index: int | None
    level: int | None
    position: int | None
    # `logical_column` es atributo de la UBICACION; `bay_index` es el indice del
    # CUERPO padre. Coinciden en las 29.310 filas importadas porque el importador
    # usa el mismo valor, pero no son el mismo campo: una ubicacion colgada de un
    # rack sin cuerpo tiene columna y no tiene `bay_index`.
    logical_column: int | None
    full_code: str
    external_code: str | None
    external_location_id: str | None
    code_form: str
    location_type: str
    location_status: str
    location_situation: str | None
    is_bulk_area: bool
    origin: str
    max_weight_kg: float | None
    max_units: int | None
    capacity_declared_unlimited: bool
    node_function: str | None
    function_label: str | None
    implies_bulk: bool | None
    logical_x: int | None
    logical_y: int | None
    logical_z: int | None
    world_x_m: float | None
    world_y_m: float | None
    world_z_m: float | None
    """Posicion METRICA en el marco del plano. `null` mientras no se derive.

    Se expone como tres numeros y no como el WKB de PostGIS a proposito: el
    cliente necesita tres coordenadas para dibujar y `origin` para saber si son
    medidas o calculadas (`inferred`, ver 0066). Un WKB obligaria al navegador a
    traerse una libreria de geometria para leer un punto.

    No confundir con `logical_x/y/z`, que estan justo arriba y NO son metros:
    aquellos son indices del WMS —`logical_x = 70077` identifica una casilla, no
    mide una distancia— y esa distincion es la razon de que los seis campos
    convivan con nombres distintos."""


# ── Layout del plano ───────────────────────────────────────────────────────
#
# La colocacion viaja en METROS, no en pixeles del plano. El editor trabaja en
# pixeles porque es lo que el raton toca, pero un pixel no mide nada: los mismos
# 20 px son 0,40 m en un plano y 0,75 m en otro. La conversion se hace en el
# cliente, con la escala que el propio cliente calibro, y la API solo acepta la
# unidad que significa algo.


class RackPlacementIn(ApiModel):
    rack_node_id: UUID
    x_m: float = Field(..., ge=-10000, le=10000)
    y_m: float = Field(..., ge=-10000, le=10000)
    # Normalizado a [0, 360). El CHECK de la base impone lo mismo: aqui se rechaza
    # antes para dar un 400 con nombre de campo en vez de un error de integridad.
    rotation_deg: float = Field(0, ge=0, lt=360)
    width_m: float = Field(..., ge=0.05, le=200)
    length_m: float = Field(..., ge=0.05, le=200)
    height_m: float = Field(..., ge=0.05, le=60)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    is_locked: bool = False


class RackPlacementOut(ApiModel):
    id: UUID
    rack_node_id: UUID
    rack_code: str
    node_type: str
    node_function: str | None
    x_m: float
    y_m: float
    rotation_deg: float
    width_m: float
    length_m: float
    height_m: float
    color: str | None
    is_locked: bool
    updated_at: datetime


class WarehouseLayoutOut(ApiModel):
    id: UUID
    warehouse_id: UUID
    plan_name: str | None
    plan_width_px: int | None
    plan_height_px: int | None
    pixels_per_meter: float
    origin_x_px: float
    origin_y_px: float
    is_calibrated: bool
    published_at: datetime | None
    published_by: UUID | None
    updated_at: datetime


class LayoutPublishIn(ApiModel):
    """Publicar es enviar el layout COMPLETO, no un delta.

    Si llegaran 340 de 347 racks no habria forma de saber si los 7 que faltan se
    borraron o se perdieron por el camino. Con el conjunto completo, la operacion
    es idempotente y el servidor no tiene que adivinar.
    """

    plan_name: str | None = Field(None, max_length=200)
    plan_width_px: int | None = Field(None, gt=0, le=100000)
    plan_height_px: int | None = Field(None, gt=0, le=100000)
    pixels_per_meter: float = Field(..., gt=0, le=100000)
    origin_x_px: float = 0
    origin_y_px: float = 0
    is_calibrated: bool = False
    placements: list[RackPlacementIn]


class LayoutOut(ApiModel):
    """Lo que devuelve leer o publicar: el espacio de trabajo y las colocaciones.

    `layout` es nulo cuando el almacen no tiene plano publicado. NO es un 404: que
    todavia no haya plano es una respuesta legitima que el editor necesita para
    saber que empieza de cero.
    """

    layout: WarehouseLayoutOut | None
    placements: list[RackPlacementOut]
    published: int | None = None
    calibrated: bool | None = None
    derived_locations: int | None = None
    """Ubicaciones a las que se les calculo `world_position` en esta publicacion.

    Es lo que hace util el layout mas alla de mirarlo: con ella el visor 3D compone
    el cluster y el seguimiento de la flota puede preguntar «que ubicacion esta mas
    cerca de donde vio la camara». `0` cuando se publico sin calibrar, porque sin
    escala medida «metros» no significa nada; ver 0066."""
    """`calibrated` viaja aparte de `layout.is_calibrated` a proposito.

    Publicar un plano sin calibrar esta permitido —hay quien guarda el trabajo a
    medias— pero la respuesta lo declara, porque un layout sin calibrar tiene las
    posiciones en la escala por defecto de 50 px/m y nadie deberia enterarse al
    mirar un mapa de calor que no cuadra. En la lectura ambos campos son nulos:
    no hubo publicacion que reportar."""


# ── Observaciones y rutas (0067) ───────────────────────────────────────────
#
# Una observacion es un hecho atomico: «la fuente S vio el rack R a las T». La RUTA
# no se envia ni se guarda: se DERIVA uniendo las observaciones ordenadas con la
# colocacion en metros de los racks. Por eso este contrato no tiene un tipo «ruta»
# de entrada, solo de salida.
#
# `x_m`/`y_m` de un punto de la ruta son del RACK, no de la fuente. Se sabe que la
# fuente estuvo lo bastante cerca para verlo; donde estaba exactamente no se sabe, y
# nombrarlo `posicion_fuente` habria sido fabricar telemetria.


class ObservationSourceOut(ApiModel):
    """Dispositivo o recorrido que produce observaciones."""

    id: UUID
    warehouse_id: UUID
    code: str
    name: str
    kind: str
    clock_skew_ms: int
    is_active: bool
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ObservationIn(ApiModel):
    rack_node_id: UUID
    observed_at: datetime
    confidence: float | None = Field(default=None, ge=0, le=1)
    frame_ref: str | None = Field(default=None, max_length=200)
    frame_ms: int | None = Field(default=None, ge=0)
    notes: str | None = None


class ObservationBatchIn(ApiModel):
    """Un lote de observaciones de UNA fuente.

    `source_kind` solo hace falta la primera vez: si la fuente no existe se registra
    con el, y sin el no se sabria si sus observaciones forman recorrido —una camara
    fija ve siempre el mismo sitio—. Se admite crear la fuente al ingerir porque
    obligar a darla de alta en otra pantalla significa perder su primer vuelo.
    """

    source_code: str = Field(..., min_length=1, max_length=40)
    source_name: str | None = Field(default=None, max_length=120)
    source_kind: str | None = None
    observations: list[ObservationIn]

    @field_validator("source_kind")
    @classmethod
    def _tipo_conocido(cls, v: str | None) -> str | None:
        permitidos = {"drone", "phone", "fixed_camera", "forklift", "manual"}
        if v is not None and v not in permitidos:
            raise ValueError(f"source_kind debe ser uno de {sorted(permitidos)}")
        return v


class IngestOut(ApiModel):
    source: ObservationSourceOut
    received: int
    """Observaciones NUEVAS. Reintentar un lote ya subido devuelve 0, no un error."""
    stored: int
    """Las que ya estaban. `received == duplicates` significa «no perdiste nada»."""
    duplicates: int


class RoutePointOut(ApiModel):
    observation_id: UUID
    source_id: UUID
    source_code: str
    source_name: str
    source_kind: str
    rack_node_id: UUID
    rack_code: str
    observed_at: datetime
    confidence: float | None
    frame_ref: str | None
    frame_ms: int | None
    x_m: float
    y_m: float
    rotation_deg: float
    paso: int


class RouteOut(ApiModel):
    source_id: UUID
    source_code: str
    source_name: str
    source_kind: str
    forms_path: bool
    """`false` para una camara fija: ve siempre el mismo sitio, asi que unir sus
    observaciones con lineas dibujaria un viaje que nadie hizo."""
    points: list[RoutePointOut]
    point_count: int
    distinct_racks: int
    straight_line_distance_m: float
    """Suma de las RECTAS entre racks observados consecutivos.

    Es una cota INFERIOR del recorrido real, no odometria: entre dos observaciones
    la fuente pudo dar la vuelta al pasillo. El nombre lo dice para que nadie la lea
    como distancia recorrida."""
    duration_s: float | None
    avg_speed_ms: float | None
    """`null` con una sola observacion o con dos en el mismo instante: sin tiempo
    transcurrido no hay velocidad, y devolver 0 la habria inventado."""
    first_seen: datetime | None
    last_seen: datetime | None


class RoutesOut(ApiModel):
    """Una polilinea por fuente, no una lista plana.

    Aplanarlas dejaria al cliente uniendo el ultimo punto de un dron con el primero
    del siguiente, que es un zigzag que nadie recorrio.
    """

    routes: list[RouteOut]
    truncated: bool
    max_points: int


class ObservationOut(ApiModel):
    observation_id: UUID
    source_id: UUID
    source_code: str
    source_kind: str
    rack_node_id: UUID
    rack_code: str
    observed_at: datetime
    ingested_at: datetime
    confidence: float | None
    frame_ref: str | None
    frame_ms: int | None
    notes: str | None
    rack_colocado: bool
    """Si el rack esta colocado en el plano. Si no, la observacion existe pero NO
    sale en la ruta: no tiene punto, y contarla como (0,0) meteria un vertice en la
    esquina del almacen."""


class CoverageOut(ApiModel):
    total: int
    racks_vistos: int
    fuentes: int
    sin_colocar: int
    """Observaciones de racks que nadie ha situado en el plano. Es la cifra
    incomoda y por eso se da: sin ella desaparecerian sin dejar rastro."""
    primera: datetime | None
    ultima: datetime | None


# ── Inventario y ocupación (0068) ──────────────────────────────────────────
#
# El catalogo espacial dice DONDE esta cada hueco; el snapshot del WMS dice QUE tiene.
# Estos esquemas son la union: la ocupacion, que es la pregunta que el almacen se hace
# todos los dias.
#
# La ocupacion se DERIVA de que exista una linea de stock en el hueco. No hay ningun
# campo `ocupado` guardado en la base: guardarlo crearia un dato que hay que mantener
# sincronizado con las lineas que lo justifican.


class SnapshotOut(ApiModel):
    """Una FOTO del inventario. Las fotos no se editan: llega una nueva."""

    snapshot_id: UUID
    taken_at: datetime
    """Cuando se tomo la foto, NO cuando se subio. Un reporte del martes importado el
    jueves tiene fecha del martes: es lo que permite ordenar las fotos por antiguedad
    real en lugar de por orden de llegada."""
    received_at: datetime
    source: str
    row_count: int
    notes: str | None = None


class SnapshotHistoryOut(SnapshotOut):
    status: str
    """`ready`, `loading` o `failed`. Las que fallaron se muestran a proposito: alguien
    lo intento y no salio, y esconderlo haria que repitiera el intento a ciegas."""
    external_ref: str | None = None


class InventorySummaryOut(ApiModel):
    snapshot: SnapshotOut | None
    """`null` cuando nadie ha importado inventario. NO es un error: el explorador
    necesita distinguir «nadie lo ha subido» de «no puedo leerlo»."""
    locations: int
    occupied: int
    free: int
    occupancy_pct: float | None
    """`null` sin foto. Devolver 0 diria que el almacen esta VACIO, que es una
    afirmacion sobre el mundo que nadie ha comprobado."""
    units: float | None
    pallets: int | None
    taken_at: datetime | None
    first_expiry: date | None


class RackOccupancyOut(ApiModel):
    rack_id: UUID
    rack_code: str
    node_function: str | None
    locations: int
    occupied: int
    free: int
    occupancy_pct: float | None
    """`null` si el rack no tiene huecos. No es 0 %: «vacio» y «no tiene donde poner
    nada» son cosas distintas."""
    units: float | None
    pallets: int | None
    blocked: int
    first_expiry: date | None


class RackOccupancyListOut(ApiModel):
    """Envuelto y no lista plana: el cliente necesita saber DE QUE FOTO son estos
    numeros para poder decirlo en pantalla."""

    snapshot: SnapshotOut | None
    racks: list[RackOccupancyOut]


class LocationOccupancyOut(ApiModel):
    location_id: UUID
    location_code: str
    level: int | None
    spatial_status: str
    wms_situation: str | None
    lines: int
    occupied: bool
    pallets: int
    skus: int
    clients: int
    units: float | None
    first_expiry: date | None


class StockLineOut(ApiModel):
    id: UUID
    location_id: UUID | None
    location_code: str
    pallet_code: str | None
    sku: str | None
    description: str | None
    qty: float | None
    """`null` es «el reporte no lo dice» y `0` es «hay una linea y su cantidad es
    cero», que el WMS produce de verdad. Confundirlos haria que un hueco sin dato
    pareciera vacio."""
    uom: str | None
    client_id: UUID | None
    lot: str | None
    expires_at: date | None


class LocationContentOut(ApiModel):
    location_id: UUID
    location_code: str
    lines: list[StockLineOut]
    occupied: bool


class PalletHitOut(ApiModel):
    location_id: UUID | None
    location_code: str
    pallet_code: str | None
    sku: str | None
    description: str | None
    qty: float | None
    uom: str | None
    lot: str | None
    expires_at: date | None
    taken_at: datetime


class SkuHitOut(ApiModel):
    location_id: UUID | None
    location_code: str
    lines: int
    qty: float | None
    description: str | None
    pallets: int
    first_expiry: date | None


class FindOut(ApiModel):
    by: Literal["pallet", "sku"]
    term: str
    hits: list[PalletHitOut] | list[SkuHitOut]


class MismatchOut(ApiModel):
    location_id: UUID
    location_code: str
    wms_situation: str | None
    spatial_status: str
    lines: int
    units: float | None
    mismatch: str
    """`dice_ocupado_sin_stock`, `dice_libre_con_stock` o `bloqueado_con_stock`."""


class OrphanStockOut(ApiModel):
    location_code: str
    lines: int
    pallets: int
    units: float | None


class MismatchReportOut(ApiModel):
    counts: dict[str, int]
    """Recuento por tipo, sobre el TOTAL. Contar la lista de abajo daria un numero
    menor que el real, porque esta acotada."""
    total: int
    listed: list[MismatchOut]
    truncated: bool
    orphan_stock: list[OrphanStockOut]
    orphan_lines: int
    """Lineas de stock cuyo codigo de ubicacion no existe en el catalogo. No se
    descartan al importar: son la discrepancia entre los dos sistemas."""


# ── Percepción: trabajos de inferencia y detecciones (0069) ────────────────
#
# Un trabajo es «corre este modelo sobre este medio». Lo que la API acepta y lo que
# devuelve no son la misma forma, y no por descuido: al crear se manda el medio
# COMPLETO —porque puede no existir todavía— y al leer viene ya resuelto, con el
# número de transiciones y si los bytes están disponibles.
#
# `worker_available` viaja en todas las respuestas de listado y detalle. Es `false`
# hoy: no hay ningún worker registrado. Callarlo dejaría al operador esperando a que
# una cola avance sola.


class MediaPrepareIn(ApiModel):
    """Reservar sitio en el bucket para subir un medio.

    No crea ninguna fila: devuelve dónde subir. Una fila de medio sin bytes es basura
    si la subida se abandona a medias —y se abandona, con 400 MB por la red de un
    almacén—, así que el registro ocurre al crear el trabajo.
    """

    warehouse_id: UUID
    original_filename: str = Field(..., min_length=1, max_length=500)
    content_type: str = Field(..., min_length=3, max_length=100)
    bytes: int = Field(..., gt=0)


class MediaPrepareOut(ApiModel):
    media_id: UUID
    """Se genera en el SERVIDOR porque la ruta se deriva de él. Hay que devolverlo al
    crear el trabajo: entonces el servidor recalcula la misma ruta y comprueba que el
    objeto esté, así que no hay forma de subir a un sitio y reclamar otro."""
    bucket: str
    object_path: str
    upload_url: str
    """Donde el cliente hace el POST del binario, con su propio token. Los bytes NO
    atraviesan el backend: 400 MB por el proceso web para reenviarlos gastarían
    memoria del servidor sin añadir nada."""


class MediaDownloadOut(ApiModel):
    """URL firmada del medio de un trabajo. La pide el worker de inferencia."""

    url: str
    expires_in: int


class MediaIn(ApiModel):
    """El medio a analizar. Los bytes NO pasan por aquí, solo sus metadatos.

    `sha256` es obligatorio y lo calcula quien sube: es lo que hace idempotente
    registrar el mismo vídeo dos veces, que es lo que pasa cuando la conexión se
    corta a mitad de una subida.
    """

    kind: Literal["image", "video"]
    original_filename: str = Field(..., min_length=1, max_length=500)
    content_type: str = Field(..., min_length=3, max_length=100)
    bytes: int = Field(..., gt=0)
    sha256: str = Field(..., pattern=r"^[0-9a-f]{64}$")
    width: int | None = Field(None, gt=0, le=100000)
    height: int | None = Field(None, gt=0, le=100000)
    duration_ms: int | None = Field(None, gt=0)
    total_frames: int | None = Field(None, gt=0)
    source: Literal["uploaded-file", "demo"] = "uploaded-file"
    media_id: UUID | None = None
    """El que devolvió `prepare`, si los bytes se subieron.

    Nulo es legítimo y es lo que había antes de 0076: un medio registrado solo por
    metadatos. La diferencia se nota cuando el worker intenta descargarlo y dice que
    no hay bytes que analizar, en vez de fallar sin explicación."""


class JobCreateIn(ApiModel):
    warehouse_id: UUID
    name: str = Field(..., min_length=1, max_length=200)
    media: MediaIn
    pipeline: Literal["object-detection", "ocr", "detection-ocr"]
    model_version_id: UUID | None = None
    """Nulo mientras no haya ninguna version publicada. Si se manda una que no lo
    esta, se rechaza: un trabajo que apunta a un modelo que nadie declaro utilizable
    no se podria ejecutar y nadie sabria por que."""
    confidence_threshold: float = Field(0.5, ge=0, le=1)
    frame_sampling_rate: float | None = Field(None, gt=0, le=120)
    save_detected_frames: bool = True
    notes: str | None = Field(None, max_length=2000)


class JobStatusIn(ApiModel):
    """Mover el estado. La transicion la valida el disparador de 0069."""

    to_status: Literal["queued", "running", "cancelled", "failed", "completed"]
    reason: str | None = Field(None, max_length=2000)


class JobEventOut(ApiModel):
    id: int
    from_status: str | None
    to_status: str
    occurred_at: datetime
    reason: str | None


class ClassCountOut(ApiModel):
    class_name: str
    n: int
    confianza_media: float | None
    casadas: int


class JobOut(ApiModel):
    id: UUID
    warehouse_id: UUID
    name: str
    status: str
    pipeline: str
    model_version_id: UUID | None
    model_label: str | None
    """Copia del nombre y version del modelo AL CORRER. Un JOIN daria el nombre de
    hoy, que puede no ser el que produjo estas detecciones."""
    confidence_threshold: float
    frame_sampling_rate: float | None
    save_detected_frames: bool
    notes: str | None
    frames_processed: int
    frames_total: int | None
    """`None` en un directo: no se sabe cuantos son, asi que la pantalla CUENTA en vez
    de calcular un porcentaje. Ver 0078."""
    detection_count: int
    elapsed_ms: int
    error_message: str | None
    queued_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    media_id: UUID
    media_kind: str
    media_filename: str
    media_content_type: str
    media_bytes: int
    media_sha256: str | None
    """`None` en un directo: no hay contenido que hashear. El CHECK
    `chk_media_identidad` de 0078 lo ata al tipo, asi que en un archivo sigue siendo
    obligatorio."""
    media_stream_url: str | None = None
    """De donde lee el worker en un directo. `None` en archivos."""
    media_width: int | None
    media_height: int | None
    media_duration_ms: int | None
    media_total_frames: int | None
    media_source: str
    media_available: bool
    """Si los bytes existen. Sin esto el reproductor abre una ruta nula delante de
    quien mira."""
    event_count: int
    events: list[JobEventOut] = []
    class_counts: list[ClassCountOut] = []
    worker_available: bool = False


class JobListOut(ApiModel):
    jobs: list[JobOut]
    worker_available: bool


class DetectionIn(ApiModel):
    """Una detección tal como la deja el worker.

    `observed_at` es CUÁNDO se captó el fotograma, no cuándo llega: es la clave de
    partición, y con la hora de llegada las 8.000 detecciones de un vuelo caerían en
    el mismo segundo y en la misma partición.
    """

    observed_at: datetime
    frame_number: int = Field(0, ge=0)
    frame_ms: int | None = Field(None, ge=0)
    frame_ref: str | None = Field(None, max_length=1000)
    class_name: str = Field(..., min_length=1, max_length=100)
    class_color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    confidence: float = Field(..., ge=0, le=1)
    bbox_x: float
    bbox_y: float
    bbox_width: float = Field(..., gt=0)
    bbox_height: float = Field(..., gt=0)
    bbox_format: Literal["pixels", "normalized"] = "normalized"
    text_value: str | None = Field(None, max_length=200)
    """El texto LEIDO por OCR. Si casa con un codigo de rack, esta deteccion se puede
    promover a observacion y de ahi sale la ruta sobre el plano."""
    is_manual: bool = False
    """Detección añadida por una PERSONA: el falso negativo. Se marca porque una
    detección a mano con confianza 1 sería, midiendo, la predicción más segura del
    sistema."""


class DetectionIngestIn(ApiModel):
    detections: list[DetectionIn] = Field(..., max_length=5000)
    replace: bool = True
    """Borra las anteriores del trabajo. Es lo que hace seguro reprocesar: sin ello
    el segundo intento sumaria sus detecciones a las del primero."""
    mark_completed: bool = True


class DetectionOut(ApiModel):
    id: UUID
    job_id: UUID
    observed_at: datetime
    ingested_at: datetime
    frame_number: int
    frame_ms: int | None
    frame_ref: str | None
    class_name: str
    ai_class_id: UUID | None
    class_color: str | None
    confidence: float
    bbox_x: float
    bbox_y: float
    bbox_width: float
    bbox_height: float
    bbox_format: str
    text_value: str | None
    state: str
    """`unmatched` (sin caducidad: senala una discrepancia abierta), `matched`,
    `discarded` o `superseded`."""
    rack_node_id: UUID | None
    review_status: str
    reviewed_at: datetime | None
    review_comment: str | None
    supersedes_id: UUID | None
    is_manual: bool


class DetectionPageOut(ApiModel):
    items: list[DetectionOut]
    total: int
    page: int
    page_size: int


class FrameOut(ApiModel):
    frame_number: int
    frame_ms: int | None
    frame_ref: str | None
    detections: list[DetectionOut]
    """Vacio significa «el modelo lo miro y no vio nada», que es informacion. Por eso
    un fotograma sin detecciones no es un 404."""


class DetectionIngestOut(ApiModel):
    inserted: int
    deleted: int
    job: JobOut


class ReviewDecisionIn(ApiModel):
    detection_id: UUID
    observed_at: datetime
    """Hace falta porque la clave de la tabla es `(observed_at, id)`: sin el, buscar
    el id recorreria las 25 particiones."""
    status: Literal["accepted", "rejected", "corrected"]
    is_false_positive: bool = False
    comment: str | None = Field(None, max_length=2000)


class ReviewIn(ApiModel):
    decisions: list[ReviewDecisionIn] = Field(..., min_length=1, max_length=500)


class ReviewOut(ApiModel):
    applied: int
    not_found: list[str]
    """Las que no se encontraron se REPORTAN. Revisar 40 y aplicar 38 sin decir
    cuales fallaron hace creer que se reviso algo que no se reviso."""


class PublishedModelOut(ApiModel):
    model_version_id: UUID
    model_id: UUID
    version: int
    origin: str
    published_at: datetime | None
    name: str
    slug: str
    task: str
    input_type: str
    architecture_code: str | None
    architecture_name: str | None
    framework_code: str | None
    classes: list[dict[str, Any]]
    """Nombre, indice y color de cada clase. Un modelo sin sus clases es un
    desplegable que no dice que va a detectar."""


class ModelCatalogOut(ApiModel):
    models: list[PublishedModelOut]
    worker_available: bool
    unavailable_reason: str | None


class PromoteIn(ApiModel):
    """Promover las detecciones de un trabajo a observaciones de rack (0067)."""

    source_code: str = Field(..., min_length=1, max_length=40)
    """Codigo de la fuente: el dispositivo o el recorrido. Se reutiliza si ya existe,
    porque el segundo vuelo de DRONE-01 no debe partir su historial en dos."""
    source_kind: Literal["drone", "phone", "fixed_camera", "forklift", "manual"] = "drone"


class UnresolvedTextOut(ApiModel):
    text: str
    readings: int


class PromoteOut(ApiModel):
    source_code: str
    source_id: UUID | None = None
    candidates: int
    observations_created: int
    matched: int
    unresolved: list[UnresolvedTextOut]
    """Codigos leidos que el catalogo no conoce. NO se corrigen ni se aproximan:
    «RCL104» y «RCL1O4» se diferencian en un caracter, y adivinar convertiria un
    error de lectura en un dato."""


class UnmatchedTextRowOut(ApiModel):
    text_value: str
    lecturas: int
    confianza_max: float | None
    primera: datetime
    ultima: datetime
    trabajos: int


class UnmatchedReportOut(ApiModel):
    items: list[UnmatchedTextRowOut]
    total_readings: int

# ── Reconciliación con el WMS (0064 + 0069) ───────────────────────────────
class ReconcileIn(ApiModel):
    """Convertir las detecciones de un trabajo en lecturas de inventario."""

    source: Literal["drone", "video", "handheld"] = "drone"
    """Con qué se capturó. `manual` y `seed` no se aceptan aquí: describen recorridos
    que no salen de un trabajo de inferencia."""
    notes: Annotated[str, Field(max_length=2000)] | None = None


class ReconcileRowOut(ApiModel):
    location_code: str | None
    location_qr: str
    content: str
    pallet_qr: str
    pallet_code_observed: str | None
    expected_rows: int | None
    """Cuántas líneas de stock declara el WMS en ese hueco. `None` si no hay corte."""
    expected_pallet: str | None
    wms_expects_pallet: bool
    status: str
    """La clasificación de 0064: `verified_empty`, `unexpected_empty`,
    `unexpected_pallet`, `pallet_mismatch`, `location_qr_unreadable`…"""
    observed_at: datetime


class ReconcileCountOut(ApiModel):
    status: str
    cuantas: int


class ReconcileOut(ApiModel):
    scan_id: UUID
    wms_snapshot_id: UUID | None
    warning: str | None
    """Sin corte del WMS las lecturas se guardan pero no hay con qué compararlas. Se
    dice: una reconciliación vacía sin explicación se lee como «todo cuadra»."""
    detections: int
    readings: int
    empty_frames: int
    """Fotogramas que no vieron ni hueco ni carga. No producen lectura."""
    unknown_classes: list[str]
    """Clases que el modelo detectó y el puente no sabe interpretar."""
    summary: list[ReconcileCountOut]
    rows: list[ReconcileRowOut]


# ── Sesiones en directo (0078) ────────────────────────────────────────────
class LiveStartIn(ApiModel):
    """Abrir un directo sobre una cámara o un emisor RTMP.

    No hay archivo que subir, así que no hay `prepare`/`confirm`: la sesión nace ya en
    cola y un worker la coge.
    """

    warehouse_id: UUID
    name: Annotated[str, Field(min_length=1, max_length=200)]
    stream_url: Annotated[str, Field(min_length=8, max_length=500)]
    """De dónde se leen los fotogramas: `rtmp://`, `rtsp://` o `http(s)://` con HLS.

    El esquema lo valida el servicio, no este esquema: la lista de esquemas admitidos es
    una decisión de seguridad —un `file://` haría que el worker leyera su propio disco
    creyendo abrir una cámara— y su sitio es el servicio, con su motivo escrito al lado.
    """
    pipeline: Literal["object-detection", "ocr", "detection-ocr"]
    model_version_id: UUID | None = None
    confidence_threshold: float = Field(0.5, ge=0, le=1)
    frame_sampling_rate: float = Field(2.0, gt=0, le=120)
    """Fotogramas por segundo a analizar. OBLIGATORIO en un directo, a diferencia de un
    archivo: sin muestreo, el worker intentaría analizar los 25 o 30 fps que entrega la
    cámara y se quedaría atrás para siempre, con la latencia creciendo sin techo."""
    notes: Annotated[str, Field(max_length=2000)] | None = None


class LiveProgressIn(ApiModel):
    """El progreso de un lote, mientras el directo corre. Lo manda el worker.

    Son INCREMENTOS, no acumulados: el worker informa de lo que acaba de procesar, y el
    servidor suma. Mandar el total obligaría al worker a llevar la cuenta y dos workers
    sobre el mismo trabajo se pisarían.
    """

    frames: int = Field(..., ge=0)
    #  SOLO fotogramas. Las detecciones NO viajan aqui: las cuenta `POST /detections`,
    #  que sabe exactamente cuantas inserto.
    #
    #  Este campo existia y las contaba DOS VECES —una al ingerirlas y otra aqui—, asi
    #  que el trabajo declaraba el doble de las que habia. Medido: 6 en el contador y 3
    #  en la base. Un campo que el cliente tiene que mandar siempre a cero es una trampa,
    #  asi que se quita en vez de documentarse.


class LiveProgressOut(ApiModel):
    frames_processed: int
    detection_count: int


# ── Registro de workers (0075) ────────────────────────────────────────────
class WorkerHeartbeatIn(ApiModel):
    """El latido de un worker.

    Un solo endpoint para registrarse y para latir: son la misma operación vista dos
    veces. Un worker que arranca no sabe si ya tenía fila —puede venir de un reinicio—
    y obligarle a consultarlo antes abriría una carrera entre la consulta y el
    registro. El `ON CONFLICT` de 0075 lo absorbe.
    """

    kind: Literal["inference", "training"]
    #: El nombre de la máquina. `(tenant, kind, name)` es lo que identifica al worker,
    #: así que un reinicio del mismo proceso refresca su fila en vez de crear otra.
    name: Annotated[str, Field(min_length=1, max_length=120)]
    #: Qué sabe hacer: `pipeline`s en inferencia, frameworks en entrenamiento.
    capabilities: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=20
    )
    agent_version: Annotated[str, Field(max_length=40)] | None = None
    #: `cuda:0`, `cpu`, `mps`. Cuando un trabajo salga mal, la primera pregunta va a
    #: ser con qué se procesó.
    device: Annotated[str, Field(max_length=40)] | None = None
    #: En qué trabajo está ahora, si está en alguno. Informativo: la autoridad sobre
    #: el estado de un trabajo es el trabajo.
    current_job: UUID | None = None


class WorkerOut(ApiModel):
    id: UUID
    kind: str
    name: str
    capabilities: list[str]
    agent_version: str | None
    device: str | None
    registered_at: datetime
    last_seen_at: datetime
    current_job: UUID | None
    alive: bool
    """Latido dentro de la ventana de 90 s. Ver `core.worker_esta_vivo()` en 0075."""
    seconds_since: int


class WorkerListOut(ApiModel):
    workers: list[WorkerOut]
    #: Cuántos están vivos AHORA. Es la cifra que decide si la cola va a avanzar.
    alive: int

