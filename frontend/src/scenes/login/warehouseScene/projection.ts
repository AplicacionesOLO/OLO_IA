/**
 * ISOMETRIC PROJECTION — login warehouse scene.
 *
 * Tighter framing: the warehouse fills 75-85% of the panel.
 * ViewBox calculated to wrap the rack bounding box tightly.
 */

export const VB_W = 1000;
export const VB_H = 680;

/** Project world (x, y, z) to screen (sx, sy). */
export function project(x: number, y: number, z: number): { sx: number; sy: number } {
  const isoX = (x - y) * 0.866;
  const isoY = (x + y) * 0.5 - z;
  // Offset tuned so racks fill the viewport diagonally
  return { sx: VB_W * 0.48 + isoX, sy: VB_H * 0.72 + isoY };
}
