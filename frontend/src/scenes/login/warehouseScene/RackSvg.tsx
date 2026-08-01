/**
 * RACK SVG — industrial rack with real structure and pallets.
 *
 * Each rack has:
 *   - 4 main posts (front-left, front-right, back-left, back-right)
 *   - Horizontal beams per level (front and back)
 *   - Depth connectors between front/back
 *   - Diagonal braces on end frames
 *   - Contact shadow on floor
 *   - Pallets: tarima (base) + cajas (volume) with 4 variants
 *
 * Color palette from reference:
 *   Posts: #17324A / #214A68
 *   Beams: #9A5424 / #B2672E
 *   Tech border: #1A7896
 *   Selection: #00D8FF
 *   Pallet wood: #7B5A3C / #A47A4B
 *   Cardboard: #8B7962 / #B09A7A
 *   Plastic: #374A5E / #55697F
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
  depthFactor: number;
}

// Palette
const POST_FRONT = '#214A68';
const POST_BACK = '#0E2438';
const BEAM_COLOR = '#9A5424';
const BEAM_BACK = '#5C3216';
const CONNECTOR = '#153248';
const HIGHLIGHT_CYAN = '#00D8FF';

const PALLET_VARIANTS = [
  { front: '#A47042', top: '#C49A5E', side: '#7A5230' }, // wood — brighter
  { front: '#A89270', top: '#CCBA92', side: '#806A50' }, // cardboard — lighter
  { front: '#4A6278', top: '#6E8CA0', side: '#344A5A' }, // plastic blue — more contrast
  { front: '#8A6A4A', top: '#B09060', side: '#5E4838' }, // dark wood — warmer
];

export const RackSvg = memo(function RackSvg({ rack, baseX, baseY, highlighted, eventActive, depthFactor }: RackSvgProps) {
  const { cellWidth, cellDepth, cellHeight } = LAYOUT;
  const totalW = rack.bodies * cellWidth;
  const totalH = rack.levels * cellHeight;
  // Stronger depth-based opacity: back racks are subtly dimmer, not transparent
  const opacity = 0.92 - depthFactor * 0.3;
  const elements: JSX.Element[] = [];

  // ── FLOOR SHADOW ──────────────────────────────────────────────────────
  const sfl = project(baseX - 2, baseY - 1, 0);
  const sfr = project(baseX + totalW + 2, baseY - 1, 0);
  const sbr = project(baseX + totalW + 2, baseY + cellDepth + 2, 0);
  const sbl = project(baseX - 2, baseY + cellDepth + 2, 0);
  elements.push(
    <polygon key="shadow" points={`${sfl.sx},${sfl.sy} ${sfr.sx},${sfr.sy} ${sbr.sx},${sbr.sy} ${sbl.sx},${sbl.sy}`}
      fill="rgba(0,10,20,0.4)" stroke="none" />,
  );

  // ── BACK FRAME (darker) ───────────────────────────────────────────────
  // Back posts
  for (const bx of [baseX, baseX + totalW]) {
    const bot = project(bx, baseY + cellDepth, 0);
    const top = project(bx, baseY + cellDepth, totalH);
    elements.push(<line key={`bpost-${bx}`} x1={bot.sx} y1={bot.sy} x2={top.sx} y2={top.sy} stroke={POST_BACK} strokeWidth={1.8 * opacity} />);
  }
  // Back beams
  for (let l = 0; l <= rack.levels; l++) {
    const z = l * cellHeight;
    const a = project(baseX, baseY + cellDepth, z);
    const b = project(baseX + totalW, baseY + cellDepth, z);
    elements.push(<line key={`bbeam-${l}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke={BEAM_BACK} strokeWidth={l === 0 ? 1.5 : 0.7} opacity={0.6 * opacity} />);
  }

  // ── DEPTH CONNECTORS ──────────────────────────────────────────────────
  for (const bx of [baseX, baseX + totalW]) {
    for (let l = 0; l <= rack.levels; l += 2) {
      const z = l * cellHeight;
      const f = project(bx, baseY, z);
      const b = project(bx, baseY + cellDepth, z);
      elements.push(<line key={`conn-${bx}-${l}`} x1={f.sx} y1={f.sy} x2={b.sx} y2={b.sy} stroke={CONNECTOR} strokeWidth={0.7} opacity={0.5 * opacity} />);
    }
    // Diagonal braces on end frames
    const diagBot = project(bx, baseY, 0);
    const diagTop = project(bx, baseY + cellDepth, totalH * 0.4);
    elements.push(<line key={`diag-${bx}`} x1={diagBot.sx} y1={diagBot.sy} x2={diagTop.sx} y2={diagTop.sy} stroke={CONNECTOR} strokeWidth={0.5} opacity={0.3 * opacity} strokeDasharray="3,2" />);
  }

  // ── PALLETS (rendered BETWEEN frames for depth) ───────────────────────
  if (depthFactor < 0.8) {
    for (let b = 0; b < rack.bodies; b++) {
      for (let l = 0; l < rack.levels; l++) {
        for (let p = 0; p < rack.positions; p++) {
          if (!rack.occupancy[b]?.[l]?.[p]) continue;
          drawPallet(elements, baseX, baseY, b, l, p, rack, opacity);
        }
      }
    }
  }

  // ── FRONT FRAME (brightest) ───────────────────────────────────────────
  // Front posts (thicker)
  for (let b = 0; b <= rack.bodies; b++) {
    const px = baseX + b * cellWidth;
    const bot = project(px, baseY, 0);
    const top = project(px, baseY, totalH);
    const isEnd = b === 0 || b === rack.bodies;
    const color = highlighted ? HIGHLIGHT_CYAN : POST_FRONT;
    elements.push(
      <line key={`fpost-${b}`} x1={bot.sx} y1={bot.sy} x2={top.sx} y2={top.sy}
        stroke={color} strokeWidth={(isEnd ? 2.2 : 0.8) * opacity}
        opacity={isEnd ? opacity : 0.6 * opacity} />,
    );
  }

  // Front beams (orange industrial)
  for (let l = 0; l <= rack.levels; l++) {
    const z = l * cellHeight;
    const a = project(baseX, baseY, z);
    const b = project(baseX + totalW, baseY, z);
    const color = highlighted ? '#D4863A' : BEAM_COLOR;
    elements.push(
      <line key={`fbeam-${l}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy}
        stroke={color} strokeWidth={l === 0 ? 2.0 : 1.0} opacity={opacity} />,
    );
  }

  // ── TOP CAP (closes the rack visually) ────────────────────────────────
  const tfl = project(baseX, baseY, totalH);
  const tfr = project(baseX + totalW, baseY, totalH);
  const tbr = project(baseX + totalW, baseY + cellDepth, totalH);
  const tbl = project(baseX, baseY + cellDepth, totalH);
  elements.push(
    <polygon key="topcap"
      points={`${tfl.sx},${tfl.sy} ${tfr.sx},${tfr.sy} ${tbr.sx},${tbr.sy} ${tbl.sx},${tbl.sy}`}
      fill="none" stroke={highlighted ? HIGHLIGHT_CYAN : POST_FRONT}
      strokeWidth={0.6} opacity={0.4 * opacity} />,
  );

  // ── HIGHLIGHT GLOW (selection) ────────────────────────────────────────
  if (highlighted) {
    const fl = project(baseX, baseY, 0);
    const fr = project(baseX + totalW, baseY, 0);
    const ftl = project(baseX, baseY, totalH);
    const ftr = project(baseX + totalW, baseY, totalH);
    elements.push(
      <polygon key="highlight"
        points={`${fl.sx},${fl.sy} ${fr.sx},${fr.sy} ${ftr.sx},${ftr.sy} ${ftl.sx},${ftl.sy}`}
        fill="none" stroke={HIGHLIGHT_CYAN} strokeWidth={1.2} opacity={0.35} />,
    );
  }

  // ── EVENT ─────────────────────────────────────────────────────────────
  if (eventActive) {
    // Pulse on a specific location (body 3, level 4)
    const evB = Math.min(3, rack.bodies - 1);
    const evL = Math.min(4, rack.levels - 1);
    const evZ = evL * cellHeight + cellHeight / 2;
    const evX = baseX + evB * cellWidth + cellWidth / 2;
    const pt = project(evX, baseY, evZ);
    elements.push(
      <circle key="ev-pulse" cx={pt.sx} cy={pt.sy} r={4}
        fill={HIGHLIGHT_CYAN} opacity={0.7} className="olo-pulse" />,
    );
    elements.push(
      <circle key="ev-ring" cx={pt.sx} cy={pt.sy} r={10}
        fill="none" stroke={HIGHLIGHT_CYAN} strokeWidth={0.8} opacity={0.4}
        className="olo-breathe" />,
    );
  }

  return <g data-rack={rack.code} opacity={opacity}>{elements}</g>;
});

// ── PALLET DRAWING ──────────────────────────────────────────────────────────

function drawPallet(
  elements: JSX.Element[],
  baseX: number, baseY: number,
  b: number, l: number, p: number,
  _rack: DemoRack, opacity: number,
) {
  const { cellWidth, cellDepth, cellHeight, beamHeight } = LAYOUT;
  const variant = (b * 5 + l * 3 + p * 7) % 4;
  const pal = PALLET_VARIANTS[variant]!;

  const palletGap = 1.5; // vertical gap above beam — separates pallet from structure
  const px = baseX + b * cellWidth + p * (cellWidth / 2) + 1.5;
  const py = baseY + 2;
  const pz = l * cellHeight + beamHeight + palletGap;
  const pw = cellWidth / 2 - 3;
  const ph = cellHeight - beamHeight - palletGap - 2.5;
  const pd = cellDepth - 5;

  // Front face (largest, most visible)
  const fbl = project(px, py, pz);
  const fbr = project(px + pw, py, pz);
  const ftl = project(px, py, pz + ph);
  const ftr = project(px + pw, py, pz + ph);
  elements.push(
    <polygon key={`pf-${b}-${l}-${p}`}
      points={`${fbl.sx},${fbl.sy} ${fbr.sx},${fbr.sy} ${ftr.sx},${ftr.sy} ${ftl.sx},${ftl.sy}`}
      fill={pal.front} stroke="rgba(10,20,30,0.4)" strokeWidth={0.3} opacity={opacity} />,
  );

  // Top face
  const tbl = project(px, py + pd, pz + ph);
  const tbr = project(px + pw, py + pd, pz + ph);
  elements.push(
    <polygon key={`pt-${b}-${l}-${p}`}
      points={`${ftl.sx},${ftl.sy} ${ftr.sx},${ftr.sy} ${tbr.sx},${tbr.sy} ${tbl.sx},${tbl.sy}`}
      fill={pal.top} stroke="none" opacity={0.9 * opacity} />,
  );

  // Side face (right edge — gives volume)
  const sbr = project(px + pw, py + pd, pz);
  elements.push(
    <polygon key={`ps-${b}-${l}-${p}`}
      points={`${fbr.sx},${fbr.sy} ${sbr.sx},${sbr.sy} ${tbr.sx},${tbr.sy} ${ftr.sx},${ftr.sy}`}
      fill={pal.side} stroke="none" opacity={0.75 * opacity} />,
  );

  // Tarima base stripe (darker horizontal line near bottom to suggest wooden pallet base)
  const baseH = ph * 0.18;
  const tBase = project(px, py, pz + baseH);
  const tBaseR = project(px + pw, py, pz + baseH);
  elements.push(
    <line key={`tb-${b}-${l}-${p}`}
      x1={fbl.sx} y1={fbl.sy} x2={fbr.sx} y2={fbr.sy}
      stroke="rgba(60,40,20,0.6)" strokeWidth={0.9} opacity={opacity} />,
  );
  elements.push(
    <line key={`tb2-${b}-${l}-${p}`}
      x1={tBase.sx} y1={tBase.sy} x2={tBaseR.sx} y2={tBaseR.sy}
      stroke="rgba(60,40,20,0.4)" strokeWidth={0.5} opacity={opacity} />,
  );

  // Top edge highlight (subtle light line on top-front edge, separates from level above)
  elements.push(
    <line key={`th-${b}-${l}-${p}`}
      x1={ftl.sx} y1={ftl.sy} x2={ftr.sx} y2={ftr.sy}
      stroke="rgba(200,180,140,0.25)" strokeWidth={0.4} opacity={opacity} />,
  );
}
