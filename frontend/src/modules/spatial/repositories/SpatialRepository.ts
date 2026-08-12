/**
 * CONTRATO DEL REPOSITORIO SPATIAL — solo lo que el BACKEND sirve.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA SEPARACION QUE HACE ESTE ARCHIVO
 *
 * Antes esta interfaz tenia `getFloorPlan()` devolviendo un objeto con imagen,
 * calibracion, coordenadas en metros y rotacion de cada rack. Nada de eso viene
 * del backend, y no por falta de endpoint: `world_position` esta al 100% NULL
 * porque el catalogo del WMS no trae geometria metrica.
 *
 * Mezclarlo obligaba a una de dos cosas malas: o el adaptador real inventaba
 * geometria, o la pantalla del plano no podia funcionar nunca.
 *
 * Ahora hay dos repositorios con responsabilidades disjuntas:
 *
 *   SpatialRepository  → LO QUE ES. Estructura y catalogo, del backend, con RLS.
 *                        Compartido, auditado, misma verdad para todos.
 *
 *   LayoutRepository   → COMO SE VE. Imagen del plano, calibracion, origen,
 *                        posiciones de racks. Local, del operador, sin autoridad
 *                        sobre el dominio.
 *
 * Un rack existe porque lo dice el backend. Que se dibuje en tal sitio del plano
 * lo dice el layout. Son dos afirmaciones distintas y solo una es un hecho del
 * almacen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { InspectionCoverage, LocationInspectionOverlay } from '../inspection';
import type {
  FloorPlanCell,
  LocationFilter,
  Paginated,
  RackFrontView,
  SpatialLocation,
  SpatialNode,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';

export interface SpatialRepository {
  /** Almacenes accesibles, con sus recuentos. RLS decide que se ve. */
  getWarehouses(signal?: AbortSignal): Promise<WarehouseOption[]>;

  /** KPIs de un almacen. 404 si no existe o no es accesible. */
  getSummary(warehouseId: string, signal?: AbortSignal): Promise<SpatialSummary>;

  /**
   * Raices del arbol de un almacen.
   *
   * `depth = 0` devuelve solo las raices —348 filas en WH-001— y `childCount` en
   * cada una dice si vale la pena expandirla. El arbol completo son 3.048 nodos,
   * y descargarlo para dibujar el primer nivel es trabajo que nadie pidio.
   */
  getTreeRoots(
    warehouseId: string,
    signal?: AbortSignal,
  ): Promise<SpatialNode[]>;

  /** Hijos directos de un nodo. Expansion perezosa, un nivel por peticion. */
  getNodeChildren(
    nodeId: string,
    opts?: { limit?: number; cursor?: string | undefined },
    signal?: AbortSignal,
  ): Promise<Paginated<SpatialNode>>;

  /** Un nodo con sus recuentos. */
  getNode(nodeId: string, signal?: AbortSignal): Promise<SpatialNode>;

  /**
   * Plano AGREGADO: una fila por rack, 348 en lugar de 29.310.
   *
   * ⚠ NO devuelve geometria: los `logical*` son indices, no metros. Sirve para
   * una rejilla topologica y para los recuentos por rack, no para dibujar a
   * escala.
   */
  getFloorPlan(
    warehouseId: string,
    opts?: { limit?: number; cursor?: string | undefined; withTotal?: boolean },
    signal?: AbortSignal,
  ): Promise<Paginated<FloorPlanCell>>;

  /** Alzado de UN rack, con la rejilla ya dimensionada. Sin paginar. */
  getRackFrontView(rackId: string, signal?: AbortSignal): Promise<RackFrontView>;

  /**
   * Lo ultimo que se vio en cada hueco, frente a lo que el WMS declara.
   *
   * Es la capa «Inspeccion» del visor, que hasta ahora no tenia de donde salir. Solo
   * devuelve huecos CON lectura: su tamano lo marca lo inspeccionado, no el catalogo.
   */
  /** Cuánto del almacén se ha inspeccionado, y cuándo. */
  getInspectionCoverage(warehouseId: string, signal?: AbortSignal): Promise<InspectionCoverage>;

  getInspection(
    warehouseId: string,
    rackId?: string,
    signal?: AbortSignal,
  ): Promise<LocationInspectionOverlay[]>;

  /** Ubicaciones filtradas y paginadas. Nunca las 29.310 de golpe. */
  getLocations(
    filter: LocationFilter,
    signal?: AbortSignal,
  ): Promise<Paginated<SpatialLocation>>;

  /** Detalle de una ubicacion. 404 si no existe o no es accesible. */
  getLocation(locationId: string, signal?: AbortSignal): Promise<SpatialLocation>;
}
