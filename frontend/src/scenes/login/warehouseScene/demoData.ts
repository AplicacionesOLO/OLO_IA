/**
 * DATOS DEMO — deterministas. Denser layout for visual impact.
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
  // Row 0 (back) — long continuous racks
  { code: 'RCL-03', row: 0, col: 0, bodies: 10, levels: 7, positions: 2, occupancy: genOccupancy(10, 7, 2, 1), labeled: true, eventOrder: 1 },
  { code: 'RCL-04', row: 0, col: 1, bodies: 10, levels: 7, positions: 2, occupancy: genOccupancy(10, 7, 2, 13), labeled: false, eventOrder: -1 },
  // Row 1 (middle) — main focal racks
  { code: 'RCL-01', row: 1, col: 0, bodies: 12, levels: 7, positions: 2, occupancy: genOccupancy(12, 7, 2, 29), labeled: true, eventOrder: 0 },
  { code: 'RCL-02', row: 1, col: 1, bodies: 12, levels: 7, positions: 2, occupancy: genOccupancy(12, 7, 2, 41), labeled: false, eventOrder: -1 },
  // Row 2 (front-middle)
  { code: 'RCL-05', row: 2, col: 0, bodies: 12, levels: 7, positions: 2, occupancy: genOccupancy(12, 7, 2, 53), labeled: true, eventOrder: 2 },
  { code: 'RCL-06', row: 2, col: 1, bodies: 10, levels: 7, positions: 2, occupancy: genOccupancy(10, 7, 2, 67), labeled: false, eventOrder: -1 },
  // Row 3 (front)
  { code: 'RCL-07', row: 3, col: 0, bodies: 12, levels: 7, positions: 2, occupancy: genOccupancy(12, 7, 2, 79), labeled: true, eventOrder: 3 },
  { code: 'RCL-08', row: 3, col: 1, bodies: 10, levels: 6, positions: 2, occupancy: genOccupancy(10, 6, 2, 91), labeled: false, eventOrder: -1 },
];

/** Tighter spacing: racks close together with narrow aisles. */
export const LAYOUT = {
  colSpacing: 110,
  rowSpacing: 70,
  originX: -80,
  originY: -30,
  cellWidth: 11,
  cellDepth: 9,
  cellHeight: 11,
  beamHeight: 1.5,
  rackGap: 4,
} as const;

export function rackLocationCount(rack: DemoRack): number {
  return rack.bodies * rack.levels * rack.positions;
}

export const EVENT_RACKS = DEMO_RACKS
  .filter((r) => r.eventOrder >= 0)
  .sort((a, b) => a.eventOrder - b.eventOrder);
