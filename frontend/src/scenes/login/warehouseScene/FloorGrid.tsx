/**
 * FLOOR GRID — isometric floor with visible lines and aisle lane markers.
 *
 * Aisle markers are rendered as semi-transparent bands between rack rows,
 * giving the scene a "painted warehouse floor" appearance.
 */

import { memo } from 'react';
import { project } from './projection';
import { DEMO_RACKS, LAYOUT, rackWorldY } from './demoData';

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

  // ── AISLE LANE MARKERS ────────────────────────────────────────────────
  // Render painted floor bands between each pair of rack rows.
  // Compute the Y range that falls between row N back-edge and row N+1 front-edge.
  const rows = [...new Set(DEMO_RACKS.map((r) => r.row))].sort((a, b) => a - b);
  const totalRowWidth = 350; // approximate X extent to cover all racks

  for (let i = 0; i < rows.length - 1; i++) {
    const rowBack = rows[i]!;
    const rowFront = rows[i + 1]!;
    // Back edge of the rear row
    const rearY = rackWorldY({ row: rowBack } as typeof DEMO_RACKS[0]) + LAYOUT.cellDepth;
    // Front edge of the next row
    const frontY = rackWorldY({ row: rowFront } as typeof DEMO_RACKS[0]);

    // Aisle band as a quad on the floor (z=0)
    const aisleStartY = rearY + 8;  // small gap from rack back
    const aisleEndY = frontY - 4;    // small gap from rack front
    const xStart = -20;
    const xEnd = totalRowWidth;

    // Center line (bright, like painted floor guide)
    const midY = (aisleStartY + aisleEndY) / 2;
    const cl1 = project(xStart, midY, 0);
    const cl2 = project(xEnd, midY, 0);
    lines.push(
      <line key={`aisle-center-${i}`}
        x1={cl1.sx} y1={cl1.sy} x2={cl2.sx} y2={cl2.sy}
        stroke="rgba(34,217,245,0.12)" strokeWidth={1.2} strokeDasharray="8,6" />,
    );

    // Edge lines (faint, defines aisle width)
    const el1a = project(xStart, aisleStartY, 0);
    const el1b = project(xEnd, aisleStartY, 0);
    const el2a = project(xStart, aisleEndY, 0);
    const el2b = project(xEnd, aisleEndY, 0);
    lines.push(
      <line key={`aisle-edge-top-${i}`}
        x1={el1a.sx} y1={el1a.sy} x2={el1b.sx} y2={el1b.sy}
        stroke="rgba(255,200,60,0.10)" strokeWidth={0.8} />,
    );
    lines.push(
      <line key={`aisle-edge-bot-${i}`}
        x1={el2a.sx} y1={el2a.sy} x2={el2b.sx} y2={el2b.sy}
        stroke="rgba(255,200,60,0.10)" strokeWidth={0.8} />,
    );

    // Subtle floor fill between edge lines (very transparent quad)
    const qa = project(xStart, aisleStartY, 0);
    const qb = project(xEnd, aisleStartY, 0);
    const qc = project(xEnd, aisleEndY, 0);
    const qd = project(xStart, aisleEndY, 0);
    lines.push(
      <polygon key={`aisle-fill-${i}`}
        points={`${qa.sx},${qa.sy} ${qb.sx},${qb.sy} ${qc.sx},${qc.sy} ${qd.sx},${qd.sy}`}
        fill="rgba(34,217,245,0.025)" stroke="none" />,
    );
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
