/**
 * ISOMETRIC PROJECTION — pure math, no viewport assumptions.
 *
 * The viewBox is computed FROM the projected geometry, not hardcoded.
 * This module only does the 30° isometric transform.
 */

/** Project world (x, y, z) to isometric screen space (unscaled). */
export function project(x: number, y: number, z: number): { sx: number; sy: number } {
  const isoX = (x - y) * 0.866;
  const isoY = (x + y) * 0.5 - z;
  return { sx: isoX, sy: isoY };
}

/** Compute bounding box of an array of projected points. */
export function computeBounds(points: Array<{ sx: number; sy: number }>): {
  minX: number; minY: number; maxX: number; maxY: number; width: number; height: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.sx < minX) minX = p.sx;
    if (p.sy < minY) minY = p.sy;
    if (p.sx > maxX) maxX = p.sx;
    if (p.sy > maxY) maxY = p.sy;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
