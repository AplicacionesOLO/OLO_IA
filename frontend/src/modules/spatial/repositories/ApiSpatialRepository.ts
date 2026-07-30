/**
 * ADAPTADOR REAL — consume el API REST del backend.
 *
 * NO ACTIVADO TODAVIA. Se activa con VITE_SPATIAL_BACKEND=true.
 *
 * Cada metodo corresponde a un endpoint distinto:
 *   getWarehouses   → GET /v1/spatial/warehouses
 *   getSummary      → GET /v1/spatial/warehouses/{id}/summary
 *   getTree         → GET /v1/spatial/warehouses/{id}/tree?parent_id=
 *   getFloorPlan    → GET /v1/spatial/warehouses/{id}/floor-plan
 *   getRackFrontView → GET /v1/spatial/racks/{rack_code}/front?warehouse_id=
 *   getLocations    → GET /v1/spatial/warehouses/{id}/locations (paginado)
 *   getLocation     → GET /v1/spatial/locations/{id}
 */

import type { ApiClient } from '../../../lib/apiClient';
import type {
  LocationFilter,
  PaginatedLocations,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';
import type {
  FloorPlanDto,
  PaginatedDto,
  RackFrontViewDto,
  SpatialLocationDto,
  SpatialSummaryDto,
  SpatialTreeNodeDto,
  SpatialWarehouseDto,
} from './dto';
import { mapLocation, mapPaginatedLocations, mapSummary, mapWarehouse } from './mappers';
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

  async getTree(warehouseId: string, parentId?: string | null): Promise<SpatialTreeNodeDto[]> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (parentId) query.parent_id = parentId;
    return this.api.get<SpatialTreeNodeDto[]>(
      `/spatial/warehouses/${warehouseId}/tree`,
      query,
    );
  }

  async getFloorPlan(warehouseId: string): Promise<FloorPlanDto> {
    return this.api.get<FloorPlanDto>(`/spatial/warehouses/${warehouseId}/floor-plan`);
  }

  async getRackFrontView(warehouseId: string, rackCode: string): Promise<RackFrontViewDto> {
    return this.api.get<RackFrontViewDto>(
      `/spatial/racks/${encodeURIComponent(rackCode)}/front`,
      { warehouse_id: warehouseId },
    );
  }

  async getLocations(filter: LocationFilter): Promise<PaginatedLocations> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (filter.parentId !== undefined) query.parent_id = filter.parentId ?? '__root__';
    if (filter.search) query.search = filter.search;
    if (filter.status) query.status = filter.status;
    if (filter.nodeType) query.node_type = filter.nodeType;
    if (filter.page) query.page = filter.page;
    if (filter.pageSize) query.page_size = filter.pageSize;

    const dto = await this.api.get<PaginatedDto<SpatialLocationDto>>(
      `/spatial/warehouses/${filter.warehouseId}/locations`,
      query,
    );
    return mapPaginatedLocations(dto);
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
