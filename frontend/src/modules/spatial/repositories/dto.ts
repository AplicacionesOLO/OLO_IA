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
