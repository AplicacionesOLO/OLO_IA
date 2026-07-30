/**
 * DOMINIO ESPACIAL — tipos
 *
 * Espeja las entidades de `spatial.*` definidas en ADR-010 y el plan del Bloque 3.
 * El arbol recursivo de nodos, las ubicaciones con coordenadas logicas y fisicas,
 * los marcos de referencia y los dispositivos (reservados).
 *
 * ⚠ BLOQUEADO POR BASE DE DATOS: las migraciones 0047-0052 aun no existen.
 * Estos tipos son el CONTRATO que el frontend espera. Si la forma final de las
 * tablas difiere, se ajustan aqui sin tocar los componentes.
 */

import type { BaseEntity } from '../shared/errors';

// ── Vocabularios ────────────────────────────────────────────────────────────

/**
 * Tipos estructurales de nodo. Cerrado por migracion: añadir uno requiere DDL.
 * Determina que puede colgar de que (la matriz de aristas).
 */
export type NodeType =
  | 'building'
  | 'floor'
  | 'zone'
  | 'aisle'
  | 'rack'
  | 'storage_area';

/**
 * Funciones del nodo. Catalogo ampliable sin DDL: es una tabla, no un CHECK.
 * Dice PARA QUE sirve el espacio, no QUE ES estructuralmente.
 */
export type NodeFunction =
  | 'storage'
  | 'picking'
  | 'receiving'
  | 'shipping'
  | 'dock'
  | 'buffer'
  | 'staging'
  | 'inspection'
  | 'quarantine'
  | 'returns'
  | 'bulk';

/** Estado operativo de una ubicacion. `occupied` y `reserved` NO estan:
 * la ocupacion es del snapshot, no del estante (ADR-010 §3.2). */
export type LocationStatus = 'available' | 'blocked' | 'maintenance';

/** Origen de los datos de la ubicacion. */
export type LocationOrigin = 'wms_catalog' | 'cad_import' | 'manual';

/** Tipo de marco de referencia. */
export type ReferenceFrameKind = 'local_cartesian' | 'geographic' | 'cad_native';

/** Estado de un dispositivo (reservado, ADR-010 §7). */
export type DeviceStatus = 'online' | 'offline' | 'maintenance' | 'decommissioned';

// ── Entidades ───────────────────────────────────────────────────────────────

/** Un sitio fisico. warehouse → site(s) → nodes → locations. */
export interface Site extends BaseEntity {
  warehouse_id: string;
  /** Codigo del sistema externo (Preambulo). NULL si no se ha validado. */
  external_site_code: string | null;
  name: string | null;
  is_validated: boolean;
}

/**
 * Marco de coordenadas.
 *
 * Dos familias coexisten (ADR-010 §3.1, BLOCK_3 §2):
 * - logical_*: indices del WMS, sin unidad. Se pueblan desde el catalogo.
 * - world_*: metros, PostGIS. Se pueblan desde CAD/escaneo.
 *
 * El marco dice EN QUE SISTEMA estan las coordenadas world_*.
 */
export interface ReferenceFrame extends BaseEntity {
  site_id: string;
  code: string;
  kind: ReferenceFrameKind;
  /** Unidad del sistema: 'meter', 'millimeter', etc. */
  unit: string;
  /** Convencion de ejes: 'right_hand_z_up', 'right_hand_y_up'. */
  axis_convention: string;
  /** Marco padre para transformaciones encadenadas. */
  parent_frame_id: string | null;
  /** Transformacion 4x4 al marco padre (JSON). NULL si es la raiz. */
  transform: number[] | null;
}

/**
 * Nodo del arbol espacial recursivo.
 *
 * NO es warehouse ni site (esos son tablas propias).
 * La raiz del arbol tiene parent_id === null y su site_id apunta al sitio.
 */
export interface SpatialNode extends BaseEntity {
  site_id: string;
  parent_id: string | null;
  node_type: NodeType;
  node_function: NodeFunction | null;
  node_code: string;
  /** Preambulo del WMS para nodos de area. */
  external_site_code: string | null;
  depth: number;
  metadata: Record<string, unknown>;
}

/**
 * Ubicacion: siempre la HOJA del arbol. Nada cuelga de una ubicacion.
 *
 * Lleva dos sistemas de coordenadas (BLOCK_3 §2):
 * - logical_*: indices del WMS, siempre poblados
 * - world_*: PostGIS, inicialmente NULL (se llenan con CAD)
 */
export interface Location extends BaseEntity {
  site_id: string;
  node_id: string;
  location_code: string;
  external_location_id: string | null;
  location_status: LocationStatus;
  origin: LocationOrigin;

  // Coordenadas logicas (indices del WMS, sin unidad)
  logical_column: number | null;
  logical_level: number | null;
  logical_position: number | null;
  logical_x: number | null;
  logical_y: number | null;
  logical_z: number | null;

  // Coordenadas fisicas (metros, PostGIS) — NULL hasta importar CAD
  world_position: GeoPoint | null;
  world_footprint: GeoPolygon | null;
  world_bbox: GeoPolygon | null;
  world_frame_id: string | null;

  // Capacidad
  max_weight_kg: number | null;
  max_volume_m3: number | null;
  max_units: number | null;

  /** True si es un area de suelo con multiples containers sin posicion fija. */
  is_bulk_area: boolean;

  metadata: Record<string, unknown>;
}

/**
 * Dispositivo fisico situado en el espacio (camara, sensor, AGV, robot).
 *
 * ⚠ RESERVADO. No se implementa en el Bloque 3, pero el tipo existe para que
 * perception pueda referenciarlo sin texto libre.
 */
export interface Device extends BaseEntity {
  site_id: string;
  node_id: string | null;
  reference_frame_id: string | null;
  device_type: string;
  device_code: string;
  status: DeviceStatus;
  /** Version del modelo de IA que corre en el borde, si aplica. */
  model_version_id: string | null;
  metadata: Record<string, unknown>;
}

// ── Geometria simplificada ──────────────────────────────────────────────────
// PostGIS vive en el backend. El frontend recibe GeoJSON y lo pinta.

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number, number]; // x, y, z en metros
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: [number, number, number][][];
}

// ── Arista legal del arbol ──────────────────────────────────────────────────

export interface NodeEdge {
  parent_type: NodeType;
  child_type: NodeType;
}

/** Definicion de una funcion de nodo (tabla catalogo del owner). */
export interface NodeFunctionDef {
  code: NodeFunction | string;
  display_name: string;
  wms_type_code: string | null;
  implies_bulk: boolean;
  is_active: boolean;
}
