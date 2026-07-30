/**
 * TIPOS DEL MODULO SPATIAL
 *
 * Estos tipos representan el contrato que los componentes consumen. El
 * repositorio (real o temporal) debe devolver datos que se ajusten a estas
 * interfaces. Cuando el backend exponga /v1/locations, el adaptador real
 * mapeara la respuesta a estos mismos tipos sin tocar los componentes.
 */

/** Estado fisico/logico de una ubicacion. */
export type LocationStatus =
  | 'occupied'
  | 'available'
  | 'inferred'
  | 'invalid'
  | 'reserved'
  | 'blocked';

/** Tipo estructural de ubicacion. */
export type LocationKind =
  | 'zone'
  | 'aisle'
  | 'bay'
  | 'level'
  | 'position'
  | 'bin';

/** Una ubicacion en la jerarquia espacial. */
export interface SpatialLocation {
  id: string;
  /** Codigo legible: A-01-03-2 */
  code: string;
  /** Nombre descriptivo opcional. */
  name: string | null;
  kind: LocationKind;
  status: LocationStatus;
  /** ID del padre en la jerarquia. null = raiz (zona). */
  parentId: string | null;
  /** Capacidad maxima en unidades logicas. */
  capacity: number;
  /** Ocupacion actual. */
  occupied: number;
  /** Ultima vez que se confirmo el estado. ISO string. */
  lastVerifiedAt: string | null;
  /** Metadatos de dimension para el futuro 3D. */
  dimensions: { width: number; depth: number; height: number } | null;
}

/** Resumen de metricas de un almacen. */
export interface SpatialSummary {
  totalLocations: number;
  occupied: number;
  available: number;
  inferred: number;
  invalid: number;
  occupancyPercent: number;
}

/** Almacen disponible para el selector. */
export interface WarehouseOption {
  id: string;
  name: string;
  code: string;
}

/** Filtro para buscar ubicaciones. */
export interface LocationFilter {
  warehouseId: string;
  search?: string | undefined;
  status?: LocationStatus | undefined;
  parentId?: string | null | undefined;
}
