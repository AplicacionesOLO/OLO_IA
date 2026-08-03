/**
 * QUERY KEYS — una por read model.
 *
 * Cada endpoint tiene su propia key. No se reutiliza una generica: dos read
 * models con la misma key se invalidan juntos, y eso obliga a recargar el arbol
 * de 3.048 nodos porque cambio una ubicacion.
 *
 * ⚠ La key de `locations` incluye TODOS los campos del filtro. Si se omitiera
 * uno, dos busquedas distintas compartirian cache y la segunda mostraria los
 * resultados de la primera — un defecto que solo aparece cuando alguien filtra
 * dos veces seguidas, que es siempre.
 */

import type { LocationFilter } from '../types/index';

export const spatialKeys = {
  all: ['spatial'] as const,

  warehouses: () => ['spatial', 'warehouses'] as const,

  summary: (warehouseId: string) => ['spatial', 'summary', warehouseId] as const,

  /** Raices del arbol de un almacen. */
  treeRoots: (warehouseId: string) => ['spatial', 'tree', warehouseId] as const,

  /** Hijos de un nodo. Independiente del almacen: el nodo ya lo determina. */
  nodeChildren: (nodeId: string) => ['spatial', 'node-children', nodeId] as const,

  node: (nodeId: string) => ['spatial', 'node', nodeId] as const,

  floorPlan: (warehouseId: string) => ['spatial', 'floor-plan', warehouseId] as const,

  /**
   * El plano COMPLETO, recorriendo todas las paginas. Key distinta de `floorPlan`
   * a proposito: comparten endpoint pero no contenido —una trae 200 racks y la
   * otra los 348—, y compartir key haria que la primera respuesta que llegara
   * dejara a la otra pantalla con datos incompletos.
   */
  floorPlanCompleto: (warehouseId: string) =>
    ['spatial', 'floor-plan', warehouseId, 'completo'] as const,

  /** Por UUID del rack, no por codigo: el codigo no es identificador global. */
  rackFrontView: (rackId: string) => ['spatial', 'rack-front', rackId] as const,

  locations: (filter: LocationFilter) =>
    [
      'spatial',
      'locations',
      filter.warehouseId ?? 'all',
      filter.rackId ?? '',
      filter.bayId ?? '',
      filter.status ?? 'all',
      filter.situation ?? 'all',
      filter.codeForm ?? 'all',
      filter.level ?? 'all',
      filter.search ?? '',
      filter.page ?? 1,
      filter.cursor ?? '',
      filter.pageSize ?? 0,
      filter.withTotal ?? false,
    ] as const,

  location: (id: string) => ['spatial', 'location', id] as const,

  /**
   * Todo lo de spatial. Se usa al cambiar de almacen: las keys no llevan el
   * almacen en el mismo lugar, asi que invalidar por prefijo es lo unico
   * correcto.
   */
  byWarehouse: () => ['spatial'] as const,
};
