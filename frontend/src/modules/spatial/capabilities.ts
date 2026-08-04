/**
 * CAPACIDADES DEL BACKEND SPATIAL
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NO UN SOLO BOOLEANO
 *
 * `VITE_SPATIAL_BACKEND=true` obligaba a una decision de todo o nada, y el
 * backend real no es todo o nada: publica el catalogo espacial completo (347
 * racks, 2.701 cuerpos, 29.310 ubicaciones) y NO publica geometria metrica ni
 * ocupacion, porque esos datos no existen todavia en la base.
 *
 * Con un booleano global solo habia dos salidas malas:
 *   · activarlo  → las pantallas de plano y ocupacion se rompen o mienten
 *   · no activarlo → el catalogo real sigue oculto detras de datos simulados
 *
 * Con capacidades, cada pantalla pregunta por lo que necesita.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Lo que el backend puede servir, capacidad por capacidad. */
export interface SpatialCapabilities {
  /** GET /v1/spatial/warehouses */
  warehouses: boolean;
  /** GET /v1/spatial/warehouses/{id}/summary */
  summary: boolean;
  /** GET /v1/spatial/warehouses/{id}/tree · GET /v1/spatial/nodes/{id}/children */
  tree: boolean;
  /** GET /v1/spatial/locations */
  locations: boolean;
  /** GET /v1/spatial/locations/{id} */
  locationDetail: boolean;
  /** GET /v1/spatial/racks/{id}/front-view */
  rackFront: boolean;

  /**
   * Geometria METRICA de los racks: x/y en metros, rotacion, dimensiones.
   *
   * `false`, y no por falta de trabajo: `world_position`, `world_footprint` y
   * `world_bbox` estan al 100% NULL en la base, y el resumen lo expone como
   * `with_world_geometry: 0`. El catalogo del WMS no trae geometria; llegara con
   * el importador CAD.
   *
   * Lo que SI hay son indices logicos (`min_logical_x`…). No son metros, y
   * llamarlos `x` es exactamente como se acaba dibujando un plano falso que
   * parece correcto. Mientras esta capacidad sea `false`, el plano visual lo
   * aporta el LAYOUT LOCAL, no el backend.
   */
  floorGeometry: boolean;

  /**
   * Ocupacion EN VIVO. Sigue siendo `false`, y ahora por un motivo mas fino.
   *
   * Desde 0068 la ocupacion SI existe: sale de cruzar la foto del WMS con el
   * catalogo, y es la que pinta el mapa de calor. Pero es una FOTO FECHADA, no un
   * dato vivo: entre importacion e importacion el almacen se mueve y esta cifra no.
   *
   * Ponerla en `true` afirmaria que el numero de la pantalla es el de este momento,
   * y quien decidiera un hueco con eso podria encontrarlo lleno. Para ser vivo
   * harian falta los MOVIMIENTOS a medida que ocurren —entradas, salidas,
   * reubicaciones—, que es un bloque que no existe.
   *
   * Historia: la migracion 0059 elimino `occupied_count` de las vistas espaciales
   * al comprobar que solapaba con `available_count` y `blocked_count` —los tres
   * sumaban 45.174 sobre 29.312 ubicaciones—. La leccion se mantiene: la ocupacion
   * no es una propiedad del espacio —un estante no sabe lo que tiene encima— sino
   * del inventario, y por eso vive en su propio esquema y se DERIVA (SPA-11/SPA-12,
   * regla R3 del ADR-009).
   */
  liveOccupancy: boolean;

  /**
   * Existencias, pallets, articulos: el bloque de inventario, en solo lectura.
   *
   * `true` desde 0068. Siete endpoints sobre la foto vigente del WMS: resumen,
   * ocupacion por rack, ocupacion por hueco, contenido de un hueco, buscar un
   * pallet o un articulo, descuadres e historico de fotos.
   *
   * Que sea `true` NO significa que se pueda escribir. El WMS es el sistema de
   * origen y esto es su espejo: la unica escritura es importar una foto nueva.
   */
  inventory: boolean;
}

/**
 * Capacidades del backend a fecha de hoy, verificadas contra los endpoints
 * publicados y probadas con 29 pruebas de integracion sobre datos reales.
 *
 * Cambiar un `false` a `true` sin que exista el dato detras es la unica forma de
 * que este archivo empeore las cosas: la UI dejaria de preguntar y empezaria a
 * suponer.
 */
export const SPATIAL_CAPABILITIES: SpatialCapabilities = {
  warehouses: true,
  summary: true,
  tree: true,
  locations: true,
  locationDetail: true,
  rackFront: true,
  floorGeometry: false,
  liveOccupancy: false,
  inventory: true,
};

/**
 * Sobrescritura por entorno, SOLO para bajar capacidades, nunca para subirlas.
 *
 * `VITE_SPATIAL_DISABLE=floorGeometry,rackFront` permite probar los estados sin
 * datos sin tocar codigo. La direccion es deliberada: activar una capacidad
 * inexistente por variable de entorno produciria pantallas que mienten en el
 * entorno de quien la puso, y solo ahi.
 */
export function resolveCapabilities(
  base: SpatialCapabilities = SPATIAL_CAPABILITIES,
  disabled: string = import.meta.env.VITE_SPATIAL_DISABLE ?? '',
): SpatialCapabilities {
  if (!disabled) return base;
  const off = new Set(
    disabled.split(',').map((s) => s.trim()).filter(Boolean),
  );
  const out = { ...base };
  for (const key of Object.keys(out) as (keyof SpatialCapabilities)[]) {
    if (off.has(key)) out[key] = false;
  }
  return out;
}

/** Motivo legible de por que una capacidad no esta disponible. */
export const CAPABILITY_REASON: Record<keyof SpatialCapabilities, string> = {
  warehouses: 'El listado de almacenes no esta disponible.',
  summary: 'El resumen del almacen no esta disponible.',
  tree: 'La estructura jerarquica no esta disponible.',
  locations: 'El catalogo de ubicaciones no esta disponible.',
  locationDetail: 'El detalle de ubicacion no esta disponible.',
  rackFront: 'La vista frontal de rack no esta disponible.',
  floorGeometry:
    'El catalogo esta disponible, pero el levantamiento metrico aun no existe.',
  liveOccupancy:
    'La ocupacion sale de la ultima foto del WMS, con su fecha: no es el estado de ' +
    'este momento. Seguirlo en vivo necesita los movimientos a medida que ocurren.',
  inventory: 'El inventario no esta disponible.',
};
