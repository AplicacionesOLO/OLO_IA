/**
 * DATOS DEMO — deterministas, 3 rows, reasonable body counts.
 */

export interface DemoRack {
  code: string;
  row: number;
  col: number;
  bodies: number;
  levels: number;
  positions: number;
  occupancy: boolean[][][];
  labeled: boolean;
  eventOrder: number;
}

function genOccupancy(bodies: number, levels: number, positions: number, seed: number): boolean[][][] {
  const map: boolean[][][] = [];
  for (let b = 0; b < bodies; b++) {
    const bodyMap: boolean[][] = [];
    for (let l = 0; l < levels; l++) {
      const levelMap: boolean[] = [];
      for (let p = 0; p < positions; p++) {
        const idx = seed + b * 17 + l * 7 + p * 3;
        levelMap.push(idx % 3 !== 0);
      }
      bodyMap.push(levelMap);
    }
    map.push(bodyMap);
  }
  return map;
}

export const DEMO_RACKS: DemoRack[] = [
  // Row 0 (back)
  { code: 'RCL-03', row: 0, col: 0, bodies: 8, levels: 7, positions: 2, occupancy: genOccupancy(8, 7, 2, 1), labeled: true, eventOrder: 1 },
  { code: 'RCL-04', row: 0, col: 1, bodies: 8, levels: 7, positions: 2, occupancy: genOccupancy(8, 7, 2, 13), labeled: false, eventOrder: -1 },
  { code: 'RCL-07', row: 0, col: 2, bodies: 7, levels: 7, positions: 2, occupancy: genOccupancy(7, 7, 2, 23), labeled: true, eventOrder: 3 },
  // Row 1 (middle — main focus)
  { code: 'RCL-01', row: 1, col: 0, bodies: 8, levels: 7, positions: 2, occupancy: genOccupancy(8, 7, 2, 37), labeled: true, eventOrder: 0 },
  { code: 'RCL-02', row: 1, col: 1, bodies: 8, levels: 7, positions: 2, occupancy: genOccupancy(8, 7, 2, 47), labeled: false, eventOrder: -1 },
  { code: 'RCL-05', row: 1, col: 2, bodies: 7, levels: 7, positions: 2, occupancy: genOccupancy(7, 7, 2, 59), labeled: true, eventOrder: 2 },
  // Row 2 (front)
  { code: 'RCL-06', row: 2, col: 0, bodies: 8, levels: 7, positions: 2, occupancy: genOccupancy(8, 7, 2, 71), labeled: false, eventOrder: -1 },
  { code: 'RCL-08', row: 2, col: 1, bodies: 7, levels: 6, positions: 2, occupancy: genOccupancy(7, 6, 2, 83), labeled: false, eventOrder: -1 },
];

/**
 * Layout constants.
 * RACK_GAP_X: space between racks in the same row.
 * AISLE_GAP_Y: space between rows (the aisle) — must be large enough to avoid overlap.
 */
export const LAYOUT = {
  RACK_GAP_X: 18,
  AISLE_GAP_Y: 85,
  cellWidth: 16,
  cellDepth: 14,
  cellHeight: 14,
  beamHeight: 2,
} as const;

/** Compute the world-space X position for a rack given its row and column. */
export function rackWorldX(rack: DemoRack): number {
  // Accumulate X from all racks in the same row before this one
  let x = 0;
  for (const r of DEMO_RACKS) {
    if (r.row === rack.row && r.col < rack.col) {
      x += r.bodies * LAYOUT.cellWidth + LAYOUT.RACK_GAP_X;
    }
  }
  return x;
}

/** Compute the world-space Y position for a rack given its row. */
export function rackWorldY(rack: DemoRack): number {
  return rack.row * (LAYOUT.cellDepth + LAYOUT.AISLE_GAP_Y);
}

export function rackLocationCount(rack: DemoRack): number {
  return rack.bodies * rack.levels * rack.positions;
}

export const EVENT_RACKS = DEMO_RACKS
  .filter((r) => r.eventOrder >= 0)
  .sort((a, b) => a.eventOrder - b.eventOrder);
