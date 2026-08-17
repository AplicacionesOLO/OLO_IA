"""Esquemas de petición y respuesta.

Solo estructura y validación de forma: las reglas de negocio están en el
dominio y en la base. Estos modelos existen para rechazar entrada malformada
antes de que llegue a la lógica.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class LocationInspectionOut(ApiModel):
    """El estado OBSERVADO de un hueco, frente a lo que el WMS declara.

    ── PARA QUÉ ES ────────────────────────────────────────────────────────────

    Para la capa «Inspección» del visor 3D, que estaba dibujada desde 0067 y nunca tuvo
    datos: el mapa enseñaba el catálogo y la ocupación DECLARADA, y lo que la cámara había
    visto se quedaba en una tabla de otra pantalla.

    Los dos códigos viajan juntos y sin mezclarse —`observed_pallet_code` es lo que se
    leyó, `expected_pallets` lo que el sistema dice que debería haber— porque la
    comparación entre ambos ES el producto. Resumirlos en un único «coincide / no
    coincide» dejaría al operador sin poder ver CUÁL es el pallet que sobra.
    """

    location_id: UUID
    location_code: str | None
    observed_pallet_code: str | None
    """Lo que la cámara leyó. `None` si había bulto y no se pudo identificar, o si no
    había nada."""
    expected_pallets: list[str] = []
    """Todos los códigos que el WMS declara en ese hueco. Puede haber varios."""
    status: str
    """La clasificación de `v_reconciliation`. Mismo vocabulario que la reconciliación."""
    content: str
    """Qué se vio: `pallet`, `object_no_qr`, `empty`, `obstructed`, `unknown`."""
    confidence: float | None
    """La del CONTENIDO. Es la que responde «¿cuánto me fío de que ahí hay eso?»; la del
    código leído no aplica cuando no se leyó ninguno."""
    observed_at: datetime
    scan_id: UUID
    """De qué recorrido viene. Permite abrir la reconciliación completa desde el mapa."""

    frame_ms: int | None = None
    """Milisegundo del vídeo del que salió. Permite saltar el material justo ahí."""

    rack_id: UUID | None = None
    bay_index: int | None = None
    level: int | None = None
    position: int | None = None
    """DÓNDE cae el hueco en la rejilla del rack: cuerpo, nivel y posición.

    Es lo que permite al plano pintar la celda exacta cuando se amplía. El código dice
    `C018`, pero los cuerpos de un rack no son contiguos —21 con códigos propios—, así que
    deducir el índice sería inventarlo."""

    crop_location_url: str | None = None
    crop_content_url: str | None = None
    crop_pallet_url: str | None = None

    crop_location_ms: int | None = None
    crop_content_ms: int | None = None
    crop_pallet_ms: int | None = None
    """El instante del video del que salio CADA recorte.

    Los tres NO son del mismo fotograma: cada eje elige su mejor deteccion por separado y
    una escena abarca varios fotogramas. Medido en un recorrido real, una lectura tenia la
    etiqueta en el ms 233, el contenido en el 1.167 y el QR del pallet en el 700 — casi un
    segundo, que a la velocidad del dron es otro sitio del rack—.

    Sin esto las tres imagenes se leen como una foto del mismo momento y no lo son."""
    """LA PRUEBA VISUAL (0091): los tres recortes, uno por eje.

    Son las imágenes de las TRES detecciones que esta lectura usó para decidir —la etiqueta
    del hueco, lo que hay dentro, la etiqueta del pallet—, no unas parecidas del mismo sitio.
    Eso es lo que las hace prueba: si la lectura dice un pallet y la imagen enseña otra
    etiqueta, el fallo se ve sin volver al vídeo.

    URLs FIRMADAS de una hora, no rutas: se firman al pedirlas. Guardar la firma sería
    guardar basura con fecha — a la segunda visita daría 403 sin decir por qué.

    `None` cuando el análisis es anterior a 0091, cuando la casilla de guardar fotogramas
    estaba apagada, o cuando el objeto ya no está."""


class RackCoverageOut(ApiModel):
    """Cuanto se ha mirado de UN rack, y cuando por ultima vez."""

    rack_id: UUID
    rack_code: str
    locations: int
    inspected: int
    mismatched: int = 0
    """Huecos de ese rack que contradicen al WMS.

    Va aparte de `inspected` porque son preguntas distintas: uno dice cuánto se ha mirado
    y el otro cuánto de lo mirado está mal. Un rack entero inspeccionado y sin una sola
    discrepancia y otro con tres se pintarían igual con un solo número."""
    last_seen_at: datetime | None


class InspectionCoverageOut(ApiModel):
    """CUANTO del almacén se ha mirado, y CUÁNDO.

    ── POR QUÉ ESTE NÚMERO VA DELANTE ────────────────────────────────────────

    Porque sin él, «cero discrepancias» significa dos cosas a la vez —«todo cuadra» y «no
    has mirado»— y son la conclusión contraria. Un mapa con el 99,99 % en gris y un
    resumen que no lo dice se lee como un almacén sano.

    La FECHA va con el porcentaje y no aparte: un almacén inspeccionado al 100 % hace tres
    meses no está inspeccionado, está fotografiado.
    """

    warehouse_id: UUID
    locations: int
    inspected: int
    racks_total: int
    racks_inspected: int
    mismatched: int = 0
    """Huecos que contradicen al WMS en todo el almacén."""
    last_seen_at: datetime | None
    racks: list[RackCoverageOut] = []
    """Solo los racks CON algo visto. Los demás son la resta."""


class InspectionChangeOut(ApiModel):
    """Qué ve el último recorrido de un hueco frente a lo que vio el anterior.

    ── POR QUÉ ESTO NO ES UN INFORME MÁS ─────────────────────────────────────

    «Hay un pallet que el WMS no declara» es un hallazgo. «Sigue ahí tres vuelos después»
    es otra cosa: dice que nadie lo está arreglando. Y un hueco que discrepaba y ya no
    discrepa es la prueba barata de que el trabajo sirvió.

    Sin esto, cada recorrido es una foto suelta y el producto no tiene memoria.
    """

    location_id: UUID
    location_code: str | None
    verdict: str
    """`resuelto`, `persiste`, `nuevo` o `cambio`. Lo que sigue cuadrando no aparece: una
    lista de cambios donde casi todo dice «igual» no se lee dos veces."""
    status_now: str
    content_now: str
    pallet_now: str | None
    seen_now: datetime
    scan_now: UUID
    status_before: str
    content_before: str
    pallet_before: str | None
    seen_before: datetime
    scan_before: UUID


class WarehouseMetricsOut(ApiModel):
    """Las medidas REALES de un almacén, o de una familia de racks (0092).

    Todo opcional y todo `None` hasta que alguien lo mida. Rellenarlo con «valores típicos»
    sería una cifra inventada presentada como medida — el defecto que el panel de inicio ya
    tuvo una vez.
    """

    id: UUID
    warehouse_id: UUID
    rack_family: str | None
    """`None` son las medidas por defecto del almacén; un prefijo las sustituye para esos
    racks. Las familias no miden igual: RCL tiene 2 posiciones por cuerpo y MZ tiene 1."""

    pallet_width_m: float | None = None
    pallet_depth_m: float | None = None
    pallet_height_m: float | None = None
    slot_width_m: float | None = None
    slot_height_m: float | None = None
    slot_depth_m: float | None = None
    bay_width_m: float | None = None
    level_height_m: float | None = None
    rack_height_m: float | None = None
    rack_depth_m: float | None = None
    upright_width_m: float | None = None
    beam_height_m: float | None = None
    aisle_width_m: float | None = None
    aisle_length_m: float | None = None

    double_deep: bool | None = None
    """Si el hueco guarda dos tarimas, una detrás de otra. HOY no se usa para nada, y aun
    así se guarda: la cámara solo ve la de delante, así que sin este dato «vacío
    inesperado» es un falso positivo sistemático en esos racks."""

    notes: str | None = None

    slot_volume_m3: float | None = None
    pallet_volume_m3: float | None = None
    """DERIVADOS, no guardados: un volumen almacenado se queda viejo en cuanto alguien
    corrige una de las tres medidas."""

    medidas_tomadas: int = 0
    """Cuántas de las 14 están medidas. Permite decir «faltan 9» en vez de enseñar una
    tabla de huecos sin explicar nada."""

    updated_at: datetime


class WarehouseMetricsIn(ApiModel):
    """Lo que se manda al medir. Solo los campos presentes se tocan.

    Parcial a propósito: mandar el objeto entero obligaría a reenviar las trece medidas
    para corregir una, y el primer despiste borraría las demás.
    """

    rack_family: Annotated[str, Field(max_length=20)] | None = None
    pallet_width_m: Annotated[float, Field(gt=0, le=100)] | None = None
    pallet_depth_m: Annotated[float, Field(gt=0, le=100)] | None = None
    pallet_height_m: Annotated[float, Field(gt=0, le=100)] | None = None
    slot_width_m: Annotated[float, Field(gt=0, le=100)] | None = None
    slot_height_m: Annotated[float, Field(gt=0, le=100)] | None = None
    slot_depth_m: Annotated[float, Field(gt=0, le=100)] | None = None
    bay_width_m: Annotated[float, Field(gt=0, le=100)] | None = None
    level_height_m: Annotated[float, Field(gt=0, le=100)] | None = None
    rack_height_m: Annotated[float, Field(gt=0, le=100)] | None = None
    rack_depth_m: Annotated[float, Field(gt=0, le=100)] | None = None
    upright_width_m: Annotated[float, Field(gt=0, le=100)] | None = None
    beam_height_m: Annotated[float, Field(gt=0, le=100)] | None = None
    aisle_width_m: Annotated[float, Field(gt=0, le=100)] | None = None
    aisle_length_m: Annotated[float, Field(gt=0, le=1000)] | None = None
    double_deep: bool | None = None
    notes: Annotated[str, Field(max_length=2000)] | None = None

    def medidas(self) -> dict[str, object]:
        """Solo lo que se mandó. `exclude_unset` distingue «no lo toqué» de «lo borré»."""
        datos = self.model_dump(exclude_unset=True)
        datos.pop("rack_family", None)
        return datos


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
    group_key: str | None = Field(None, min_length=1, max_length=40)
    """Los racks que comparten esta clave se MUEVEN JUNTOS.

    El caso que lo motiva es el rack doble —dos racks de espaldas, con los frentes
    opuestos— donde mover uno sin el otro lo partiria por la mitad. Vale para cualquier
    conjunto, y lo declara quien modela: el catalogo no dice hacia donde mira un rack, y los
    codigos son consecutivos por importacion, no por parejas.

    `min_length=1` para que una cadena vacia se rechace AQUI, con nombre de campo, en vez de
    llegar al `CHECK` de 0096 como un error de integridad."""

    facing: Literal[-1, 1] | None = None
    """La CARA operativa del rack: la que da al pasillo y por la que se saca el palet.

    Es un lado del marco LOCAL del rack, no un rumbo del almacen: `+1` es la cara larga en
    `x = +ancho/2` y `-1` la de `x = -ancho/2`. Guardarla como rumbo la dejaria mintiendo en
    cuanto alguien rotase el rack; guardada asi, el gemelo de un rack doble —que se modela
    girado 180 grados— sale con la cara contraria usando el MISMO valor.

    `None` es SIN DECLARAR, y no es lo mismo que un valor por defecto. El catalogo no trae la
    cara y no se puede deducir, asi que mientras nadie la declare el visor sigue pintando las
    dos, que es lo que hacia antes de 0097. Un valor por defecto haria que cada rack afirmase
    una cara que nadie ha comprobado y no habria forma de distinguirla de una declarada.

    `Literal[-1, 1]` y no `int`: un `0` o un `2` los pararia el CHECK de la base como error
    de integridad, y aqui salen con 400 y nombre de campo.
    """

    @field_validator("group_key")
    @classmethod
    def _grupo_con_contenido(cls, v: str | None) -> str | None:
        """Una clave de solo espacios se RECHAZA; no se convierte en «suelto».

        `min_length=1` no la para: `'   '` mide tres. Y el repositorio la normalizaba a
        `NULL`, asi que la peticion salia 200 y el rack se quedaba sin grupo.

        Eso se midio: al publicar las 30 colocaciones con `'   '` en la primera, la respuesta
        fue 200 y en la base quedo `RCL21 -> NULL` con `RCL22 -> g-RCL21-RCL22`. Media pareja
        desagrupada, un grupo de uno, y ni un aviso. Quien envia espacios queria enviar una
        clave; devolver 200 le hace creer que el rack doble sigue entero.
        """
        if v is None:
            return None
        limpio = v.strip()
        if not limpio:
            raise ValueError(
                "la clave del grupo no puede ser solo espacios; para dejar el rack suelto, "
                "omite el campo o envia null"
            )
        return limpio


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
    group_key: str | None
    facing: int | None
    """La cara operativa, o `null` si nadie la ha declarado. Ver `RackPlacementIn.facing`.

    `int` y no `Literal[-1, 1]`: de salida se refleja lo que hay en la fila. Si algun dia
    apareciera otro valor —una migracion futura, una escritura a mano— esto tiene que poder
    contarlo, no reventar con un 500 al serializar. El CHECK de la base es quien lo impide.
    """

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

    @model_validator(mode="after")
    def _sin_grupos_de_uno(self) -> LayoutPublishIn:
        """Un grupo con un solo miembro se rechaza: no existe «moverse junto a nadie».

        Solo se puede comprobar aqui, porque hace falta ver la lista COMPLETA — y publicar
        siempre envia el conjunto entero, asi que la cuenta es la definitiva, no un delta.

        Importa porque 0096 defendio la clave en la propia colocacion diciendo que asi no
        quedan grupos huerfanos que alguien tenga que limpiar. Un grupo de uno es exactamente
        ese huerfano: no hace nada, no se ve en pantalla, y quien mire la base creera que al
        rack le falta la pareja. Aparecio de verdad al desagrupar media pareja sin querer.
        """
        cuenta: dict[str, int] = {}
        for p in self.placements:
            if p.group_key:
                cuenta[p.group_key] = cuenta.get(p.group_key, 0) + 1
        solos = sorted(k for k, n in cuenta.items() if n < 2)
        if solos:
            raise ValueError(
                "estos grupos tienen un solo rack y no agrupan nada: "
                + ", ".join(solos)
                + "; agrupa al menos dos o deja los racks sueltos"
            )
        return self


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


class ZoneOut(ApiModel):
    """Una zona por nomenclatura: el prefijo alfabetico del codigo de rack.

    `prefijo` nulo es el grupo de huecos que no cuelgan de ningun rack. No se filtra:
    esos huecos existen y estan en el almacen, pero no hay prefijo con el que acotarlos.
    """

    prefijo: str | None = None
    racks: int
    huecos: int
    ocupados: int
    bloqueados: int


class MismatchReportOut(ApiModel):
    warehouse_total: int = 0
    """Descuadres del almacen ENTERO, sin filtros. Con una zona puesta se separa de
    `total`, y sin el, filtrar parece haber resuelto el problema."""

    counts: dict[str, int]
    """Recuento por tipo, sobre el TOTAL. Contar la lista de abajo daria un numero
    menor que el real, porque esta acotada."""
    total: int
    listed: list[MismatchOut]
    truncated: bool
    """Con paginacion significa «hay mas paginas», no «esto esta recortado»."""
    page: int = 1
    page_size: int = 50
    pages: int = 1
    filtered_total: int = 0
    """Cuantos descuadres hay con el filtro puesto. Es sobre esto que se pagina, no
    sobre `total`: con una clase elegida, paginar sobre el global daria paginas vacias."""
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

    archived_at: datetime | None = None
    """Archivada: fuera de la lista, el rastro se queda. **No libera Storage** — es el
    precio de conservar lo que cuelga de ella, y la pantalla lo dice."""


class JobListOut(ApiModel):
    jobs: list[JobOut]
    worker_available: bool

    archived_count: int = 0
    """Cuantas archivadas se estan dejando fuera. Va SIEMPRE: esconderlas sin decir
    cuantas son se lee como si no existieran, que es el mismo error que ya se corrigio
    en el registro de auditoria y en las tablas no auditadas."""


class JobDeletableOut(ApiModel):
    """Si una inspeccion se puede borrar, y si no, por que no.

    Se devuelven los TRES recuentos y no solo el veredicto: un «no se puede» a secas
    deja a quien lo lee con la misma pregunta con la que llego.
    """

    borrable: bool
    archivada: bool

    incidencias: int = 0
    """Incidencias abiertas desde esta inspeccion. Alguien fue al pasillo por esto."""

    promovidas: int = 0
    """Detecciones convertidas en observaciones de rack. Las observaciones NO guardan
    el id del trabajo, asi que borrarlo las dejaria afirmando venir de una inspeccion
    que ya no existe."""

    revisadas: int = 0
    """Detecciones aceptadas, rechazadas o corregidas por una persona. Horas de
    trabajo que nadie puede reconstruir."""


class JobDeletedOut(ApiModel):
    """Que se libero de verdad al borrar."""

    storage_liberado: int
    """Bytes que salieron de Storage. **0 si el objeto no se pudo borrar** o si el
    medio estaba compartido: se dice en vez de callarlo, porque el motivo de borrar es
    justamente hacer sitio."""

    medio_compartido: bool
    """El mismo archivo respaldaba otra inspeccion —`uq_media_hash` deduplica por
    hash—, asi que sus bytes NO se tocaron: borrarlos dejaria a la otra sin material."""

    bytes_del_medio: int
    """Lo que ocupaba, incluso cuando no se libero. Sin esto, un `storage_liberado: 0`
    no dice si el archivo era de 2 KB o de 400 MB."""


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

    crop_path: str | None = Field(None, max_length=1000)
    """Ruta en `perception-media` del recorte de esta detección (0091).

    La sube el worker mientras analiza, que es el único momento en que los píxeles son
    gratis: tiene el fotograma de 8K decodificado. Hacerlo después obligaría a descargar el
    vídeo entero y volver a buscar el instante — y el vídeo se puede haber borrado.

    Es la RUTA y no una URL: las firmadas caducan en una hora, así que guardar una sería
    guardar basura con fecha."""
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
    crop_path: str | None = None
    """Ruta del recorte de ESTA deteccion en `perception-media` (0091).

    La RUTA, no una URL firmada: firmar 500 recortes para pintar las cajas de un video
    seria medio segundo de firmas que nadie mira. Quien necesite la imagen la pide por el
    hueco, que devuelve las tres firmadas.

    Se declara porque el repositorio la devuelve desde 0091 y `ApiModel` prohibe los
    campos de mas: sin esto, `GET /jobs/{id}/detections` respondia 500 a TODA peticion y
    el video se quedaba sin una sola caja.
    """
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

    weights_asset_id: UUID | None = None
    """El asset con el checkpoint entrenado. **El worker lo NECESITA**: sin el cae al
    RF-DETR preentrenado de COCO y analiza con un detector que no conoce lo que hay en un
    almacen. Se midio en el primer arranque real."""

    weights_object_path: str | None = None
    """La ruta en `ai-assets`. Publicarla no abre nada: ese bucket exige platform owner
    en sus cuatro politicas (0045), asi que la ruta sin firma no descarga nada. Va aqui
    porque el worker comprueba las DOS cosas antes de intentar la descarga."""

    ai_project_id: UUID | None = None
    """El proyecto de IA del modelo. Hace falta para mandar fotogramas de una inspeccion
    a su dataset: las imagenes de entrenamiento cuelgan de un proyecto, y la pantalla de
    Vision solo conoce el modelo. Sin esto habria que adivinarlo, y en cuanto haya dos
    proyectos los fotogramas acabarian en el dataset equivocado. Expuesto en 0089."""


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
    matched_locations: int = 0
    """De las casadas, cuantas resolvieron contra un HUECO concreto y no solo contra el
    rack. Es la diferencia entre «se vio algo en el rack 47» y «se leyo el hueco
    RCL47-C018-N01-2», y la pantalla tiene que poder decirlo.

    Antes no existia porque no podia: la reconciliacion solo casaba codigos de rack, asi que
    una lectura completa no resolvia nunca."""

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
    location_id: UUID | None
    """El hueco del catálogo, cuando la lectura se pudo atribuir a uno.

    Va en el contrato para que la pantalla pueda llevar al mapa y abrir una incidencia
    atada al hueco de verdad. Un código se puede leer mal; el id no."""
    location_code: str | None
    location_qr: str
    content: str
    pallet_qr: str
    pallet_code_observed: str | None
    expected_rows: int | None
    """Cuántas líneas de stock declara el WMS en ese hueco. `None` si no hay corte."""
    expected_pallet: str | None
    """El código declarado, SOLO cuando el WMS declara una única línea."""
    expected_pallets: list[str] = []
    """Todos los códigos que el WMS declara en ese hueco.

    Hace falta porque `expected_pallet` viene a `None` en cuanto hay dos líneas, y entonces
    la pantalla decía «2 línea(s)» sin nombrar ninguna: justo lo que el operador necesita
    para decidir si el pallet que tiene delante sobra o está mal registrado."""
    wms_expects_pallet: bool
    status: str
    """La clasificación de la vista: `verified_empty`, `unexpected_empty`,
    `unexpected_pallet`, `verified_match`, `location_unknown`, `location_qr_unreadable`…"""
    observed_at: datetime


class ReconcileIncidentsOut(ApiModel):
    """Qué salió de convertir un recorrido en trabajo.

    Los tres números van juntos porque solos engañan. «1 incidencia creada» de un
    recorrido de 8 lecturas no dice si el vuelo fue bien; «1 de 1 accionable, de 8
    lecturas» sí. Y `skipped` distingue «no había nada» de «ya estaba abierto», que es la
    diferencia entre un almacén sano y uno donde nadie cierra lo que se abre.
    """

    scan_id: UUID
    created: int
    skipped: int
    """Huecos que ya tenían una incidencia abierta. No es un error: reconciliar dos veces
    el mismo vuelo es normal."""
    skipped_locations: list[str] = []
    incident_ids: list[UUID] = []
    actionable_rows: int
    """Cuántas lecturas del recorrido eran discrepancias. Lo que no se pudo VER no cuenta:
    pide volver a grabar, no ir al pasillo."""
    total_rows: int


class ReconcileCountOut(ApiModel):
    status: str
    cuantas: int


class ReconcileOut(ApiModel):
    scan_id: UUID
    wms_snapshot_id: UUID | None
    warning: str | None
    """Sin corte del WMS las lecturas se guardan pero no hay con qué compararlas. Se
    dice: una reconciliación vacía sin explicación se lee como «todos los slots correctos»."""
    detections: int
    readings: int
    empty_frames: int

    ambiguous_scenes: int = 0
    """Escenas donde se leyeron VARIOS huecos y el bulto abarcaba a los dos, asi que no se
    pudo decir de cual era. No es un fallo del modelo: es un encuadre demasiado cerca. Se
    cuenta y se dice, porque la respuesta es volver a grabar con mas campo, no revisar filas.

    En el almacen las etiquetas de los slots van una encima de otra en el mismo montante, asi
    que la camara las ve a la vez con mucha facilidad."""

    discarded_texts: int = 0
    """Textos leidos que se descartaron por no tener forma de codigo: ruido del OCR.

    Se cuenta y se dice porque es un diagnostico y no un detalle: si son muchos, el recorrido
    no tiene pocas etiquetas, tiene un problema de lectura — y antes ese ruido entraba como
    codigo LEIDO. Medido en un recorrido de prueba: 40 de 80 lecturas afirmaban haber leido
    un hueco que no existia."""
    """Fotogramas que no vieron ni hueco ni carga. No producen lectura."""
    unknown_classes: list[str]
    """Clases que el modelo detectó y el puente no sabe interpretar."""

    unknown_locations: list[str] = []
    """Etiquetas de hueco que se leyeron BIEN y que el catálogo del almacén no tiene.

    No es ruido —el ruido no tiene cuatro segmentos— ni un fallo de captura: es una etiqueta
    física que ningún sistema del almacén conoce. Viaja aparte porque pide una acción propia:
    dar de alta esa ubicación o corregir la etiqueta del montante.

    Y porque tiene una segunda consecuencia que la pantalla debe poder explicar: un código
    así ya no se lleva la atribución de lo que se filme después. Medido en un recorrido real,
    `RACK26-C036-N01-1` se quedaba con un pallet que estaba en `RCL47-C018-N01-2`."""
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


class MediaFrameCountIn(ApiModel):
    """Cuantos fotogramas tiene el video. Lo manda el worker, que es quien lo sabe.

    El navegador conoce la duracion y las medidas al subir, pero NO el recuento: no hay API
    que lo diga. El worker si, porque los recorre todos para analizarlos.

    Importa para mandar fotogramas a anotar: con el recuento y la duracion sale la cadencia
    real del material, y sin ella el numero de fotograma habia que derivarlo a 25 fps por
    convencion —para un video de 59,7 fps decia 151 donde el fotograma era el 360—.
    """

    total_frames: int = Field(..., gt=0)


class MediaFrameCountOut(ApiModel):
    media_id: UUID
    total_frames: int
    cambio: bool
    """Si esta llamada cambio algo. Es `false` cuando el recuento ya estaba anotado, que es
    lo normal a partir del segundo analisis del mismo video."""


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



class ClusterCreateIn(ApiModel):
    """Crear una zona. Nace vacia: los miembros se añaden despues."""

    name: Annotated[str, Field(min_length=1, max_length=80)]
    notes: Annotated[str, Field(max_length=2000)] | None = None


class ClusterMemberIn(ApiModel):
    """Un prefijo de nomenclatura O un rack concreto, nunca los dos.

    El prefijo sobrevive a que se añadan racks nuevos; el rack suelto es la unica forma
    de trocear `RCL`, que son 27.090 de los 29.312 huecos y donde el prefijo no
    distingue nada.
    """

    prefix: Annotated[str, Field(max_length=24)] | None = None
    rack_id: UUID | None = None


class ClusterMemberOut(ApiModel):
    id: UUID
    prefix: str | None = None
    rack_id: UUID | None = None
    rack_code: str | None = None


class ClusterOut(ApiModel):
    id: UUID
    name: str
    notes: str | None = None
    racks: int = 0
    huecos: int = 0
    ocupados: int = 0
    libres: int = 0
    bloqueados: int = 0
    ocupacion_pct: float | None = None


# ── FIGURAS 3D (0093) ────────────────────────────────────────────────────────
#
# El plano dibuja racks y nada mas. Un almacen no es una estanteria: para juzgar si un
# pasillo da o si el dron pasa entre dos hileras hace falta ver, A ESCALA, las cosas que se
# mueven. Y eso no se dibuja con cajas — una persona son 1,70 m de algo reconocible—.


class AssetPrepareIn(ApiModel):
    original_filename: str = Field(min_length=1, max_length=200)
    content_type: str = Field(min_length=3, max_length=100)
    bytes: int = Field(gt=0)
    for_platform: bool = False
    """Si va a la biblioteca COMUN. Solo el Platform Owner puede."""


class AssetPrepareOut(ApiModel):
    model_id: UUID
    bucket: str
    object_path: str
    upload_url: str
    """Donde el cliente hace el POST del binario, CON SU PROPIO token.

    Los bytes no atraviesan el backend: un `.glb` de 60 MB pasando por el proceso web solo
    para reenviarlo gastaria memoria sin añadir nada. Mismo criterio que el video."""


class AssetRegisterIn(ApiModel):
    model_id: UUID
    original_filename: str = Field(min_length=1, max_length=200)
    content_type: str = Field(min_length=3, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(min_length=1, max_length=24)
    license: str = Field(min_length=1, max_length=60)
    """OBLIGATORIA. Servir un modelo CC-BY sin el credito que su licencia pide es
    incumplir, no un descuido estetico — y esto es un SaaS multi-tenant—."""
    attribution: str | None = Field(None, max_length=2000)
    source_url: str | None = Field(None, max_length=1000)
    byte_count: int | None = Field(None, ge=0)
    size_x_m: float | None = Field(None, gt=0)
    size_y_m: float | None = Field(None, gt=0)
    size_z_m: float | None = Field(None, gt=0)
    """Las medidas del modelo, en metros, medidas al subirlo.

    Un `.glb` no declara su unidad: glTF dice metros, pero Blender saca centimetros y un
    CAD milimetros. Una persona de 170 m junto a un rack de 12 hace inservible el plano."""
    scale: float = Field(1, gt=0, le=1000)
    notes: str | None = Field(None, max_length=2000)
    for_platform: bool = False


class AssetOut(ApiModel):
    id: UUID
    tenant_id: UUID | None
    """`None` es la biblioteca de la PLATAFORMA, que todos ven."""
    name: str
    kind: str
    glb_url: str | None
    thumb_url: str | None
    """URLs FIRMADAS de una hora, no rutas. Guardar la firma seria guardar basura con
    fecha: a la segunda visita daria 403 sin decir por que."""
    byte_count: int | None
    size_x_m: float | None
    size_y_m: float | None
    size_z_m: float | None
    scale: float
    license: str
    attribution: str | None
    source_url: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    version: int


class AssetPlaceIn(ApiModel):
    model_id: UUID
    x_m: float
    y_m: float
    """En METROS y en el mismo sistema que los racks. No en pixeles: el pixel depende de la
    calibracion, y una figura colocada antes de calibrar se moveria despues."""
    z_m: float = Field(0, ge=0, le=200)
    """Altura sobre el suelo. Un dron a 6 m es el caso que da sentido a esta columna."""
    rotation_deg: float = 0
    scale: float = Field(1, gt=0, le=1000)
    label: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=2000)


class AssetMoveIn(ApiModel):
    """Solo lo que cambia. Mandar el objeto entero obligaria a reenviar la posicion para
    corregir una etiqueta, y el primer despiste moveria la figura."""

    x_m: float | None = None
    y_m: float | None = None
    z_m: float | None = Field(None, ge=0, le=200)
    rotation_deg: float | None = None
    scale: float | None = Field(None, gt=0, le=1000)
    label: str | None = Field(None, max_length=120)
    notes: str | None = Field(None, max_length=2000)


class AssetInstanceOut(ApiModel):
    id: UUID
    warehouse_id: UUID
    model_id: UUID
    x_m: float
    y_m: float
    z_m: float
    rotation_deg: float
    scale: float
    label: str | None
    notes: str | None
    model_name: str
    model_kind: str
    model_scale: float
    """La escala del MODELO. La del plano se multiplica por esta: un mismo modelo puede
    aparecer a dos tamaños sin subirlo dos veces."""
    model_size_y_m: float | None
    glb_url: str | None
    thumb_url: str | None
    created_at: datetime
    updated_at: datetime
    version: int


# ── RECORRIDOS (0094) ────────────────────────────────────────────────────────
#
# Un recorrido produce un NUMERO —«340 m, 4 min 50 s»— que cambia cuando se mueve un rack.
# La distancia se calcula en el navegador, donde esta la geometria: los metros de un hueco
# salen de cruzar su estructura logica con la colocacion del rack.


class TripStopIn(ApiModel):
    location_id: UUID
    operation: str = Field("pasar", max_length=16)
    dwell_s: float = Field(0, ge=0, le=3600)
    notes: str | None = Field(None, max_length=500)


class TripStopsIn(ApiModel):
    """La lista ENTERA. Se reemplaza, no se parchea: lo que se edita es el orden."""

    stops: list[TripStopIn]


class TripStopOut(ApiModel):
    id: UUID
    trip_id: UUID
    seq: int
    """El orden, que lo pone el SERVIDOR por la posicion en la lista: asi no hay forma de
    mandar dos paradas con el mismo orden ni huecos en la numeracion."""
    operation: str
    dwell_s: float
    notes: str | None
    location_id: UUID
    location_code: str | None
    rack_node_id: UUID | None
    """El rack al que pertenece. Es lo que permite situar la parada en metros: sin el, la
    parada no se puede colocar en el plano y la simulacion la salta diciendolo."""
    bay_index: int | None
    level: int | None
    position: int | None
    created_at: datetime
    updated_at: datetime
    version: int


class TripIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    model_id: UUID | None = None
    """Que figura lo hace. Opcional: un recorrido se puede medir antes de decidirlo."""
    speed_mps: float = Field(1.2, gt=0, le=30)
    """En metros por segundo. 1,2 es el paso de una persona cargando; 2,5 un montacargas."""
    notes: str | None = Field(None, max_length=2000)


class TripPatchIn(ApiModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    model_id: UUID | None = None
    speed_mps: float | None = Field(None, gt=0, le=30)
    notes: str | None = Field(None, max_length=2000)


class TripOut(ApiModel):
    id: UUID
    warehouse_id: UUID
    name: str
    model_id: UUID | None
    speed_mps: float
    notes: str | None
    stops: list[TripStopOut] = []
    created_at: datetime
    updated_at: datetime
    version: int


class TripListItemOut(ApiModel):
    id: UUID
    warehouse_id: UUID
    name: str
    model_id: UUID | None
    speed_mps: float
    notes: str | None
    stop_count: int
    """Cuantas paradas tiene. Va en la LISTA porque es lo que distingue un recorrido a medio
    escribir de uno completo sin tener que abrirlo."""
    created_at: datetime
    updated_at: datetime
    version: int
