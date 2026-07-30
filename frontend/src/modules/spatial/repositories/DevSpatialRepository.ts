/**
 * ADAPTADOR TEMPORAL — datos locales.
 *
 * Resuelve el contrato SpatialRepository con datos generados en memoria.
 * Se reemplaza por ApiSpatialRepository cuando el backend exponga los endpoints.
 */

import { DEV_WAREHOUSES, getDevLocations } from '../dev-data/locations';
import type {
  LocationFilter,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';
import type { SpatialRepository } from './SpatialRepository';

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
    const positions = all.filter((l) => l.kind === 'position');
    const occupied = positions.filter((l) => l.status === 'occupied').length;
    const available = positions.filter((l) => l.status === 'available').length;
    const inferred = positions.filter((l) => l.status === 'inferred').length;
    const invalid = positions.filter((l) => l.status === 'invalid').length;
    const total = positions.length;

    return {
      totalLocations: total,
      occupied,
      available,
      inferred,
      invalid,
      occupancyPercent: total > 0 ? Math.round((occupied / total) * 100) : 0,
    };
  }

  async getLocations(filter: LocationFilter): Promise<SpatialLocation[]> {
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

    if (filter.search) {
      const q = filter.search.toLowerCase();
      results = results.filter(
        (l) => l.code.toLowerCase().includes(q) || (l.name?.toLowerCase().includes(q) ?? false),
      );
    }

    return results;
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
