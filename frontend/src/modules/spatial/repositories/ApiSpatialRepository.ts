/**
 * ADAPTADOR REAL — consume el API REST del backend.
 *
 * NO ACTIVADO TODAVIA. Requiere que Claude entregue los endpoints:
 *   GET /v1/spatial/warehouses
 *   GET /v1/spatial/warehouses/{warehouse_id}/summary
 *   GET /v1/spatial/warehouses/{warehouse_id}/locations
 *   GET /v1/spatial/locations/{location_id}
 *
 * Una vez disponibles, se activa cambiando el provider en SpatialProvider.tsx.
 * Los componentes no se tocan.
 */

import type { ApiClient } from '../../../lib/apiClient';
import type {
  LocationFilter,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';
import type {
  SpatialLocationDto,
  SpatialSummaryDto,
  SpatialWarehouseDto,
} from './dto';
import { mapLocation, mapSummary, mapWarehouse } from './mappers';
import type { SpatialRepository } from './SpatialRepository';

export class ApiSpatialRepository implements SpatialRepository {
  constructor(private readonly api: ApiClient) {}

  async getWarehouses(): Promise<WarehouseOption[]> {
    const dtos = await this.api.get<SpatialWarehouseDto[]>('/spatial/warehouses');
    return dtos.map(mapWarehouse);
  }

  async getSummary(warehouseId: string): Promise<SpatialSummary> {
    const dto = await this.api.get<SpatialSummaryDto>(
      `/spatial/warehouses/${warehouseId}/summary`,
    );
    return mapSummary(dto);
  }

  async getLocations(filter: LocationFilter): Promise<SpatialLocation[]> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (filter.parentId !== undefined) {
      query.parent_id = filter.parentId ?? '__root__';
    }
    if (filter.search) query.search = filter.search;
    if (filter.status) query.status = filter.status;

    const dtos = await this.api.get<SpatialLocationDto[]>(
      `/spatial/warehouses/${filter.warehouseId}/locations`,
      query,
    );
    return dtos.map(mapLocation);
  }

  async getLocation(id: string): Promise<SpatialLocation | null> {
    try {
      const dto = await this.api.get<SpatialLocationDto>(`/spatial/locations/${id}`);
      return mapLocation(dto);
    } catch {
      return null;
    }
  }
}
