/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEV ONLY — ADAPTADOR TEMPORAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Imita exactamente los metodos de SpatialRepository usando datos en memoria.
 * Cada metodo simula lo que haria el endpoint real:
 *   - getFloorPlan: devuelve racks agregados (no posiciones individuales)
 *   - getRackFrontView: devuelve posiciones de UN rack
 *   - getTree: devuelve un nivel del arbol a la vez
 *
 * NO PUEDE ACTIVARSE EN PRODUCCION.
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
import type {
  FloorPlanDto,
  FloorPlanRackDto,
  RackFrontViewDto,
  RackPositionDto,
  SpatialTreeNodeDto,
} from './dto';
import type { SpatialRepository } from './SpatialRepository';
import { parseLocationCode } from '../engine/RackModel';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DevSpatialRepository implements SpatialRepository {
  async getWarehouses(): Promise<WarehouseOption[]> {
    await delay(80);
    return DEV_WAREHOUSES;
  }

  async getSummary(warehouseId: string): Promise<SpatialSummary> {
    await delay(100);
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

  async getTree(warehouseId: string, parentId?: string | null): Promise<SpatialTreeNodeDto[]> {
    await delay(60);
    const all = getDevLocations(warehouseId);

    // Filter to direct children of parentId (or root nodes)
    const children = parentId === undefined || parentId === null
      ? all.filter((l) => l.parentId === null)
      : all.filter((l) => l.parentId === parentId);

    return children.map((node) => {
      // Count locations below this node
      const descendants = countDescendants(node.id, all);
      const hasChildren = all.some((l) => l.parentId === node.id);

      return {
        id: node.id,
        code: node.code,
        name: node.name,
        node_type: node.kind,
        parent_id: node.parentId,
        location_count: descendants.count,
        occupancy_percent: descendants.occupancyPct,
        has_children: hasChildren,
      };
    });
  }

  async getFloorPlan(warehouseId: string): Promise<FloorPlanDto> {
    await delay(120);
    const all = getDevLocations(warehouseId);
    const leaves = all.filter((l) => l.kind === 'location');

    // Group by rack code (parsed from location code)
    const byRack = new Map<string, SpatialLocation[]>();
    for (const loc of leaves) {
      const parsed = parseLocationCode(loc.code);
      if (parsed.kind === 'structured') {
        const arr = byRack.get(parsed.rack) ?? [];
        arr.push(loc);
        byRack.set(parsed.rack, arr);
      }
    }

    // Build aggregated rack DTOs
    const racks: FloorPlanRackDto[] = [];
    let idx = 0;
    for (const [rackCode, positions] of byRack) {
      const bays = new Set(positions.map((p) => { const r = parseLocationCode(p.code); return r.kind === 'structured' ? r.bay : ''; }));
      const levels = new Set(positions.map((p) => { const r = parseLocationCode(p.code); return r.kind === 'structured' ? r.level : 0; }));
      const totalCap = positions.reduce((s, p) => s + p.capacity, 0);
      const totalOcc = positions.reduce((s, p) => s + p.occupied, 0);
      const occupiedCount = positions.filter((p) => p.status === 'occupied').length;
      const dominantStatus = occupiedCount > positions.length / 2 ? 'occupied' : 'available';

      // Position racks in a grid layout
      const col = idx % 6;
      const row = Math.floor(idx / 6);
      racks.push({
        rack_code: rackCode,
        x: col * 80 + 40,
        y: row * 60 + 30,
        rotation: 0,
        bay_count: bays.size,
        level_count: levels.size,
        location_count: positions.length,
        occupancy_percent: totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0,
        dominant_status: dominantStatus,
      });
      idx++;
    }

    return {
      racks,
      zones: [],
      plan_width: Math.max(500, (Math.min(idx, 6)) * 80 + 40),
      plan_height: Math.max(200, (Math.floor(idx / 6) + 1) * 60 + 30),
    };
  }

  async getRackFrontView(warehouseId: string, rackCode: string): Promise<RackFrontViewDto> {
    await delay(80);
    const all = getDevLocations(warehouseId);
    const leaves = all.filter((l) => l.kind === 'location');

    const positions: RackPositionDto[] = [];
    const baySet = new Set<string>();
    let minLevel = Infinity;
    let maxLevel = 0;

    for (const loc of leaves) {
      const parsed = parseLocationCode(loc.code);
      if (parsed.kind === 'structured' && parsed.rack === rackCode) {
        baySet.add(parsed.bay);
        if (parsed.level < minLevel) minLevel = parsed.level;
        if (parsed.level > maxLevel) maxLevel = parsed.level;
        positions.push({
          id: loc.id,
          location_code: loc.code,
          rack_code: parsed.rack,
          bay_code: parsed.bay,
          logical_level: parsed.level,
          logical_position: parsed.position,
          status: loc.status,
          capacity: loc.capacity,
          occupied: loc.occupied,
          last_verified_at: loc.lastVerifiedAt,
        });
      }
    }

    const bayCodes = [...baySet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return {
      rack_code: rackCode,
      bay_codes: bayCodes,
      level_range: { min: minLevel === Infinity ? 1 : minLevel, max: maxLevel || 1 },
      positions,
    };
  }

  async getLocations(filter: LocationFilter): Promise<PaginatedLocations> {
    await delay(100);
    let results = getDevLocations(filter.warehouseId);

    if (filter.parentId !== undefined) {
      if (filter.parentId === null) {
        results = results.filter((l) => l.parentId === null);
      } else {
        results = results.filter((l) => l.parentId === filter.parentId);
      }
    }
    if (filter.status) results = results.filter((l) => l.status === filter.status);
    if (filter.nodeType) results = results.filter((l) => l.kind === filter.nodeType);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      results = results.filter((l) =>
        l.code.toLowerCase().includes(q) || (l.name?.toLowerCase().includes(q) ?? false),
      );
    }

    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 50;
    const total = results.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = results.slice(start, start + pageSize);

    return { items, page, pageSize, total, totalPages };
  }

  async getLocation(id: string): Promise<SpatialLocation | null> {
    await delay(60);
    for (const wh of DEV_WAREHOUSES) {
      const all = getDevLocations(wh.id);
      const found = all.find((l) => l.id === id);
      if (found) return found;
    }
    return null;
  }
}

function countDescendants(nodeId: string, all: SpatialLocation[]): { count: number; occupancyPct: number } {
  const leaves: SpatialLocation[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const loc of all) {
      if (loc.parentId === current) {
        if (loc.kind === 'location') leaves.push(loc);
        else queue.push(loc.id);
      }
    }
  }
  const total = leaves.length;
  const occupied = leaves.filter((l) => l.status === 'occupied').length;
  return { count: total, occupancyPct: total > 0 ? Math.round((occupied / total) * 100) : 0 };
}
