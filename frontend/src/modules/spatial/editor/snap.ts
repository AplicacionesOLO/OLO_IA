/**
 * SNAP + COLLISION — utilidades para el editor de layout.
 *
 * Snap to grid: redondea coordenadas al grid mas cercano.
 * Collision: AABB approximation (ignores rotation for this sprint).
 *   When rotation is 0 or 90 the AABB is exact.
 *   For other angles it's conservative (reports collision when AABB overlaps).
 *   TODO: implement OBB collision for arbitrary rotation.
 */

import type { PositionedRack, ValidationIssue } from './types';

/** Snap a coordinate to the nearest grid point. */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Snap a rack position to grid. */
export function snapRackToGrid(rack: PositionedRack, gridSize: number): { x: number; y: number } {
  return {
    x: snapToGrid(rack.x, gridSize),
    y: snapToGrid(rack.y, gridSize),
  };
}

/** Get AABB of a rack (conservative for rotated racks). */
function getRackAABB(rack: PositionedRack, ppm: number): { minX: number; minY: number; maxX: number; maxY: number } {
  const w = rack.width * ppm;
  const l = rack.length * ppm;

  // For 0° and 90° the AABB is exact
  const rot = ((rack.rotation % 360) + 360) % 360;
  if (rot === 0 || rot === 180) {
    return { minX: rack.x - w / 2, minY: rack.y - l / 2, maxX: rack.x + w / 2, maxY: rack.y + l / 2 };
  }
  if (rot === 90 || rot === 270) {
    return { minX: rack.x - l / 2, minY: rack.y - w / 2, maxX: rack.x + l / 2, maxY: rack.y + w / 2 };
  }

  // Arbitrary rotation: use bounding circle (conservative)
  const r = Math.sqrt(w * w + l * l) / 2;
  return { minX: rack.x - r, minY: rack.y - r, maxX: rack.x + r, maxY: rack.y + r };
}

/** Check if two AABBs overlap. */
function aabbOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** Detect collisions between racks. Returns pairs of colliding layout IDs. */
export function detectCollisions(racks: PositionedRack[], ppm: number): Array<[string, string]> {
  const collisions: Array<[string, string]> = [];

  for (let i = 0; i < racks.length; i++) {
    const aBox = getRackAABB(racks[i]!, ppm);
    for (let j = i + 1; j < racks.length; j++) {
      const bBox = getRackAABB(racks[j]!, ppm);
      if (aabbOverlap(aBox, bBox)) {
        collisions.push([racks[i]!.layoutId, racks[j]!.layoutId]);
      }
    }
  }

  return collisions;
}

/** Validate the current layout state. Returns all issues. */
export function validateLayout(
  racks: PositionedRack[],
  ppm: number,
  planWidth: number,
  planHeight: number,
  hasCalibration: boolean,
  hasOrigin: boolean,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!hasCalibration) {
    issues.push({ id: 'no-calibration', severity: 'warning', message: 'Escala no calibrada. Las medidas pueden no ser precisas.' });
  }

  if (!hasOrigin) {
    issues.push({ id: 'no-origin', severity: 'warning', message: 'Origen no definido. Las coordenadas del mundo no tienen referencia.' });
  }

  // Check each rack
  for (const rack of racks) {
    const aabb = getRackAABB(rack, ppm);

    // Out of plan bounds
    if (aabb.maxX < 0 || aabb.maxY < 0 || aabb.minX > planWidth || aabb.minY > planHeight) {
      issues.push({
        id: `out-of-plan-${rack.layoutId}`,
        severity: 'error',
        message: `${rack.rackCode} esta completamente fuera del plano.`,
        rackCode: rack.rackCode,
      });
    } else if (aabb.minX < 0 || aabb.minY < 0 || aabb.maxX > planWidth || aabb.maxY > planHeight) {
      issues.push({
        id: `partial-out-${rack.layoutId}`,
        severity: 'warning',
        message: `${rack.rackCode} esta parcialmente fuera del plano.`,
        rackCode: rack.rackCode,
      });
    }

    // No dimensions
    if (rack.width <= 0 || rack.length <= 0) {
      issues.push({
        id: `no-dims-${rack.layoutId}`,
        severity: 'error',
        message: `${rack.rackCode} no tiene dimensiones validas.`,
        rackCode: rack.rackCode,
      });
    }
  }

  // Collisions
  const collisions = detectCollisions(racks, ppm);
  for (const [a, b] of collisions) {
    const rackA = racks.find((r) => r.layoutId === a);
    const rackB = racks.find((r) => r.layoutId === b);
    if (rackA && rackB) {
      const rotA = ((rackA.rotation % 360) + 360) % 360;
      const rotB = ((rackB.rotation % 360) + 360) % 360;
      const isExact = [0, 90, 180, 270].includes(rotA) && [0, 90, 180, 270].includes(rotB);
      issues.push({
        id: `collision-${a}-${b}`,
        severity: 'warning',
        message: isExact
          ? `${rackA.rackCode} y ${rackB.rackCode}: superposicion detectada.`
          : `${rackA.rackCode} y ${rackB.rackCode}: posible superposicion.`,
        rackCode: rackA.rackCode,
      });
    }
  }

  return issues;
}
