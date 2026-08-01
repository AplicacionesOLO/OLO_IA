/**
 * WAREHOUSE SCENE SVG — la escena principal del login.
 *
 * Compone: FloorGrid + Racks + Labels + Event highlights.
 * Todo SVG isométrico, cero WebGL.
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
  // Event loop: cycle through EVENT_RACKS every 10s
  const [activeEventIdx, setActiveEventIdx] = useState(0);

  useEffect(() => {
    if (reducedMotion || EVENT_RACKS.length === 0) return;
    const interval = setInterval(() => {
      setActiveEventIdx((i) => (i + 1) % EVENT_RACKS.length);
    }, 10_000);
    return () => clearInterval(interval);
  }, [reducedMotion]);

  const activeEventCode = EVENT_RACKS[activeEventIdx]?.code ?? null;

  // Position each rack in world space
  const racksWithPositions = useMemo(() => {
    return DEMO_RACKS.map((rack) => {
      const baseX = LAYOUT.originX + rack.col * LAYOUT.colSpacing;
      const baseY = LAYOUT.originY + rack.row * LAYOUT.rowSpacing;
      const totalWidth = rack.bodies * LAYOUT.cellWidth;
      const totalHeight = rack.levels * LAYOUT.cellHeight;
      const center = project(baseX + totalWidth / 2, baseY + LAYOUT.cellDepth / 2, totalHeight);
      return { rack, baseX, baseY, center };
    });
  }, []);

  // Sort by depth (back racks first) for correct overlap
  const sorted = useMemo(() => {
    return [...racksWithPositions].sort((a, b) => (a.rack.row - b.rack.row) || (a.rack.col - b.rack.col));
  }, [racksWithPositions]);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {/* Defs: shared gradients and filters */}
      <defs>
        <radialGradient id="wh-vignette" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(4,8,15,0.7)" />
        </radialGradient>
      </defs>

      {/* Background gradient */}
      <rect width={VB_W} height={VB_H} fill="#040a14" />

      {/* Floor grid */}
      <FloorGrid />

      {/* Racks (sorted back-to-front for overlap) */}
      {sorted.map(({ rack, baseX, baseY }) => (
        <RackSvg
          key={rack.code}
          rack={rack}
          baseX={baseX}
          baseY={baseY}
          highlighted={rack.labeled}
          eventActive={activeEventCode === rack.code}
        />
      ))}

      {/* Labels for labeled racks */}
      {sorted
        .filter(({ rack }) => rack.labeled)
        .map(({ rack, center }) => (
          <RackLabel
            key={`label-${rack.code}`}
            rack={rack}
            anchorX={center.sx}
            anchorY={center.sy}
            offsetX={rack.col === 0 ? -50 : rack.col === 2 ? 50 : 0}
            offsetY={-50}
          />
        ))}

      {/* Level labels on the left side (for the back-left rack) */}
      <LevelLabels baseX={LAYOUT.originX} baseY={LAYOUT.originY} levels={7} />

      {/* Body labels on the floor (for front rack) */}
      <BodyLabels
        baseX={LAYOUT.originX + 2 * LAYOUT.colSpacing}
        baseY={LAYOUT.originY + 2 * LAYOUT.rowSpacing}
        bodies={6}
      />

      {/* Vignette overlay */}
      <rect width={VB_W} height={VB_H} fill="url(#wh-vignette)" />
    </svg>
  );
});

/** Level labels (N01-N07) on the left side of a rack. */
function LevelLabels({ baseX, baseY, levels }: { baseX: number; baseY: number; levels: number }) {
  const labels: JSX.Element[] = [];
  for (let l = 0; l < levels; l++) {
    const z = l * LAYOUT.cellHeight + LAYOUT.cellHeight / 2;
    const p = project(baseX - 12, baseY, z);
    labels.push(
      <text
        key={`lvl-${l}`}
        x={p.sx} y={p.sy}
        textAnchor="end"
        fill={l === 0 ? 'rgba(34,217,245,0.7)' : 'rgba(200,220,240,0.35)'}
        fontSize={7}
        fontFamily="var(--font-data)"
      >
        N{String(l + 1).padStart(2, '0')}
      </text>,
    );
  }
  return <g>{labels}</g>;
}

/** Body labels (C001-C00N) along the floor under a rack. */
function BodyLabels({ baseX, baseY, bodies }: { baseX: number; baseY: number; bodies: number }) {
  const labels: JSX.Element[] = [];
  for (let b = 0; b < bodies; b++) {
    const px = baseX + b * LAYOUT.cellWidth + LAYOUT.cellWidth / 2;
    const p = project(px, baseY + LAYOUT.cellDepth + 8, 0);
    labels.push(
      <text
        key={`body-${b}`}
        x={p.sx} y={p.sy}
        textAnchor="middle"
        fill="rgba(200,220,240,0.3)"
        fontSize={6}
        fontFamily="var(--font-data)"
      >
        C{String(b + 1).padStart(3, '0')}
      </text>,
    );
  }
  return <g>{labels}</g>;
}
