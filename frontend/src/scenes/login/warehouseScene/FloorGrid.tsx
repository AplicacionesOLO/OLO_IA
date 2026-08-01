/**
 * FLOOR GRID — isometric floor with visible lines and aisle hints.
 */

import { memo } from 'react';
import { project } from './projection';

const GRID_MAIN = 50;
const GRID_SUB = 25;
const EXTENT = 500;

export const FloorGrid = memo(function FloorGrid() {
  const lines: JSX.Element[] = [];

  // Sub-grid (very faint)
  for (let y = -EXTENT; y <= EXTENT; y += GRID_SUB) {
    const a = project(-EXTENT, y, 0);
    const b = project(EXTENT, y, 0);
    lines.push(<line key={`sx-${y}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="rgba(34,217,245,0.03)" strokeWidth={0.3} />);
  }
  for (let x = -EXTENT; x <= EXTENT; x += GRID_SUB) {
    const a = project(x, -EXTENT, 0);
    const b = project(x, EXTENT, 0);
    lines.push(<line key={`sy-${x}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="rgba(34,217,245,0.03)" strokeWidth={0.3} />);
  }

  // Main grid (more visible)
  for (let y = -EXTENT; y <= EXTENT; y += GRID_MAIN) {
    const a = project(-EXTENT, y, 0);
    const b = project(EXTENT, y, 0);
    lines.push(<line key={`mx-${y}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="rgba(34,217,245,0.08)" strokeWidth={0.5} />);
  }
  for (let x = -EXTENT; x <= EXTENT; x += GRID_MAIN) {
    const a = project(x, -EXTENT, 0);
    const b = project(x, EXTENT, 0);
    lines.push(<line key={`my-${x}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="rgba(34,217,245,0.08)" strokeWidth={0.5} />);
  }

  // Center cross (axes hint)
  const cx = project(0, -EXTENT, 0);
  const cxe = project(0, EXTENT, 0);
  const cy = project(-EXTENT, 0, 0);
  const cye = project(EXTENT, 0, 0);
  lines.push(<line key="ax-x" x1={cx.sx} y1={cx.sy} x2={cxe.sx} y2={cxe.sy} stroke="rgba(34,217,245,0.12)" strokeWidth={0.6} />);
  lines.push(<line key="ax-y" x1={cy.sx} y1={cy.sy} x2={cye.sx} y2={cye.sy} stroke="rgba(34,217,245,0.12)" strokeWidth={0.6} />);

  return <g>{lines}</g>;
});
