/**
 * RACK SVG — detailed 3D rack with depth, posts, beams, pallets.
 *
 * Palette: steel blue structure, orange-burnt beams, natural pallets, cyan highlights.
 */

import { memo } from 'react';
import { project } from './projection';
import type { DemoRack } from './demoData';
import { LAYOUT } from './demoData';

interface RackSvgProps {
  rack: DemoRack;
  baseX: number;
  baseY: number;
  highlighted: boolean;
  eventActive: boolean;
  depthFactor: number; // 0=front, 1=back — controls opacity/detail
}

export const RackSvg = memo(function RackSvg({ rack, baseX, baseY, highlighted, eventActive, depthFactor }: RackSvgProps) {
  const { cellWidth, cellDepth, cellHeight, beamHeight } = LAYOUT;
  const totalWidth = rack.bodies * cellWidth;
  const totalHeight = rack.levels * cellHeight;
  const opacity = 1 - depthFactor * 0.35;

  const elements: JSX.Element[] = [];

  // === BACK FRAME (darker, depth) ===
  const backColor = `rgba(30,50,80,${0.3 * opacity})`;
  for (let b = 0; b <= rack.bodies; b += Math.max(1, Math.floor(rack.bodies / 4))) {
    const px = baseX + b * cellWidth;
    const bot = project(px, baseY + cellDepth, 0);
    const top = project(px, baseY + cellDepth, totalHeight);
    elements.push(<line key={`bp-${b}`} x1={bot.sx} y1={bot.sy} x2={top.sx} y2={top.sy} stroke={backColor} strokeWidth={0.6} />);
  }
  // Back horizontals
  for (let l = 0; l <= rack.levels; l += 2) {
    const z = l * cellHeight;
    const lf = project(baseX, baseY + cellDepth, z);
    const rf = project(baseX + totalWidth, baseY + cellDepth, z);
    elements.push(<line key={`bh-${l}`} x1={lf.sx} y1={lf.sy} x2={rf.sx} y2={rf.sy} stroke={backColor} strokeWidth={0.4} />);
  }

  // === DEPTH CONNECTORS (side braces) ===
  const sideColor = `rgba(40,70,110,${0.25 * opacity})`;
  for (const bIdx of [0, rack.bodies]) {
    const px = baseX + bIdx * cellWidth;
    for (let l = 0; l <= rack.levels; l += 2) {
      const z = l * cellHeight;
      const front = project(px, baseY, z);
      const back = project(px, baseY + cellDepth, z);
      elements.push(<line key={`dc-${bIdx}-${l}`} x1={front.sx} y1={front.sy} x2={back.sx} y2={back.sy} stroke={sideColor} strokeWidth={0.4} />);
    }
  }

  // === FRONT FRAME ===
  // Vertical posts
  const postColor = highlighted ? `rgba(34,217,245,${0.7 * opacity})` : `rgba(50,80,120,${0.6 * opacity})`;
  for (let b = 0; b <= rack.bodies; b++) {
    const px = baseX + b * cellWidth;
    const bot = project(px, baseY, 0);
    const top = project(px, baseY, totalHeight);
    const sw = (b === 0 || b === rack.bodies) ? 1.0 : 0.4;
    elements.push(<line key={`fp-${b}`} x1={bot.sx} y1={bot.sy} x2={top.sx} y2={top.sy} stroke={postColor} strokeWidth={sw} />);
  }

  // Horizontal beams (orange-burnt, subtle)
  const beamColor = highlighted ? `rgba(220,140,50,${0.5 * opacity})` : `rgba(140,80,30,${0.35 * opacity})`;
  for (let l = 0; l <= rack.levels; l++) {
    const z = l * cellHeight;
    const lf = project(baseX, baseY, z);
    const rf = project(baseX + totalWidth, baseY, z);
    elements.push(<line key={`fb-${l}`} x1={lf.sx} y1={lf.sy} x2={rf.sx} y2={rf.sy} stroke={beamColor} strokeWidth={l === 0 ? 1.2 : 0.6} />);
  }

  // === PALLETS ===
  if (depthFactor < 0.7) { // Skip pallet detail for very back racks
    for (let b = 0; b < rack.bodies; b++) {
      for (let l = 0; l < rack.levels; l++) {
        for (let p = 0; p < rack.positions; p++) {
          if (!rack.occupancy[b]?.[l]?.[p]) continue;

          const px = baseX + b * cellWidth + p * (cellWidth / 2) + 0.5;
          const pz = l * cellHeight + beamHeight;
          const pw = cellWidth / 2 - 1;
          const ph = cellHeight - beamHeight - 1.5;
          const pd = cellDepth * 0.7;

          // Pallet variant (deterministic)
          const variant = (b * 5 + l * 3 + p) % 4;
          const fills = [
            { front: `rgba(130,100,60,${0.7 * opacity})`, top: `rgba(160,130,80,${0.5 * opacity})` },
            { front: `rgba(80,95,115,${0.65 * opacity})`, top: `rgba(100,120,140,${0.45 * opacity})` },
            { front: `rgba(110,85,55,${0.7 * opacity})`, top: `rgba(140,115,75,${0.5 * opacity})` },
            { front: `rgba(70,85,105,${0.6 * opacity})`, top: `rgba(90,110,130,${0.4 * opacity})` },
          ];
          const fill = fills[variant]!;

          // Front face
          const fbl = project(px, baseY, pz);
          const fbr = project(px + pw, baseY, pz);
          const ftl = project(px, baseY, pz + ph);
          const ftr = project(px + pw, baseY, pz + ph);
          elements.push(
            <polygon key={`pf-${b}-${l}-${p}`}
              points={`${fbl.sx},${fbl.sy} ${fbr.sx},${fbr.sy} ${ftr.sx},${ftr.sy} ${ftl.sx},${ftl.sy}`}
              fill={fill.front} stroke={`rgba(40,60,80,${0.2 * opacity})`} strokeWidth={0.2} />,
          );

          // Top face
          const tbl = project(px, baseY + pd, pz + ph);
          const tbr = project(px + pw, baseY + pd, pz + ph);
          elements.push(
            <polygon key={`pt-${b}-${l}-${p}`}
              points={`${ftl.sx},${ftl.sy} ${ftr.sx},${ftr.sy} ${tbr.sx},${tbr.sy} ${tbl.sx},${tbl.sy}`}
              fill={fill.top} stroke="none" />,
          );
        }
      }
    }
  }

  // === TOP CAP LINE ===
  const capColor = highlighted ? `rgba(34,217,245,${0.5 * opacity})` : `rgba(50,80,120,${0.3 * opacity})`;
  const tl = project(baseX, baseY, totalHeight);
  const tr = project(baseX + totalWidth, baseY, totalHeight);
  elements.push(<line key="cap" x1={tl.sx} y1={tl.sy} x2={tr.sx} y2={tr.sy} stroke={capColor} strokeWidth={0.8} />);

  // === EVENT GLOW ===
  if (eventActive) {
    const center = project(baseX + totalWidth / 2, baseY + cellDepth / 2, totalHeight / 2);
    elements.push(
      <circle key="ev-glow" cx={center.sx} cy={center.sy} r={20}
        fill="none" stroke="rgba(34,217,245,0.5)" strokeWidth={1.5}
        className="olo-pulse" />,
    );
  }

  return <g data-rack={rack.code} opacity={opacity}>{elements}</g>;
});
