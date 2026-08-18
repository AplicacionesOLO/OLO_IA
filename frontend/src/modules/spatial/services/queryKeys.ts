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
   * El layout PUBLICADO de un almacen: donde esta cada rack, en metros.
   *
   * La misma key que usa `PanelPublicar`, y a proposito: publicar desde el editor
   * tiene que dejar al explorador leyendo el layout nuevo, no el de antes. Si cada
   * pantalla tuviera su key, el explorador seguiria mostrando la colocacion vieja
   * hasta que alguien recargara, sin ningun sintoma de que esta desfasada.
   */
  layout: (warehouseId: string) => ['spatial', 'layout', warehouseId] as const,

  /**
   * Rutas de un almacen, acotadas por la ventana temporal.
   *
   * La ventana entra en la clave: dos ventanas distintas son dos respuestas
   * distintas, y compartir clave haria que pedir «los ultimos 20 minutos» devolviera
   * el vuelo de ayer que ya estaba en cache.
   */
  routes: (warehouseId: string, desde?: string, hasta?: string) =>
    ['spatial', 'routes', warehouseId, desde ?? '', hasta ?? ''] as const,

  observationSources: (warehouseId: string) =>
    ['spatial', 'observation-sources', warehouseId] as const,

  observationCoverage: (warehouseId: string) =>
    ['spatial', 'observation-coverage', warehouseId] as const,

  observations: (warehouseId: string, source?: string) =>
    ['spatial', 'observations', warehouseId, source ?? ''] as const,

  /**
   * Inventario. Claves propias y no bajo `summary`: la ocupacion cambia cuando llega
   * una foto nueva del WMS, no cuando cambia el catalogo, y mezclarlas obligaria a
   * recargar los 3.048 nodos del arbol porque alguien importo inventario.
   */
  inventorySummary: (warehouseId: string) =>
    ['spatial', 'inventory', 'summary', warehouseId] as const,

  rackOccupancy: (warehouseId: string) =>
    ['spatial', 'inventory', 'rack-occupancy', warehouseId] as const,

  locationOccupancy: (warehouseId: string, rackId?: string, occupied?: boolean) =>
    ['spatial', 'inventory', 'location-occupancy', warehouseId, rackId ?? '', occupied ?? 'all'] as const,

  /** La situacion del WMS hueco a hueco, para pintar el plano 3D. Una sola peticion. */
  slotOccupancy: (warehouseId: string) =>
    ['spatial', 'slot-occupancy', warehouseId] as const,

  locationContent: (warehouseId: string, locationId: string) =>
    ['spatial', 'inventory', 'content', warehouseId, locationId] as const,

  /**
   * El estado OBSERVADO de cada hueco: lo que la camara vio, no lo que el WMS declara.
   *
   * Va bajo `inspection` y no bajo `inventory` a proposito: se invalida cuando llega un
   * recorrido nuevo, no cuando se importa un corte del WMS. Son dos relojes distintos.
   */
  inspection: (warehouseId: string, rackId?: string) =>
    ['spatial', 'inspection', warehouseId, rackId ?? 'todo'] as const,

  /** Las medidas reales del almacen. Cambian cuando alguien mide, no solas. */
  metrics: (warehouseId: string) => ['spatial', 'metrics', warehouseId] as const,

  /**
   * El CATALOGO de figuras. Sin almacen en la clave: la biblioteca es del tenant y de la
   * plataforma, no de un almacen — la misma persona sirve para los tres almacenes—.
   */
  assets: () => ['spatial', 'assets'] as const,

  /** Los recorridos de un almacen. */
  trips: (warehouseId: string) => ['spatial', 'trips', warehouseId] as const,

  /** Un recorrido con sus paradas. */
  trip: (tripId: string) => ['spatial', 'trips', 'uno', tripId] as const,

  /** Las figuras COLOCADAS en un plano. Estas si son de un almacen. */
  placedAssets: (warehouseId: string) => ['spatial', 'assets', 'placed', warehouseId] as const,

  /** Que cambio entre los dos ultimos recorridos. */
  inspectionChanges: (warehouseId: string, rackId?: string) =>
    ['spatial', 'inspection', 'changes', warehouseId, rackId ?? 'todo'] as const,

  /** Cuanto se ha inspeccionado. Se invalida con cada recorrido nuevo. */
  inspectionCoverage: (warehouseId: string) =>
    ['spatial', 'inspection', 'coverage', warehouseId] as const,

  inventoryMismatches: (warehouseId: string) =>
    ['spatial', 'inventory', 'mismatches', warehouseId] as const,

  inventoryFind: (warehouseId: string, termino: string) =>
    ['spatial', 'inventory', 'find', warehouseId, termino] as const,

  /**
   * Todo lo de spatial. Se usa al cambiar de almacen: las keys no llevan el
   * almacen en el mismo lugar, asi que invalidar por prefijo es lo unico
   * correcto.
   */
  byWarehouse: () => ['spatial'] as const,
};
