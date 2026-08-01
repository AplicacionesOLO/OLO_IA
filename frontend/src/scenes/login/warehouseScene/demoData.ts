/**
 * DATOS DEMO DE LA ESCENA DE LOGIN — deterministas, sin Math.random().
 *
 * Define la configuracion visual de los racks del almacen demo.
 * SOLO para la escena del login. No conectado a SpatialRepository.
 */

export interface DemoRack {
  code: string;
  /** Posicion en la cuadricula del almacen (fila, columna). */
  row: number;
  col: number;
  bodies: number;
  levels: number;
  positions: number;
  /** Mapa de ocupacion: [body][level][position] = true si ocupado. */
  occupancy: boolean[][][];
  /** Si tiene etiqueta flotante visible. */
  labeled: boolean;
  /** Orden en la secuencia de eventos. -1 = no participa. */
  eventOrder: number;
}

/**
 * Genera mapa de ocupacion determinista.
 * Patron: celdas cuyo indice combinado es par estan ocupadas (determinista).
 */
function genOccupancy(bodies: number, levels: number, positions: number, seed: number): boolean[][][] {
  const map: boolean[][][] = [];
  for (let b = 0; b < bodies; b++) {
    const bodyMap: boolean[][] = [];
    for (let l = 0; l < levels; l++) {
      const levelMap: boolean[] = [];
      for (let p = 0; p < positions; p++) {
        // Deterministic pattern using seed
        const idx = seed + b * 17 + l * 7 + p * 3;
        levelMap.push(idx % 3 !== 0); // ~66% occupied
      }
      bodyMap.push(levelMap);
    }
    map.push(bodyMap);
  }
  return map;
}

export const DEMO_RACKS: DemoRack[] = [
  // Row 0 (back)
  {
    code: 'RCL-01', row: 0, col: 0,
    bodies: 6, levels: 7, positions: 2,
    occupancy: genOccupancy(6, 7, 2, 1),
    labeled: true, eventOrder: 0,
  },
  {
    code: 'RCL-02', row: 0, col: 1,
    bodies: 6, levels: 7, positions: 2,
    occupancy: genOccupancy(6, 7, 2, 11),
    labeled: false, eventOrder: -1,
  },
  {
    code: 'RCL-03', row: 0, col: 2,
    bodies: 5, levels: 6, positions: 2,
    occupancy: genOccupancy(5, 6, 2, 23),
    labeled: true, eventOrder: 1,
  },
  // Row 1 (middle)
  {
    code: 'RCL-04', row: 1, col: 0,
    bodies: 6, levels: 7, positions: 2,
    occupancy: genOccupancy(6, 7, 2, 37),
    labeled: false, eventOrder: -1,
  },
  {
    code: 'RCL-05', row: 1, col: 1,
    bodies: 8, levels: 7, positions: 2,
    occupancy: genOccupancy(8, 7, 2, 47),
    labeled: true, eventOrder: 2,
  },
  {
    code: 'RCL-06', row: 1, col: 2,
    bodies: 6, levels: 7, positions: 2,
    occupancy: genOccupancy(6, 7, 2, 59),
    labeled: false, eventOrder: -1,
  },
  // Row 2 (front)
  {
    code: 'RCL-07', row: 2, col: 0,
    bodies: 6, levels: 7, positions: 2,
    occupancy: genOccupancy(6, 7, 2, 71),
    labeled: true, eventOrder: 3,
  },
  {
    code: 'RCL-08', row: 2, col: 1,
    bodies: 5, levels: 6, positions: 2,
    occupancy: genOccupancy(5, 6, 2, 83),
    labeled: false, eventOrder: -1,
  },
];

/** Layout constants for positioning racks in isometric space. */
export const LAYOUT = {
  /** Spacing between rack columns (x direction). */
  colSpacing: 180,
  /** Spacing between rack rows (y direction — depth). */
  rowSpacing: 120,
  /** Origin offset to center the scene. */
  originX: -140,
  originY: -40,
  /** Single cell dimensions in world units. */
  cellWidth: 14,
  cellDepth: 10,
  cellHeight: 14,
  /** Beam height for each level. */
  beamHeight: 2,
  /** Gap between racks in a row. */
  rackGap: 8,
} as const;

/** Total locations for a rack. */
export function rackLocationCount(rack: DemoRack): number {
  return rack.bodies * rack.levels * rack.positions;
}

/** Event sequence racks, ordered. */
export const EVENT_RACKS = DEMO_RACKS
  .filter((r) => r.eventOrder >= 0)
  .sort((a, b) => a.eventOrder - b.eventOrder);
