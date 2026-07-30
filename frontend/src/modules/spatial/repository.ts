/**
 * SPATIAL REPOSITORY
 *
 * Contrato de acceso a datos espaciales. Todas las operaciones lanzan
 * NotImplementedError hasta que el Bloque 3 provea los endpoints.
 *
 * Cuando existan, este archivo se conecta al ApiClient y los componentes
 * no cambian: consumen el contrato, no la implementacion.
 */

import { NotImplementedError, type PagedResult } from '../shared/errors';
import type { Location, NodeFunctionDef, Site, SpatialNode } from './types';

export class SpatialRepository {
  async getSites(_warehouseId: string): Promise<Site[]> {
    throw new NotImplementedError('SpatialRepository.getSites');
  }

  async getNodes(_siteId: string, _parentId?: string): Promise<SpatialNode[]> {
    throw new NotImplementedError('SpatialRepository.getNodes');
  }

  async getNode(_nodeId: string): Promise<SpatialNode> {
    throw new NotImplementedError('SpatialRepository.getNode');
  }

  async getLocations(
    _nodeId: string,
    _options?: { cursor?: string; limit?: number },
  ): Promise<PagedResult<Location>> {
    throw new NotImplementedError('SpatialRepository.getLocations');
  }

  async getLocation(_locationId: string): Promise<Location> {
    throw new NotImplementedError('SpatialRepository.getLocation');
  }

  async searchLocations(
    _siteId: string,
    _query: string,
  ): Promise<Location[]> {
    throw new NotImplementedError('SpatialRepository.searchLocations');
  }

  async getNodeFunctions(): Promise<NodeFunctionDef[]> {
    throw new NotImplementedError('SpatialRepository.getNodeFunctions');
  }
}
