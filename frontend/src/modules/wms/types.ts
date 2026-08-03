/**
 * DOMINIO WMS — tipos
 *
 * Espejo del sistema externo de registro de la ejecucion del almacen.
 * Solo lectura para el usuario: cada fila declara de que sincronizacion proviene.
 *
 * Tres modelos coexisten en el mismo schema (ADR-012 §2):
 * - ESTADO (snapshot): como esta ahora → StockSnapshot, StockPosition
 * - EVENTO (solo-añadir): que paso → (futuro: movimientos, ajustes)
 * - DOCUMENTO (ciclo de vida): ordenes, recepciones → (futuro)
 *
 * El Bloque 3 solo implementa el primero. Los otros quedan nombrados para que
 * nadie meta movimientos en stock_positions.
 *
 * ⚠ BLOQUEADO POR BASE DE DATOS: migraciones 0053-0057.
 */

import type { BaseEntity } from '../shared/errors';

// ── Vocabularios ────────────────────────────────────────────────────────────

export type SyncMode = 'full' | 'incremental';
export type SyncTransport = 'file' | 'api' | 'queue';
export type SyncStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Ciclo de vida de un snapshot. Solo uno puede estar `published` a la vez
 * (indice unico parcial, misma tecnica que ai.model_versions). */
export type SnapshotStatus = 'draft' | 'published' | 'archived' | 'superseded';

export type SourceStatus = 'active' | 'paused' | 'decommissioned';

/** Tipo de contenedor. `pallet` es un tipo, no la entidad (ADR-011 §1). */
export type ContainerType = 'pallet' | 'tote' | 'box' | 'cage' | 'bulk' | 'master';

/** Origen de un container: importado del WMS o inferido de una mencion. */
export type ContainerOrigin = 'imported' | 'inferred';

// ── Entidades ───────────────────────────────────────────────────────────────

/**
 * Sistema externo concreto del que OLO recibe datos.
 * Es duradera: existe antes de la primera sincronizacion y sobrevive a todas.
 */
export interface Source extends BaseEntity {
  tenant_id: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  status: SourceStatus;
}

/**
 * Una ejecucion de traer datos de una fuente.
 * Hoy es un Excel que alguien sube; mañana puede ser una llamada API.
 */
export interface SyncRun extends BaseEntity {
  source_id: string;
  mode: SyncMode;
  transport: SyncTransport;
  /** SHA-256 del archivo para idempotencia. */
  file_sha256: string | null;
  status: SyncStatus;
  started_at: string;
  completed_at: string | null;

  /** Recuentos del procesamiento. */
  rows_total: number;
  rows_accepted: number;
  rows_rejected: number;
  rows_skipped: number;
}

/** Un rechazo individual durante la sincronizacion. Solo-añadir. */
export interface SyncRowError {
  id: string;
  sync_run_id: string;
  row_number: number;
  raw_content: Record<string, unknown>;
  error_code: string;
  error_message: string;
}

/**
 * Articulo: espejo del maestro del ERP/WMS.
 * Clave: (company_id, external_item_id). Verificado en ADR-011 §2.1.
 */
export interface Item extends BaseEntity {
  tenant_id: string;
  company_id: string;
  external_item_id: string;
  description: string;
  ean: string | null;
  erp_reference: string | null;
  family: string | null;
  subfamily: string | null;
  unit_of_measure: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Contenedor (unidad logistica). ADR-011 §1.
 *
 * NO es el soporte fisico reutilizable: es la carga que va encima.
 * 13 caracteres, alfanumerico, sin espacios (medido).
 * Los containers anidan: un tote dentro de un pallet dentro de una jaula.
 */
export interface Container extends BaseEntity {
  tenant_id: string;
  external_container_id: string;
  container_type: ContainerType;
  /** Padre en el arbol de anidacion. NULL si es raiz. */
  parent_container_id: string | null;
  /** El QR es un ATRIBUTO, no una entidad. Se usa sin transformar. */
  qr_value: string | null;
  origin: ContainerOrigin;
  metadata: Record<string, unknown>;
}

/**
 * Snapshot: fotografia inmutable y coherente de una porcion del dominio.
 *
 * Tres propiedades (ADR-012 §1.3):
 * - Inmutable: no se corrige un snapshot; se crea otro.
 * - Coherente: todas sus filas son del mismo corte.
 * - Completo dentro de su alcance (scope_note lo declara).
 */
export interface StockSnapshot extends BaseEntity {
  tenant_id: string;
  source_id: string;
  sync_run_id: string;
  /** Secuencia monotona dentro de (fuente, dominio, alcance). */
  snapshot_version: number;
  status: SnapshotStatus;
  /** El alcance DEBE declararse: "solo ubicaciones ocupadas", por ejemplo. */
  scope_note: string | null;
  published_at: string | null;
}

/**
 * Posicion de stock dentro de un snapshot.
 * Clave natural: (snapshot_id, location_id, container_id, item_id).
 * 0 duplicados en 41.055 filas (medido, ADR-010 M12).
 */
export interface StockPosition {
  id: string;
  snapshot_id: string;
  location_id: string;
  container_id: string;
  item_id: string;
  quantity_units: number;
  quantity_kg: number | null;
  metadata: Record<string, unknown>;
}
