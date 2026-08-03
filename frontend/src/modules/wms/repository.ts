/**
 * WMS REPOSITORY
 *
 * Acceso al espejo del sistema externo. Solo lectura por diseño (ADR-009 §3.4).
 * El unico metodo de escritura es `createSyncRun`: importar.
 */

import { NotImplementedError, type PagedResult } from '../shared/errors';
import type {
  Container,
  Item,
  Source,
  StockPosition,
  StockSnapshot,
  SyncRun,
} from './types';

export class WmsRepository {
  // ── Fuentes ─────────────────────────────────────────────────────────────
  async getSources(): Promise<Source[]> {
    throw new NotImplementedError('WmsRepository.getSources');
  }

  // ── Sincronizaciones ────────────────────────────────────────────────────
  async getSyncRuns(
    _sourceId: string,
    _options?: { cursor?: string; limit?: number },
  ): Promise<PagedResult<SyncRun>> {
    throw new NotImplementedError('WmsRepository.getSyncRuns');
  }

  async createSyncRun(_sourceId: string, _file: File): Promise<SyncRun> {
    throw new NotImplementedError('WmsRepository.createSyncRun');
  }

  // ── Snapshots ───────────────────────────────────────────────────────────
  async getSnapshots(
    _options?: { cursor?: string; limit?: number },
  ): Promise<PagedResult<StockSnapshot>> {
    throw new NotImplementedError('WmsRepository.getSnapshots');
  }

  async getSnapshot(_snapshotId: string): Promise<StockSnapshot> {
    throw new NotImplementedError('WmsRepository.getSnapshot');
  }

  async getPublishedSnapshot(): Promise<StockSnapshot | null> {
    throw new NotImplementedError('WmsRepository.getPublishedSnapshot');
  }

  async publishSnapshot(_snapshotId: string): Promise<StockSnapshot> {
    throw new NotImplementedError('WmsRepository.publishSnapshot');
  }

  // ── Posiciones ──────────────────────────────────────────────────────────
  async getPositions(
    _snapshotId: string,
    _options?: { locationId?: string; containerId?: string; itemId?: string; cursor?: string; limit?: number },
  ): Promise<PagedResult<StockPosition>> {
    throw new NotImplementedError('WmsRepository.getPositions');
  }

  // ── Articulos ───────────────────────────────────────────────────────────
  async getItems(
    _options?: { search?: string; cursor?: string; limit?: number },
  ): Promise<PagedResult<Item>> {
    throw new NotImplementedError('WmsRepository.getItems');
  }

  async getItem(_itemId: string): Promise<Item> {
    throw new NotImplementedError('WmsRepository.getItem');
  }

  // ── Containers ──────────────────────────────────────────────────────────
  async getContainers(
    _options?: { search?: string; cursor?: string; limit?: number },
  ): Promise<PagedResult<Container>> {
    throw new NotImplementedError('WmsRepository.getContainers');
  }

  async getContainer(_containerId: string): Promise<Container> {
    throw new NotImplementedError('WmsRepository.getContainer');
  }
}
