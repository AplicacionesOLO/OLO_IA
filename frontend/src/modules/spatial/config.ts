/**
 * CONFIGURACION CENTRALIZADA DEL MODULO SPATIAL
 *
 * Todos los valores que controlan el comportamiento de las consultas y la
 * visualizacion. Ningun componente debe usar literales magicos.
 */

export const SPATIAL_CONFIG = {
  /** Tamaño de pagina por defecto para vistas de lista y grid. */
  defaultPageSize: 50,

  /** Tamaño de pagina maximo que el frontend solicita al backend. */
  maxPageSize: 200,

  /** Delay de debounce para busqueda (ms). */
  searchDebounceMs: 300,

  /** staleTime para la query de warehouses (ms). */
  warehousesCacheMs: 5 * 60_000,

  /** staleTime para la query de summary (ms). */
  summaryCacheMs: 30_000,
} as const;
