/**
 * MAPEADORES — DTO del backend → tipos internos del modulo.
 *
 * Aislados en un archivo propio porque:
 *  1. Si el backend cambia un campo, se corrige aqui y no en 12 componentes.
 *  2. Los tipos internos pueden divergir del API sin propagarse.
 *  3. Son funciones puras: testeables sin red.
 */

import type {
  LocationKind,
  LocationStatus,
  SpatialLocation,
  SpatialSummary,
  WarehouseOption,
} from '../types/index';
import type {
  SpatialLocationDto,
  SpatialSummaryDto,
  SpatialWarehouseDto,
} from './dto';

const VALID_STATUSES: Set<string> = new Set([
  'occupied', 'available', 'inferred', 'invalid', 'reserved', 'blocked',
]);

const VALID_KINDS: Set<string> = new Set([
  'zone', 'aisle', 'bay', 'level', 'position', 'bin',
]);

export function mapWarehouse(dto: SpatialWarehouseDto): WarehouseOption {
  return {
    id: dto.id,
    name: dto.name,
    code: dto.code,
  };
}

export function mapSummary(dto: SpatialSummaryDto): SpatialSummary {
  return {
    totalLocations: dto.total_locations,
    occupied: dto.occupied,
    available: dto.available,
    inferred: dto.inferred,
    invalid: dto.invalid,
    occupancyPercent: dto.occupancy_percent,
  };
}

export function mapLocation(dto: SpatialLocationDto): SpatialLocation {
  return {
    id: dto.id,
    code: dto.code,
    name: dto.name,
    kind: (VALID_KINDS.has(dto.kind) ? dto.kind : 'position') as LocationKind,
    status: (VALID_STATUSES.has(dto.status) ? dto.status : 'available') as LocationStatus,
    parentId: dto.parent_id,
    capacity: dto.capacity,
    occupied: dto.occupied,
    lastVerifiedAt: dto.last_verified_at,
    dimensions: dto.dimensions,
  };
}
