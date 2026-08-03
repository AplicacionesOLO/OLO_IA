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
   * Ocupacion real.
   *
   * `false` por decision de arquitectura, no por falta de endpoint: la ocupacion
   * no es una propiedad del espacio —un estante no sabe lo que tiene encima—
   * sino del inventario (invariantes SPA-11/SPA-12, regla R3 del ADR-009).
   *
   * La migracion 0059 elimino `occupied_count` de las vistas al comprobar que
   * solapaba con `available_count` y `blocked_count`: los tres sumaban 45.174
   * sobre 29.312 ubicaciones.
   *
   * Lo que el backend si expone es `wms_situation_counts`: el histograma del
   * vocabulario del WMS tal cual, con su fecha. Es historico, no vivo.
   */
  liveOccupancy: boolean;

  /** Existencias, pallets, articulos. El bloque de inventario no existe aun. */
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
  inventory: false,
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
    'La ocupacion en tiempo real estara disponible al integrar el inventario.',
  inventory:
    'La ocupacion en tiempo real estara disponible al integrar el inventario.',
};
