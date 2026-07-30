/**
 * DATOS DE DESARROLLO — MODULO SPATIAL
 *
 * Dataset deterministico pequeño. Reproduce una estructura real:
 *   Almacen → Zonas (A, B, C) → Pasillos → Bahias → Niveles → Posiciones
 *
 * Solo se usa cuando no hay backend. El flag es la existencia del adaptador real.
 */

import type { LocationStatus, SpatialLocation, WarehouseOption } from '../types/index';

export const DEV_WAREHOUSES: WarehouseOption[] = [
  { id: '55555555-5555-4555-8555-555555555555', name: 'Almacen Central', code: 'WH-001' },
  { id: '66666666-6666-4666-8666-666666666666', name: 'Almacen Norte', code: 'WH-002' },
];

const S: LocationStatus[] = ['occupied', 'available', 'inferred', 'invalid', 'available', 'occupied'];

function pos(zoneIdx: number, aisle: number, bay: number, level: number): SpatialLocation {
  const zone = String.fromCharCode(65 + zoneIdx);
  const code = `${zone}-${String(aisle).padStart(2, '0')}-${String(bay).padStart(2, '0')}-${level}`;
  const status = S[(zoneIdx * 7 + aisle * 3 + bay * 2 + level) % S.length]!;
  const capacity = 10 + ((bay * 3 + level) % 8);
  const occupied = status === 'occupied' ? Math.min(capacity, 3 + ((aisle + bay) % (capacity - 1)))
    : status === 'inferred' ? Math.ceil(capacity * 0.6)
    : 0;

  return {
    id: `loc-${zone.toLowerCase()}-${aisle}-${bay}-${level}`,
    code,
    name: null,
    kind: 'position',
    status,
    parentId: `bay-${zone.toLowerCase()}-${aisle}-${bay}`,
    capacity,
    occupied,
    lastVerifiedAt: status === 'inferred' ? null : new Date(Date.now() - (aisle * bay * level * 3_600_000)).toISOString(),
    dimensions: { width: 1.2, depth: 1.0, height: 1.8 },
  };
}

function generateLocations(warehouseId: string): SpatialLocation[] {
  const isMain = warehouseId === DEV_WAREHOUSES[0]!.id;
  const zones = isMain ? 3 : 2;
  const aisles = isMain ? 4 : 3;
  const bays = isMain ? 6 : 4;
  const levels = 3;

  const result: SpatialLocation[] = [];

  for (let z = 0; z < zones; z++) {
    const zone = String.fromCharCode(65 + z);
    const zoneId = `zone-${zone.toLowerCase()}`;

    result.push({
      id: zoneId,
      code: `Zona ${zone}`,
      name: `Zona ${zone}`,
      kind: 'zone',
      status: 'available',
      parentId: null,
      capacity: aisles * bays * levels * 12,
      occupied: 0, // se calcula despues
      lastVerifiedAt: new Date().toISOString(),
      dimensions: null,
    });

    for (let a = 1; a <= aisles; a++) {
      const aisleId = `aisle-${zone.toLowerCase()}-${a}`;
      result.push({
        id: aisleId,
        code: `${zone}-${String(a).padStart(2, '0')}`,
        name: `Pasillo ${zone}-${a}`,
        kind: 'aisle',
        status: 'available',
        parentId: zoneId,
        capacity: bays * levels * 12,
        occupied: 0,
        lastVerifiedAt: new Date().toISOString(),
        dimensions: null,
      });

      for (let b = 1; b <= bays; b++) {
        const bayId = `bay-${zone.toLowerCase()}-${a}-${b}`;
        result.push({
          id: bayId,
          code: `${zone}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`,
          name: null,
          kind: 'bay',
          status: 'available',
          parentId: aisleId,
          capacity: levels * 12,
          occupied: 0,
          lastVerifiedAt: new Date().toISOString(),
          dimensions: null,
        });

        for (let l = 1; l <= levels; l++) {
          result.push(pos(z, a, b, l));
        }
      }
    }
  }

  // Recalcular ocupacion de padres
  const byId = new Map(result.map((r) => [r.id, r]));
  for (const loc of result) {
    if (loc.kind === 'position' && loc.occupied > 0) {
      let current = loc.parentId;
      while (current) {
        const parent = byId.get(current);
        if (parent) {
          parent.occupied += loc.occupied;
          current = parent.parentId;
        } else break;
      }
    }
  }

  return result;
}

// Pre-generar para los dos almacenes
const CACHE = new Map<string, SpatialLocation[]>();

export function getDevLocations(warehouseId: string): SpatialLocation[] {
  if (!CACHE.has(warehouseId)) {
    CACHE.set(warehouseId, generateLocations(warehouseId));
  }
  return CACHE.get(warehouseId)!;
}
