/**
 * DTO — la forma EXACTA que devuelve el backend.
 *
 * Verificados contra el OpenAPI publicado en `/openapi.json`, no adivinados. La
 * version anterior de este archivo se escribio antes de que el backend
 * existiera y pedia campos que el catalogo del WMS no trae —ocupacion,
 * coordenadas metricas, `last_verified_at`, `dimensions`—; el contrato completo
 * y el motivo de cada ausencia estan en `docs/SPATIAL_API_CONTRACT.md`.
 *
 * Los nombres van en snake_case a proposito: son del backend. La traduccion a
 * camelCase ocurre en `mappers.ts`, en un solo sitio.
 */

// ── Envoltorios ─────────────────────────────────────────────────────────────

/**
 * Metadatos de pagina. `total` y `total_pages` son `null` salvo que se pida
 * `with_total=true`: contar 29.310 filas en cada pagina de una navegacion por
 * cursor es trabajo que nadie pidio.
 *
 * `null` significa **no se conto**. Un `0` significaria «no hay nada», y
 * confundir las dos cosas produce una tabla que dice «0 resultados» sobre 29.310
 * filas.
 */
export interface PageMetaDto {
  next_cursor: string | null;
  page_size: number;
  page: number | null;
  total: number | null;
  total_pages: number | null;
}

// ── 1 · Almacenes y resumen ─────────────────────────────────────────────────

/**
 * `GET /v1/spatial/warehouses` y `.../summary` devuelven LA MISMA forma. No hay
 * un DTO de almacen mas pobre para el selector: el selector muestra recuentos.
 *
 * NO existe `occupied_count`. La migracion 0059 lo elimino al comprobar que
 * solapaba con `available_count` y `blocked_count` —los tres sumaban 45.174
 * sobre 29.312— y que la ocupacion no es una propiedad del espacio (SPA-11).
 */
export interface WarehouseSummaryDto {
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  site_count: number;
  aisle_count: number;
  rack_count: number;
  bay_count: number;
  location_count: number;
  /** `available_count + blocked_count === location_count`, siempre. */
  available_count: number;
  blocked_count: number;
  inferred_count: number;
  opaque_count: number;
  /**
   * Histograma COMPLETO del vocabulario del WMS: `{"OCUP": 15862, "BLOQ": 5500,
   * …}`. Vocabulario abierto, asi que es un mapa y no columnas fijas. Suma
   * `location_count`.
   *
   * El prefijo `wms_` dice de donde viene: es lo que declaro el archivo de
   * origen en su fecha de exportacion, NO ocupacion viva.
   */
  wms_situation_counts: Record<string, number>;
  /**
   * Ubicaciones donde `location_status` y `location_situation` se contradicen.
   * 2.365 en el catalogo real: el WMS de origen las tiene asi. Es el primer dato
   * que hay que mirar antes de fiarse de cualquiera de las dos columnas.
   */
  status_situation_conflicts: number;
  /** El WMS declaro «sin limite» (26.244 en el catalogo real). */
  capacity_unlimited_count: number;
  /** El WMS no dijo nada de capacidad (727). Distinto del anterior. */
  capacity_unknown_count: number;
  /** Cuanto falta para el gemelo metrico. 0 hasta el importador CAD. */
  with_world_geometry: number;
  last_import_at: string | null;
  total_rows_rejected: number | null;
}

// ── 2 · Nodos y arbol ───────────────────────────────────────────────────────

export interface SpatialNodeDto {
  node_id: string;
  parent_node_id: string | null;
  /** `rack` | `bay` | `storage_area` | … Vocabulario cerrado del backend. */
  node_type: string;
  node_function: string | null;
  /** Etiqueta legible: «Almacenaje», no `ALMREP`. */
  function_label: string | null;
  node_code: string;
  external_code: string | null;
  name: string | null;
  logical_index: number | null;
  site_id: string | null;
  /** Si este tipo de nodo puede sostener ubicaciones. */
  can_hold_locations: boolean;
  /** Evita una peticion por nodo solo para saber si se puede expandir. */
  child_count: number;
  location_count: number;
}

export interface SpatialTreeNodeDto extends SpatialNodeDto {
  /** Profundidad ya calculada, para que el cliente no recorra el camino. */
  depth: number;
}

// ── 3 · Plano de planta ─────────────────────────────────────────────────────

/**
 * Una fila por rack: 348 en lugar de 29.310.
 *
 * ⚠ `min_logical_x` … `max_logical_y` son INDICES LOGICOS, no metros
 * (invariante TWN-07). Con ellos se puede dibujar una rejilla topologica —que
 * rack esta al lado de cual— pero **no un plano a escala**. La geometria
 * metrica esta al 100% NULL en la base; el plano visual lo aporta el layout
 * local mientras la capacidad `floorGeometry` sea `false`.
 */
export interface FloorPlanCellDto {
  rack_id: string;
  rack_code: string;
  rack_external_code: string | null;
  rack_index: number | null;
  rack_node_type: string;
  node_function: string | null;
  function_label: string | null;
  aisle_id: string | null;
  aisle_code: string | null;
  site_id: string | null;
  bay_count: number;
  location_count: number;
  available_count: number;
  blocked_count: number;
  inferred_count: number;
  bulk_count: number;
  wms_situation_counts: Record<string, number>;
  status_situation_conflicts: number;
  min_logical_x: number | null;
  max_logical_x: number | null;
  min_logical_y: number | null;
  max_logical_y: number | null;
  max_level: number | null;
}

// ── 4 · Alzado de un rack ───────────────────────────────────────────────────

export interface RackFrontCellDto {
  location_id: string;
  bay_id: string;
  /** `C018`, ya compuesto: el cliente no formatea el indice. */
  bay_code: string;
  bay_index: number;
  level: number | null;
  position: number | null;
  full_code: string;
  external_code: string | null;
  /** Vocabulario CERRADO del espacio: `available` | `blocked`. */
  location_status: string;
  /** Vocabulario ABIERTO del WMS: `DISP`, `OCUP`, `BLOQ`, `BLOQES`, … */
  location_situation: string | null;
  is_bulk_area: boolean;
  origin: string;
  max_weight_kg: number | null;
  max_units: number | null;
}

/** El alzado con sus dimensiones ya resueltas: el cliente no hace `max()`. */
export interface RackFrontViewDto {
  rack_id: string;
  rack_code: string;
  rack_external_code: string | null;
  node_function: string | null;
  function_label: string | null;
  bay_count: number;
  max_level: number | null;
  max_position: number | null;
  cells: RackFrontCellDto[];
}

// ── 5 · Ubicaciones ─────────────────────────────────────────────────────────

/**
 * Contrato plano: CERO parseo en el cliente.
 *
 * Cada componente de la direccion viaja como campo propio (ADR-013). Un cliente
 * que tenga que hacer `full_code.split('-')` es un cliente al que le hemos
 * pasado nuestro problema.
 */
export interface LocationDto {
  location_id: string;
  warehouse_id: string;
  warehouse_code: string;
  site_id: string | null;
  site_code: string | null;
  /** Siempre `null` hoy: no se inventan pasillos (ADR-013). */
  aisle_id: string | null;
  aisle_code: string | null;
  rack_id: string | null;
  rack_code: string | null;
  rack_external_code: string | null;
  rack_index: number | null;
  bay_id: string | null;
  bay_code: string | null;
  bay_index: number | null;
  level: number | null;
  position: number | null;
  /**
   * Columna logica de la UBICACION. Coincide con `bay_index` en las 29.310
   * filas importadas, pero no es el mismo campo: `bay_index` es el indice del
   * cuerpo padre, y una ubicacion puede colgar de un rack sin cuerpo.
   */
  logical_column: number | null;
  full_code: string;
  /** Valor ORIGINAL del WMS, exacto: `DAÑADO-C001-N01-1`, `PHA LO-C001-N01-1`. */
  external_code: string | null;
  external_location_id: string | null;
  /**
   * `structured` | `opaque`. Al `opaque` NO se le aplica el parser
   * estructurado, y por eso `level`/`position` pueden ser `null`: un cliente que
   * asuma que siempre vienen se rompe con la primera ubicacion especial.
   */
  code_form: string;
  location_type: string;
  /** `available` | `blocked`. Vocabulario cerrado y verificado por CHECK. */
  location_status: string;
  /** Vocabulario abierto del WMS. Historico, con la fecha del archivo. */
  location_situation: string | null;
  is_bulk_area: boolean;
  /** `catalog` | `inferred` | `manual`. */
  origin: string;
  max_weight_kg: number | null;
  max_units: number | null;
  /**
   * Distingue los DOS motivos por los que `max_weight_kg` puede ser `null`:
   *   `true`  → el WMS declaro «sin limite» (26.244 ubicaciones)
   *   `false` → el WMS no dijo nada (727 ubicaciones)
   *
   * Antes de la migracion 0058 ambos casos eran el mismo `null` indistinguible.
   * Operativamente no son lo mismo: la primera se puede usar, la segunda hay
   * que ir a medirla.
   */
  capacity_declared_unlimited: boolean;
  node_function: string | null;
  function_label: string | null;
  implies_bulk: boolean | null;
  /** Indices logicos, NO metros (TWN-07). */
  logical_x: number | null;
  logical_y: number | null;
  logical_z: number | null;
}

// ── 6 · Parametros de consulta ──────────────────────────────────────────────

/**
 * ⚠ `cursor` y `page` NO se pueden enviar juntos: el backend responde 422. Son
 * dos formas de decir donde empezar y juntas no significan nada.
 */
export interface LocationsQuery {
  warehouse_id?: string | undefined;
  rack_id?: string | undefined;
  bay_id?: string | undefined;
  status?: string | undefined;
  situation?: string | undefined;
  code_form?: string | undefined;
  level?: number | undefined;
  /** Prefijo, no substring: `MZ01` encuentra, `Z01` no. */
  search?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  page?: number | undefined;
  with_total?: boolean | undefined;
}

// ── 7 · Layout publicado ────────────────────────────────────────────────────
//
// `GET/PUT/DELETE /v1/spatial/warehouses/{id}/layout`. Correspondencia exacta con
// `LayoutOut` del backend, verificada contra `/openapi.json`.
//
// Todo esta en METROS. Los pixeles del plano solo aparecen en `plan_*_px` y en el
// origen, que son propiedades de la IMAGEN, no del almacen: describen sobre que
// dibujo se midio la escala, no donde estan los racks.

/** El espacio de trabajo: sobre que plano y con que escala. */
export interface WarehouseLayoutDto {
  id: string;
  warehouse_id: string;
  /** Nombre del archivo del plano. El backend NO guarda la imagen. */
  plan_name: string | null;
  plan_width_px: number | null;
  plan_height_px: number | null;
  pixels_per_meter: number;
  origin_x_px: number;
  origin_y_px: number;
  /**
   * Si `pixels_per_meter` se MIDIO. `false` significa que es el valor por defecto
   * de dibujo, asi que las posiciones estan en una escala arbitraria: se pueden
   * mirar, no medir.
   */
  is_calibrated: boolean;
  published_at: string;
  published_by: string | null;
  updated_at: string;
}

/** Donde esta un rack, en metros respecto al origen del layout. */
export interface PlacementDto {
  rack_node_id: string;
  x_m: number;
  y_m: number;
  /** [0,360). 360 no se acepta: es 0, y dos formas de decir lo mismo. */
  rotation_deg: number;
  width_m: number;
  length_m: number;
  height_m: number;
  /** `#rrggbb` o `null` para el color por defecto. */
  color: string | null;
  is_locked: boolean;
}

/** Lo que devuelve leer: la colocacion mas el codigo del rack, ya resuelto. */
export interface PlacementOutDto extends PlacementDto {
  id: string;
  rack_code: string;
  node_type: string;
  node_function: string | null;
  updated_at: string;
}

export interface PublishedLayoutDto {
  /** `null` cuando el almacen no tiene plano publicado. NO es un error. */
  layout: WarehouseLayoutDto | null;
  placements: PlacementOutDto[];
  /** Racks guardados en esta publicacion. `null` al leer: no se publico nada. */
  published: number | null;
  /** Si el layout publicado estaba calibrado. `null` al leer. */
  calibrated: boolean | null;
  /**
   * Ubicaciones a las que se les calculo la posicion metrica en esta publicacion.
   *
   * Es lo que hace util el layout mas alla de mirarlo: de aqui salen el visor 3D y
   * el seguimiento de la flota. `0` cuando se publico sin calibrar; `null` al leer,
   * porque leer no publica nada.
   */
  derived_locations: number | null;
}

/** Cuerpo del PUT: el estado COMPLETO, no un delta. */
export interface PublishLayoutBody {
  plan_name: string | null;
  plan_width_px: number | null;
  plan_height_px: number | null;
  pixels_per_meter: number;
  origin_x_px: number;
  origin_y_px: number;
  is_calibrated: boolean;
  placements: PlacementDto[];
}

// ── 8 · Observaciones y rutas (0067) ────────────────────────────────────────
//
// Una observacion es un hecho atomico: «la fuente S vio el rack R a las T». La RUTA
// no se envia ni se guarda: se DERIVA uniendo las observaciones ordenadas con la
// colocacion en metros de los racks.
//
// `x_m`/`y_m` de un punto son del RACK, no de la fuente. Se sabe que la fuente
// estuvo lo bastante cerca para verlo; donde estaba exactamente NO se sabe, y
// dibujarlo como su posicion seria fabricar telemetria.

/** Vocabulario CERRADO: cada valor cambia como se lee la serie temporal. */
export type ObservationSourceKind =
  | 'drone'
  | 'phone'
  | 'fixed_camera'
  | 'forklift'
  | 'manual';

export interface ObservationSourceDto {
  id: string;
  warehouse_id: string;
  code: string;
  name: string;
  kind: ObservationSourceKind;
  clock_skew_ms: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ObservationInDto {
  rack_node_id: string;
  /** ISO. Cuando se VIO, segun el dispositivo. No es la hora de llegada. */
  observed_at: string;
  confidence?: number | null;
  frame_ref?: string | null;
  frame_ms?: number | null;
  notes?: string | null;
}

export interface ObservationBatchDto {
  source_code: string;
  source_name?: string | null;
  /** Solo hace falta la primera vez: si la fuente no existe, se registra con el. */
  source_kind?: ObservationSourceKind | null;
  observations: ObservationInDto[];
}

export interface IngestResultDto {
  source: ObservationSourceDto;
  received: number;
  /** Las NUEVAS. Reintentar un lote ya subido devuelve 0, no un error. */
  stored: number;
  duplicates: number;
}

export interface RoutePointDto {
  observation_id: string;
  source_id: string;
  source_code: string;
  source_name: string;
  source_kind: ObservationSourceKind;
  rack_node_id: string;
  rack_code: string;
  observed_at: string;
  confidence: number | null;
  frame_ref: string | null;
  frame_ms: number | null;
  /** Metros. Del RACK observado, no de la fuente. */
  x_m: number;
  y_m: number;
  rotation_deg: number;
  /** Orden dentro del recorrido, de 1 a N. Lo calcula la vista, no el cliente. */
  paso: number;
}

export interface RouteDto {
  source_id: string;
  source_code: string;
  source_name: string;
  source_kind: ObservationSourceKind;
  /** `false` para una camara fija: no dibuja recorrido, es un centinela. */
  forms_path: boolean;
  points: RoutePointDto[];
  point_count: number;
  distinct_racks: number;
  /**
   * Suma de las RECTAS entre racks observados consecutivos. Cota INFERIOR del
   * recorrido real, no odometria: entre dos observaciones la fuente pudo dar la
   * vuelta al pasillo.
   */
  straight_line_distance_m: number;
  duration_s: number | null;
  /** `null` sin tiempo transcurrido: devolver 0 la habria inventado. */
  avg_speed_ms: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

export interface RoutesDto {
  /** Una polilinea POR FUENTE. Aplanarlas produciria un zigzag que nadie recorrio. */
  routes: RouteDto[];
  truncated: boolean;
  max_points: number;
}

export interface ObservationDto {
  observation_id: string;
  source_id: string;
  source_code: string;
  source_kind: ObservationSourceKind;
  rack_node_id: string;
  rack_code: string;
  observed_at: string;
  ingested_at: string;
  confidence: number | null;
  frame_ref: string | null;
  frame_ms: number | null;
  notes: string | null;
  /** Si el rack esta colocado. Si no, la observacion NO sale en la ruta. */
  rack_colocado: boolean;
}

export interface ObservationCoverageDto {
  total: number;
  racks_vistos: number;
  fuentes: number;
  /** Observaciones de racks sin colocar: existen y no salen en la ruta. */
  sin_colocar: number;
  primera: string | null;
  ultima: string | null;
}

// ── 9 · Inventario y ocupación (0068) ───────────────────────────────────────
//
// El catalogo dice DONDE esta cada hueco; el snapshot del WMS dice QUE tiene. La
// ocupacion es la union, y se DERIVA: no hay ningun campo `ocupado` guardado.
//
// Todo esto es de SOLO LECTURA. El WMS es el sistema de origen y esto es su espejo:
// la unica escritura es importar una foto nueva, y eso se hace por fuera de la API.

export interface SnapshotDto {
  snapshot_id: string;
  /** Cuando se TOMO la foto, no cuando se subio. */
  taken_at: string;
  received_at: string;
  source: string;
  row_count: number;
  notes: string | null;
}

export interface SnapshotHistoryDto extends SnapshotDto {
  /** `ready`, `loading` o `failed`. Las fallidas se muestran a proposito. */
  status: string;
  external_ref: string | null;
}

export interface InventorySummaryDto {
  /** `null` cuando nadie ha importado inventario. NO es un error. */
  snapshot: SnapshotDto | null;
  locations: number;
  occupied: number;
  free: number;
  /** `null` sin foto: la ocupacion es DESCONOCIDA, no 0 %. */
  occupancy_pct: number | null;
  units: number | null;
  pallets: number | null;
  taken_at: string | null;
  first_expiry: string | null;
}

export interface RackOccupancyDto {
  rack_id: string;
  rack_code: string;
  node_function: string | null;
  locations: number;
  occupied: number;
  free: number;
  /** `null` si el rack no tiene huecos: «vacio» y «sin sitio» son cosas distintas. */
  occupancy_pct: number | null;
  units: number | null;
  pallets: number | null;
  blocked: number;
  first_expiry: string | null;
}

export interface RackOccupancyListDto {
  snapshot: SnapshotDto | null;
  racks: RackOccupancyDto[];
}

export interface LocationOccupancyDto {
  location_id: string;
  location_code: string;
  level: number | null;
  spatial_status: string;
  wms_situation: string | null;
  lines: number;
  occupied: boolean;
  pallets: number;
  skus: number;
  clients: number;
  units: number | null;
  first_expiry: string | null;
}

export interface StockLineDto {
  id: string;
  location_id: string | null;
  location_code: string;
  pallet_code: string | null;
  sku: string | null;
  description: string | null;
  /** `null` es «el reporte no lo dice»; `0` es «cantidad cero», que el WMS produce. */
  qty: number | null;
  uom: string | null;
  client_id: string | null;
  lot: string | null;
  expires_at: string | null;
}

export interface LocationContentDto {
  location_id: string;
  location_code: string;
  lines: StockLineDto[];
  occupied: boolean;
}

export interface PalletHitDto {
  location_id: string | null;
  location_code: string;
  pallet_code: string | null;
  sku: string | null;
  description: string | null;
  qty: number | null;
  uom: string | null;
  lot: string | null;
  expires_at: string | null;
  taken_at: string;
}

export interface SkuHitDto {
  location_id: string | null;
  location_code: string;
  lines: number;
  qty: number | null;
  description: string | null;
  pallets: number;
  first_expiry: string | null;
}

export interface FindDto {
  by: 'pallet' | 'sku';
  term: string;
  hits: PalletHitDto[] | SkuHitDto[];
}

export interface MismatchDto {
  location_id: string;
  location_code: string;
  wms_situation: string | null;
  spatial_status: string;
  lines: number;
  units: number | null;
  /** `dice_ocupado_sin_stock`, `dice_libre_con_stock` o `bloqueado_con_stock`. */
  mismatch: string;
}

export interface OrphanStockDto {
  location_code: string;
  lines: number;
  pallets: number;
  units: number | null;
}

export interface MismatchReportDto {
  /** Recuento sobre el TOTAL: contar `listed` daria menos, porque esta acotada. */
  counts: Record<string, number>;
  total: number;
  listed: MismatchDto[];
  truncated: boolean;
  orphan_stock: OrphanStockDto[];
  orphan_lines: number;
}

/**
 * El estado observado de un hueco, tal cual llega de
 * `GET /v1/spatial/warehouses/{id}/inspection`.
 *
 * Los dos codigos viajan sin mezclarse —lo LEIDO y lo DECLARADO— porque la comparacion
 * entre ambos es lo que el mapa tiene que poder ensenar.
 */
export interface LocationInspectionDto {
  location_id: string;
  location_code: string | null;
  observed_pallet_code: string | null;
  expected_pallets: string[];
  status: string;
  content: string;
  confidence: number | null;
  observed_at: string;
  scan_id: string;
  frame_ms?: number | null;
  crop_location_ms?: number | null;
  crop_content_ms?: number | null;
  crop_pallet_ms?: number | null;
  crop_location_url?: string | null;
  crop_content_url?: string | null;
  crop_pallet_url?: string | null;
  rack_id?: string | null;
  bay_index?: number | null;
  level?: number | null;
  position?: number | null;
}

/** Cobertura de inspeccion, tal cual llega del backend. */
export interface InspectionCoverageDto {
  warehouse_id: string;
  locations: number;
  inspected: number;
  racks_total: number;
  racks_inspected: number;
  last_seen_at: string | null;
  mismatched: number;
  racks: {
    rack_id: string;
    rack_code: string;
    locations: number;
    inspected: number;
    mismatched: number;
    last_seen_at: string | null;
  }[];
}

/** Qué cambió en un hueco entre los dos últimos recorridos que lo vieron. */
export interface InspectionChangeDto {
  location_id: string;
  location_code: string | null;
  verdict: string;
  status_now: string;
  content_now: string;
  pallet_now: string | null;
  seen_now: string;
  scan_now: string;
  status_before: string;
  content_before: string;
  pallet_before: string | null;
  seen_before: string;
  scan_before: string;
}
