/**
 * Modelo de la red neuronal.
 *
 * PRINCIPIO DE HONESTIDAD: los nodos corresponden a ENTIDADES REALES
 * (almacenes, areas, dispositivos) y un pulso representa un EVENTO REAL
 * propagandose. Si la Mesh fuera decorativa, la metafora se caeria al primer
 * minuto de uso.
 *
 * En Capa 1 los nodos se generan proceduralmente porque todavia no hay datos.
 * La interfaz ya acepta nodos externos: cuando existan los endpoints, se pasan
 * por props y nada mas cambia.
 */

export interface MeshNode {
  id: string;
  /** Coordenadas normalizadas 0..1 sobre el viewBox. */
  x: number;
  y: number;
  /** Profundidad 0..1. 0 = al fondo (menos opaco, mas blur). */
  depth: number;
  /** Entidad que representa, cuando existe. */
  entity?: { type: string; id: string };
  /** Radio relativo. Los nodos que representan agregados son mayores. */
  weight?: number;
}

export interface MeshEdge {
  id: string;
  from: string;
  to: string;
  /** Fuerza del vinculo 0..1. Afecta a opacidad y grosor. */
  strength: number;
}

/** Un evento real viajando por una arista. */
export interface MeshPulse {
  id: string;
  edgeId: string;
  /** Naturaleza del evento: determina el color. */
  nature: 'measured' | 'inferred' | 'alert';
  /** Momento de inicio, en ms del reloj ambiental. */
  startedAt: number;
}

export type MeshDensity = 'minimal' | 'low' | 'medium' | 'high' | 'full';

/** Nodos por nivel de densidad. En SVG el techo practico es ~70. */
export const MESH_NODE_COUNT: Record<MeshDensity, number> = {
  minimal: 18,
  low: 28,
  medium: 40,
  high: 54,
  full: 68,
};

export interface MeshRendererProps {
  density: MeshDensity;
  /** Opacidad global de la capa. */
  opacity: number;
  /** Nodos externos. Si se omite, se generan proceduralmente. */
  nodes?: readonly MeshNode[];
  edges?: readonly MeshEdge[];
  pulses?: readonly MeshPulse[];
  /** Desactiva todo movimiento. */
  reducedMotion?: boolean;
  className?: string;
}
