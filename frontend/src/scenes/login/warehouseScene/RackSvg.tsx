/**
 * RACK SVG — un rack logístico completo con niveles, postes y pallets.
 *
 * Dibuja en coordenadas de pantalla (ya proyectadas). Recibe la posición base.
 * Cada nivel tiene vigas, y cada posición puede tener un pallet.
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
}

export const RackSvg = memo(function RackSvg({ rack, baseX, baseY, highlighted, eventActive }: RackSvgProps) {
  const { cellWidth, cellDepth, cellHeight, beamHeight } = LAYOUT;
  const totalWidth = rack.bodies * cellWidth;
  const totalHeight = rack.levels * cellHeight;

  const elements: JSX.Element[] = [];

  // Floor shadow
  const fl = project(baseX, baseY, 0);
  const fr = project(baseX + totalWidth, baseY, 0);
  const br = project(baseX + totalWidth, baseY + cellDepth, 0);
  const bl = project(baseX, baseY + cellDepth, 0);
  elements.push(
    <polygon
      key="shadow"
      points={`${fl.sx},${fl.sy} ${fr.sx},${fr.sy} ${br.sx},${br.sy} ${bl.sx},${bl.sy}`}
      fill="rgba(0,20,40,0.3)"
      stroke="none"
    />,
  );

  // Vertical posts (4 corners + intermediate per body)
  const postColor = highlighted ? 'rgba(34,217,245,0.6)' : 'rgba(60,100,150,0.5)';
  for (let b = 0; b <= rack.bodies; b++) {
    const px = baseX + b * cellWidth;
    // Front post
    const bot = project(px, baseY, 0);
    const top = project(px, baseY, totalHeight);
    elements.push(
      <line key={`pf-${b}`} x1={bot.sx} y1={bot.sy} x2={top.sx} y2={top.sy}
        stroke={postColor} strokeWidth={b === 0 || b === rack.bodies ? 1.2 : 0.6} />,
    );
    // Back post (only at ends)
    if (b === 0 || b === rack.bodies) {
      const bBot = project(px, baseY + cellDepth, 0);
      const bTop = project(px, baseY + cellDepth, totalHeight);
      elements.push(
        <line key={`pb-${b}`} x1={bBot.sx} y1={bBot.sy} x2={bTop.sx} y2={bTop.sy}
          stroke={postColor} strokeWidth={0.8} opacity={0.4} />,
      );
    }
  }

  // Horizontal beams per level
  const beamColor = highlighted ? 'rgba(245,158,11,0.7)' : 'rgba(180,100,40,0.4)';
  for (let l = 0; l <= rack.levels; l++) {
    const z = l * cellHeight;
    const lf = project(baseX, baseY, z);
    const rf = project(baseX + totalWidth, baseY, z);
    elements.push(
      <line key={`beam-${l}`} x1={lf.sx} y1={lf.sy} x2={rf.sx} y2={rf.sy}
        stroke={beamColor} strokeWidth={l === 0 ? 1.5 : 0.8} />,
    );
  }

  // Pallets / boxes in occupied positions
  for (let b = 0; b < rack.bodies; b++) {
    for (let l = 0; l < rack.levels; l++) {
      for (let p = 0; p < rack.positions; p++) {
        if (!rack.occupancy[b]?.[l]?.[p]) continue;

        const px = baseX + b * cellWidth + p * (cellWidth / 2) + 1;
        const pz = l * cellHeight + beamHeight;
        const pw = cellWidth / 2 - 2;
        const ph = cellHeight - beamHeight - 2;
        const pd = cellDepth - 2;

        // Pallet top face
        const ptl = project(px, baseY + 1, pz + ph);
        const ptr = project(px + pw, baseY + 1, pz + ph);
        const pbr = project(px + pw, baseY + pd, pz + ph);
        const pbl = project(px, baseY + pd, pz + ph);

        // Front face
        const fbl = project(px, baseY + 1, pz);
        const fbr = project(px + pw, baseY + 1, pz);

        // Determine pallet color by position (deterministic variety)
        const ci = (b * 7 + l * 3 + p) % 4;
        const palletColors = ['rgba(90,70,50,0.7)', 'rgba(70,80,100,0.6)', 'rgba(80,60,40,0.7)', 'rgba(60,75,90,0.6)'];
        const topColors = ['rgba(120,100,70,0.5)', 'rgba(90,100,120,0.4)', 'rgba(110,90,60,0.5)', 'rgba(80,95,110,0.4)'];

        elements.push(
          <g key={`pallet-${b}-${l}-${p}`}>
            {/* Front face */}
            <polygon
              points={`${fbl.sx},${fbl.sy} ${fbr.sx},${fbr.sy} ${ptr.sx},${ptr.sy} ${ptl.sx},${ptl.sy}`}
              fill={palletColors[ci]}
              stroke="rgba(40,60,80,0.3)"
              strokeWidth={0.3}
            />
            {/* Top face */}
            <polygon
              points={`${ptl.sx},${ptl.sy} ${ptr.sx},${ptr.sy} ${pbr.sx},${pbr.sy} ${pbl.sx},${pbl.sy}`}
              fill={topColors[ci]}
              stroke="rgba(40,60,80,0.2)"
              strokeWidth={0.3}
            />
          </g>,
        );
      }
    }
  }

  // Event glow
  if (eventActive) {
    const center = project(baseX + totalWidth / 2, baseY + cellDepth / 2, totalHeight / 2);
    elements.push(
      <circle key="glow" cx={center.sx} cy={center.sy} r={30}
        fill="none" stroke="rgba(34,217,245,0.4)" strokeWidth={1.5}
        className="olo-pulse" />,
    );
  }

  return <g data-rack={rack.code}>{elements}</g>;
});
