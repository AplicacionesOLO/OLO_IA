/**
 * ADAPTADOR REAL — consume los 9 endpoints del backend.
 *
 * Correspondencia exacta, verificada contra `/openapi.json`:
 *
 *   getWarehouses     → GET /v1/spatial/warehouses
 *   getSummary        → GET /v1/spatial/warehouses/{id}/summary
 *   getTreeRoots      → GET /v1/spatial/warehouses/{id}/tree?depth=0
 *   getFloorPlan      → GET /v1/spatial/warehouses/{id}/floor-plan
 *   getNode           → GET /v1/spatial/nodes/{id}
 *   getNodeChildren   → GET /v1/spatial/nodes/{id}/children
 *   getRackFrontView  → GET /v1/spatial/racks/{id}/front-view
 *   getLocations      → GET /v1/spatial/locations
 *   getLocation       → GET /v1/spatial/locations/{id}
 *
 * Las tres rutas que la version anterior adivinaba y no existen quedan
 * documentadas en `docs/SPATIAL_API_CONTRACT.md` §2. La mas importante:
 * `/racks/{rack_code}/front` usaba el CODIGO como identificador, y el codigo es
 * unico por almacen, no globalmente.
 *
 * Todos los metodos aceptan `AbortSignal` y lo propagan: React Query cancela la
 * peticion anterior al cambiar de almacen, y sin la señal esa respuesta llegaria
 * despues y sobrescribiria la nueva.
 */

import type { ApiClient } from '../../../lib/apiClient';
import type {
  InspectionChange,
  InspectionCoverage,
  LocationInspectionOverlay,
} from '../inspection';
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
import type {
  FloorPlanCellDto,
  InspectionChangeDto,
  InspectionCoverageDto,
  LocationDto,
  LocationInspectionDto,
  LocationsQuery,
  PageMetaDto,
  RackFrontViewDto,
  SpatialNodeDto,
  SpatialTreeNodeDto,
  WarehouseSummaryDto,
} from './dto';
import {
  mapFloorPlanCell,
  mapLocation,
  mapLocationInspection,
  mapNode,
  mapPaginated,
  mapRackFrontView,
  mapSummary,
  mapTreeNode,
  mapWarehouseOption,
} from './mappers';
import type { SpatialRepository } from './SpatialRepository';

/** Envoltorio paginado del backend: `{data, pagination}`. */
interface PagedResponse<T> {
  data: T[];
  pagination: PageMetaDto;
}

export class ApiSpatialRepository implements SpatialRepository {
  constructor(private readonly api: ApiClient) {}

  /**
   * `request` en lugar de `getPaged` porque este ultimo descarta `page`, `total`
   * y `total_pages` del envoltorio: solo devuelve `{items, nextCursor}`. La tabla
   * de ubicaciones necesita el total cuando se pide, asi que se lee el envoltorio
   * completo.
   */
  private paged<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<PagedResponse<T>> {
    return this.api.request<PagedResponse<T>>(path, {
      query,
      ...(signal ? { signal } : {}),
    });
  }

  // ── 1 · Almacenes ─────────────────────────────────────────────────────────
  async getWarehouses(signal?: AbortSignal): Promise<WarehouseOption[]> {
    const dtos = await this.api.get<WarehouseSummaryDto[]>(
      '/spatial/warehouses',
      undefined,
      signal,
    );
    return dtos.map(mapWarehouseOption);
  }

  // ── 2 · Resumen ───────────────────────────────────────────────────────────
  async getSummary(warehouseId: string, signal?: AbortSignal): Promise<SpatialSummary> {
    const dto = await this.api.get<WarehouseSummaryDto>(
      `/spatial/warehouses/${warehouseId}/summary`,
      undefined,
      signal,
    );
    return mapSummary(dto);
  }

  // ── 3 · Arbol ─────────────────────────────────────────────────────────────
  async getTreeRoots(warehouseId: string, signal?: AbortSignal): Promise<SpatialNode[]> {
    // `depth=0`: SOLO las raices. Con `depth=1` llegarian tambien los 2.701
    // cuerpos, que es justo lo que la expansion perezosa evita.
    const dtos = await this.api.get<SpatialTreeNodeDto[]>(
      `/spatial/warehouses/${warehouseId}/tree`,
      { depth: 0 },
      signal,
    );
    return dtos.map(mapTreeNode);
  }

  async getNodeChildren(
    nodeId: string,
    opts: { limit?: number; cursor?: string | undefined } = {},
    signal?: AbortSignal,
  ): Promise<Paginated<SpatialNode>> {
    const res = await this.paged<SpatialNodeDto>(
      `/spatial/nodes/${nodeId}/children`,
      {
        limit: opts.limit ?? 200,
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
        with_total: true,
      },
      signal,
    );
    return mapPaginated(res.data, res.pagination, mapNode);
  }

  async getNode(nodeId: string, signal?: AbortSignal): Promise<SpatialNode> {
    const dto = await this.api.get<SpatialNodeDto>(
      `/spatial/nodes/${nodeId}`,
      undefined,
      signal,
    );
    return mapNode(dto);
  }

  // ── 4 · Plano agregado ────────────────────────────────────────────────────
  async getFloorPlan(
    warehouseId: string,
    opts: { limit?: number; cursor?: string | undefined; withTotal?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<Paginated<FloorPlanCell>> {
    const res = await this.paged<FloorPlanCellDto>(
      `/spatial/warehouses/${warehouseId}/floor-plan`,
      {
        limit: opts.limit ?? 200,
        ...(opts.cursor ? { cursor: opts.cursor } : {}),
        ...(opts.withTotal ? { with_total: true } : {}),
      },
      signal,
    );
    return mapPaginated(res.data, res.pagination, mapFloorPlanCell);
  }

  // ── 5 · Alzado ────────────────────────────────────────────────────────────
  async getRackFrontView(rackId: string, signal?: AbortSignal): Promise<RackFrontView> {
    // El parametro es el UUID del nodo, NO el codigo: el codigo es unico por
    // almacen y no identifica un rack globalmente.
    const dto = await this.api.get<RackFrontViewDto>(
      `/spatial/racks/${rackId}/front-view`,
      undefined,
      signal,
    );
    return mapRackFrontView(dto);
  }

  // ── 5 bis · El estado OBSERVADO de cada hueco ─────────────────────────────
  //
  //  La capa «Inspeccion» del visor estaba dibujada desde 0067 y recibia `undefined`:
  //  el mapa ensenaba el catalogo y la ocupacion DECLARADA, y lo que la camara habia
  //  visto se quedaba en una tabla de otra pantalla. Esto es de donde sale.
  //
  //  Sin paginar, igual que el alzado: un mapa a medio colorear miente mas que uno
  //  vacio. Solo vienen los huecos CON lectura, asi que el tamano lo marca lo
  //  inspeccionado y no las 29.310 ubicaciones del catalogo.
  async getInspection(
    warehouseId: string,
    rackId?: string,
    signal?: AbortSignal,
  ): Promise<LocationInspectionOverlay[]> {
    const dtos = await this.api.get<LocationInspectionDto[]>(
      `/spatial/warehouses/${warehouseId}/inspection`,
      rackId ? { rack_id: rackId } : undefined,
      signal,
    );
    return (dtos ?? []).map(mapLocationInspection);
  }

  // ── 5 ter · Cuanto se ha mirado, y cuando ─────────────────────────────────
  //
  //  Sin este numero, «cero discrepancias» significa «todo cuadra» y «no has mirado» a la
  //  vez, y son la conclusion contraria.
  async getInspectionCoverage(
    warehouseId: string,
    signal?: AbortSignal,
  ): Promise<InspectionCoverage> {
    const d = await this.api.get<InspectionCoverageDto>(
      `/spatial/warehouses/${warehouseId}/inspection/coverage`,
      undefined,
      signal,
    );
    return {
      warehouseId: d.warehouse_id,
      locations: d.locations,
      inspected: d.inspected,
      racksTotal: d.racks_total,
      racksInspected: d.racks_inspected,
      lastSeenAt: d.last_seen_at,
      racks: (d.racks ?? []).map((x) => ({
        rackId: x.rack_id,
        rackCode: x.rack_code,
        locations: x.locations,
        inspected: x.inspected,
        lastSeenAt: x.last_seen_at,
      })),
    };
  }

  // ── 5 quater · Que cambio desde el recorrido anterior ─────────────────────
  //
  //  Sin esto cada recorrido es una foto suelta y el producto no tiene memoria.
  async getInspectionChanges(
    warehouseId: string,
    rackId?: string,
    signal?: AbortSignal,
  ): Promise<InspectionChange[]> {
    const dtos = await this.api.get<InspectionChangeDto[]>(
      `/spatial/warehouses/${warehouseId}/inspection/changes`,
      rackId ? { rack_id: rackId } : undefined,
      signal,
    );
    return (dtos ?? []).map((d) => ({
      locationId: d.location_id,
      locationCode: d.location_code,
      verdict: d.verdict,
      statusNow: d.status_now,
      palletNow: d.pallet_now,
      seenNow: d.seen_now,
      statusBefore: d.status_before,
      palletBefore: d.pallet_before,
      seenBefore: d.seen_before,
    }));
  }

  // ── 6 · Ubicaciones ───────────────────────────────────────────────────────
  async getLocations(
    filter: LocationFilter,
    signal?: AbortSignal,
  ): Promise<Paginated<SpatialLocation>> {
    // `cursor` y `page` son excluyentes: el backend responde 422 si llegan los
    // dos. Se resuelve aqui en lugar de dejar que el usuario vea un error: el
    // cursor gana porque es el modo de recorrido y `page` es el de salto.
    const query: LocationsQuery = {
      ...(filter.warehouseId ? { warehouse_id: filter.warehouseId } : {}),
      ...(filter.rackId ? { rack_id: filter.rackId } : {}),
      ...(filter.bayId ? { bay_id: filter.bayId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.situation ? { situation: filter.situation } : {}),
      ...(filter.codeForm ? { code_form: filter.codeForm } : {}),
      ...(filter.level != null ? { level: filter.level } : {}),
      ...(filter.search ? { search: filter.search } : {}),
      limit: filter.pageSize ?? 50,
      ...(filter.cursor
        ? { cursor: filter.cursor }
        : filter.page != null && filter.page > 1
          ? { page: filter.page }
          : {}),
      ...(filter.withTotal ? { with_total: true } : {}),
    };

    const res = await this.paged<LocationDto>(
      '/spatial/locations',
      query as Record<string, string | number | boolean | undefined>,
      signal,
    );
    return mapPaginated(res.data, res.pagination, mapLocation);
  }

  async getLocation(locationId: string, signal?: AbortSignal): Promise<SpatialLocation> {
    const dto = await this.api.get<LocationDto>(
      `/spatial/locations/${locationId}`,
      undefined,
      signal,
    );
    return mapLocation(dto);
  }
}
