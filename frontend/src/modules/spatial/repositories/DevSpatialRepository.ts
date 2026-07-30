/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEV ONLY — ADAPTADOR TEMPORAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Resuelve el contrato SpatialRepository con datos generados en memoria.
 * Devuelve la misma forma paginada que el backend real.
 *
 * NO PUEDE ACTIVARSE EN PRODUCCION: SpatialProvider.tsx lo impide con un
 * throw explicito.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { DEV_WAREHOUSES, getDevLocations } from '../dev-data/locations';
import type {
  LocationFilter,
  PaginatedLocations,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';
import type { SpatialRepository } from './SpatialRepository';

const DEFAULT_PAGE_SIZE = 50;

/** Simula latencia de red para que los loading states se vean. */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DevSpatialRepository implements SpatialRepository {
  async getWarehouses(): Promise<WarehouseOption[]> {
    await delay(120);
    return DEV_WAREHOUSES;
  }

  async getSummary(warehouseId: string): Promise<SpatialSummary> {
    await delay(200);
    const all = getDevLocations(warehouseId);
    const leaves = all.filter((l) => l.kind === 'location');
    const occupied = leaves.filter((l) => l.status === 'occupied').length;
    const available = leaves.filter((l) => l.status === 'available').length;
    const inferred = leaves.filter((l) => l.status === 'inferred').length;
    const invalid = leaves.filter((l) => l.status === 'invalid').length;
    const total = leaves.length;

    return {
      totalLocations: total,
      occupied,
      available,
      inferred,
      invalid,
      occupancyPercent: total > 0 ? Math.round((occupied / total) * 100) : 0,
    };
  }

  async getLocations(filter: LocationFilter): Promise<PaginatedLocations> {
    await delay(180);
    let results = getDevLocations(filter.warehouseId);

    if (filter.parentId !== undefined) {
      if (filter.parentId === null) {
        results = results.filter((l) => l.parentId === null);
      } else {
        results = results.filter((l) => l.parentId === filter.parentId);
      }
    }

    if (filter.status) {
      results = results.filter((l) => l.status === filter.status);
    }

    if (filter.nodeType) {
      results = results.filter((l) => l.kind === filter.nodeType);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      results = results.filter(
        (l) => l.code.toLowerCase().includes(q) || (l.name?.toLowerCase().includes(q) ?? false),
      );
    }

    // Paginacion sobre los resultados filtrados
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? DEFAULT_PAGE_SIZE;
    const total = results.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = results.slice(start, start + pageSize);

    return { items, page, pageSize, total, totalPages };
  }

  async getLocation(id: string): Promise<SpatialLocation | null> {
    await delay(100);
    for (const wh of DEV_WAREHOUSES) {
      const all = getDevLocations(wh.id);
      const found = all.find((l) => l.id === id);
      if (found) return found;
    }
    return null;
  }
}
