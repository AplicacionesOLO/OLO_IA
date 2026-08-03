/**
 * INVENTORY SERVICE
 *
 * Lee del espejo WMS. Proyecta "inventario" como la union de lo esperado (wms)
 * con lo observado (perception), sobre el espacio (spatial).
 *
 * ⚠ "Inventario" no es un schema: es un READ MODEL (ADR-009 §4). Este servicio
 * es la materializacion de esa consulta en el frontend.
 */

import { NotImplementedError } from '../shared/errors';
import type { StockPosition, StockSnapshot } from './types';

/** Resumen de ocupacion por zona/area. */
export interface OccupancySummary {
  nodeId: string;
  nodeName: string;
  totalLocations: number;
  occupiedLocations: number;
  totalContainers: number;
  occupancyPercent: number;
}

/** KPIs del snapshot publicado. */
export interface InventoryKpis {
  totalPositions: number;
  totalContainers: number;
  totalItems: number;
  totalLocationsUsed: number;
  occupancyPercent: number;
  snapshotVersion: number;
  snapshotDate: string;
}

export class InventoryService {
  /** Snapshot publicado actualmente. NULL si no hay ninguno. */
  async getCurrentSnapshot(): Promise<StockSnapshot | null> {
    throw new NotImplementedError('InventoryService.getCurrentSnapshot');
  }

  /** KPIs del snapshot publicado. */
  async getKpis(): Promise<InventoryKpis> {
    throw new NotImplementedError('InventoryService.getKpis');
  }

  /** Ocupacion agregada por nodo de primer nivel. */
  async getOccupancyByArea(): Promise<OccupancySummary[]> {
    throw new NotImplementedError('InventoryService.getOccupancyByArea');
  }

  /** Contenido de una ubicacion en el snapshot publicado. */
  async getLocationContent(_locationId: string): Promise<StockPosition[]> {
    throw new NotImplementedError('InventoryService.getLocationContent');
  }

  /** Busqueda de un container por QR/ID. */
  async findContainer(_query: string): Promise<StockPosition[]> {
    throw new NotImplementedError('InventoryService.findContainer');
  }

  /** Historial de versiones de snapshot. */
  async getSnapshotHistory(): Promise<StockSnapshot[]> {
    throw new NotImplementedError('InventoryService.getSnapshotHistory');
  }
}
