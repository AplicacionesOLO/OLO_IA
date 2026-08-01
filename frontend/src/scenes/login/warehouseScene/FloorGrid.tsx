/**
 * FLOOR GRID — cuadricula isométrica del piso del almacen.
 */

import { memo } from 'react';
import { project } from './projection';

const GRID_SIZE = 30;
const GRID_EXTENT = 600;

export const FloorGrid = memo(function FloorGrid() {
  const lines: JSX.Element[] = [];

  // Grid lines in X direction
  for (let y = -GRID_EXTENT; y <= GRID_EXTENT; y += GRID_SIZE) {
    const a = project(-GRID_EXTENT, y, 0);
    const b = project(GRID_EXTENT, y, 0);
    lines.push(
      <line key={`gx-${y}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy}
        stroke="rgba(34,217,245,0.04)" strokeWidth={0.5} />,
    );
  }

  // Grid lines in Y direction
  for (let x = -GRID_EXTENT; x <= GRID_EXTENT; x += GRID_SIZE) {
    const a = project(x, -GRID_EXTENT, 0);
    const b = project(x, GRID_EXTENT, 0);
    lines.push(
      <line key={`gy-${x}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy}
        stroke="rgba(34,217,245,0.04)" strokeWidth={0.5} />,
    );
  }

  return <g className="floor-grid">{lines}</g>;
});
