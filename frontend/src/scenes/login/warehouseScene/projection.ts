/**
 * ISOMETRIC PROJECTION for the login warehouse scene.
 *
 * 30° isometric: classic, readable, stable.
 * Viewbox: 1400×800 — gives room for labels and grid.
 */

export const VB_W = 1400;
export const VB_H = 800;

/** Project world (x, y, z) to screen (sx, sy). */
export function project(x: number, y: number, z: number): { sx: number; sy: number } {
  const isoX = (x - y) * 0.866;
  const isoY = (x + y) * 0.5 - z;
  return { sx: VB_W * 0.45 + isoX, sy: VB_H * 0.65 + isoY };
}
