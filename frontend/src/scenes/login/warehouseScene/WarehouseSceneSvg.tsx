/**
 * WAREHOUSE SCENE SVG — compositor principal.
 * Tight framing: racks fill 75-85% of the panel.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { project, VB_W, VB_H } from './projection';
import { DEMO_RACKS, EVENT_RACKS, LAYOUT } from './demoData';
import { FloorGrid } from './FloorGrid';
import { RackSvg } from './RackSvg';
import { RackLabel } from './RackLabel';

interface WarehouseSceneSvgProps {
  reducedMotion: boolean;
}

export const WarehouseSceneSvg = memo(function WarehouseSceneSvg({ reducedMotion }: WarehouseSceneSvgProps) {
  const [activeEventIdx, setActiveEventIdx] = useState(0);

  useEffect(() => {
    if (reducedMotion || EVENT_RACKS.length === 0) return;
    const interval = setInterval(() => {
      setActiveEventIdx((i) => (i + 1) % EVENT_RACKS.length);
    }, 10_000);
    return () => clearInterval(interval);
  }, [reducedMotion]);

  const activeEventCode = EVENT_RACKS[activeEventIdx]?.code ?? null;
  const maxRow = Math.max(...DEMO_RACKS.map((r) => r.row));

  const racksWithPositions = useMemo(() => {
    return DEMO_RACKS.map((rack) => {
      const baseX = LAYOUT.originX + rack.col * LAYOUT.colSpacing;
      const baseY = LAYOUT.originY + rack.row * LAYOUT.rowSpacing;
      const totalWidth = rack.bodies * LAYOUT.cellWidth;
      const totalHeight = rack.levels * LAYOUT.cellHeight;
      const center = project(baseX + totalWidth / 2, baseY + LAYOUT.cellDepth / 2, totalHeight * 0.8);
      const depthFactor = rack.row / Math.max(1, maxRow);
      return { rack, baseX, baseY, center, depthFactor };
    });
  }, [maxRow]);

  // Sort back-to-front for correct overlap
  const sorted = useMemo(() => {
    return [...racksWithPositions].sort((a, b) => a.rack.row - b.rack.row || a.rack.col - b.rack.col);
  }, [racksWithPositions]);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="wh-vig" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(2,8,17,0.6)" />
        </radialGradient>
      </defs>

      {/* Dark background */}
      <rect width={VB_W} height={VB_H} fill="#020a14" />

      {/* Floor grid */}
      <FloorGrid />

      {/* Racks */}
      {sorted.map(({ rack, baseX, baseY, depthFactor }) => (
        <RackSvg
          key={rack.code}
          rack={rack}
          baseX={baseX}
          baseY={baseY}
          highlighted={rack.labeled}
          eventActive={activeEventCode === rack.code}
          depthFactor={depthFactor}
        />
      ))}

      {/* Labels (only for labeled racks) */}
      {sorted
        .filter(({ rack }) => rack.labeled)
        .map(({ rack, center }) => (
          <RackLabel
            key={`lbl-${rack.code}`}
            rack={rack}
            anchorX={center.sx}
            anchorY={center.sy}
            offsetX={rack.col === 0 ? -30 : 30}
            offsetY={-35}
          />
        ))}

      {/* Level labels for the main rack (row 1, col 0) */}
      {(() => {
        const main = racksWithPositions.find((r) => r.rack.code === 'RCL-01');
        if (!main) return null;
        const labels: JSX.Element[] = [];
        for (let l = 0; l < main.rack.levels; l++) {
          const z = l * LAYOUT.cellHeight + LAYOUT.cellHeight / 2;
          const p = project(main.baseX - 8, main.baseY, z);
          labels.push(
            <text key={`nl-${l}`} x={p.sx} y={p.sy} textAnchor="end"
              fill={l === 0 ? 'rgba(34,217,245,0.7)' : 'rgba(200,220,240,0.3)'}
              fontSize={5.5} fontFamily="var(--font-data)">
              N{String(l + 1).padStart(2, '0')}
            </text>,
          );
        }
        return <g>{labels}</g>;
      })()}

      {/* Body labels for front rack */}
      {(() => {
        const front = racksWithPositions.find((r) => r.rack.code === 'RCL-07');
        if (!front) return null;
        const labels: JSX.Element[] = [];
        for (let b = 0; b < Math.min(front.rack.bodies, 12); b++) {
          const px = front.baseX + b * LAYOUT.cellWidth + LAYOUT.cellWidth / 2;
          const p = project(px, front.baseY + LAYOUT.cellDepth + 6, 0);
          labels.push(
            <text key={`bl-${b}`} x={p.sx} y={p.sy} textAnchor="middle"
              fill="rgba(200,220,240,0.25)" fontSize={4.5} fontFamily="var(--font-data)">
              C{String(b + 1).padStart(3, '0')}
            </text>,
          );
        }
        return <g>{labels}</g>;
      })()}

      {/* Vignette */}
      <rect width={VB_W} height={VB_H} fill="url(#wh-vig)" />
    </svg>
  );
});
