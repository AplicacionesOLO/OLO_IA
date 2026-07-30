/**
 * SPATIAL SERVICE
 *
 * Logica de dominio espacial: navegacion del arbol, busqueda de ubicaciones,
 * resolucion de caminos, validacion de aristas legales.
 *
 * Consume SpatialRepository. No consume ApiClient directamente.
 */

import { NotImplementedError } from '../shared/errors';
import type { Location, SpatialNode } from './types';

export class SpatialService {
  /** Devuelve el camino desde la raiz hasta un nodo dado. */
  async getAncestorPath(_nodeId: string): Promise<SpatialNode[]> {
    throw new NotImplementedError('SpatialService.getAncestorPath');
  }

  /** Hijos directos de un nodo, incluyendo el recuento de ubicaciones. */
  async getChildrenWithCounts(_nodeId: string): Promise<(SpatialNode & { locationCount: number })[]> {
    throw new NotImplementedError('SpatialService.getChildrenWithCounts');
  }

  /** Ubicaciones de un nodo con su estado de ocupacion (requiere snapshot activo). */
  async getLocationsWithOccupancy(
    _nodeId: string,
    _snapshotId?: string,
  ): Promise<(Location & { containerCount: number; itemCount: number })[]> {
    throw new NotImplementedError('SpatialService.getLocationsWithOccupancy');
  }

  /** Busqueda por codigo de ubicacion. */
  async searchByCode(_query: string): Promise<Location[]> {
    throw new NotImplementedError('SpatialService.searchByCode');
  }
}
