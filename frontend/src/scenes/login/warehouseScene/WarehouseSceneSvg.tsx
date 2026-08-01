/**
 * WAREHOUSE SCENE SVG — compositor with computed viewBox.
 *
 * The viewBox is derived FROM the projected bounding box of the racks,
 * not hardcoded. This guarantees the warehouse fills 75-85% of the panel.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { computeBounds, project } from './projection';
import { DEMO_RACKS, EVENT_RACKS, LAYOUT, rackWorldX, rackWorldY } from './demoData';
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

  // Compute rack positions and collect all projected corner points
  const { racksPositioned, viewBox } = useMemo(() => {
    const allPoints: Array<{ sx: number; sy: number }> = [];
    const positioned = DEMO_RACKS.map((rack) => {
      const baseX = rackWorldX(rack);
      const baseY = rackWorldY(rack);
      const totalW = rack.bodies * LAYOUT.cellWidth;
      const totalH = rack.levels * LAYOUT.cellHeight;
      const d = LAYOUT.cellDepth;

      // Collect projected corners of the rack's bounding volume
      for (const [wx, wy, wz] of [
        [baseX, baseY, 0], [baseX + totalW, baseY, 0],
        [baseX, baseY + d, 0], [baseX + totalW, baseY + d, 0],
        [baseX, baseY, totalH], [baseX + totalW, baseY, totalH],
        [baseX, baseY + d, totalH], [baseX + totalW, baseY + d, totalH],
      ] as [number, number, number][]) {
        allPoints.push(project(wx, wy, wz));
      }

      const center = project(baseX + totalW / 2, baseY + d / 2, totalH * 0.75);
      const depthFactor = rack.row / Math.max(1, maxRow);
      return { rack, baseX, baseY, center, depthFactor };
    });

    // Compute bounds with padding
    const bounds = computeBounds(allPoints);
    const padX = bounds.width * 0.08;
    const padTop = bounds.height * 0.10;
    const padBottom = bounds.height * 0.16; // extra space for body labels + HUD
    const vb = `${bounds.minX - padX} ${bounds.minY - padTop} ${bounds.width + padX * 2} ${bounds.height + padTop + padBottom}`;

    return { racksPositioned: positioned, viewBox: vb };
  }, [maxRow]);

  // Sort back-to-front
  const sorted = useMemo(() => {
    return [...racksPositioned].sort((a, b) => a.rack.row - b.rack.row || a.rack.col - b.rack.col);
  }, [racksPositioned]);

  return (
    <svg
      viewBox={viewBox}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="wh-vig" cx="50%" cy="50%" r="80%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="100%" stopColor="rgba(2,8,17,0.55)" />
        </radialGradient>
      </defs>

      {/* Background */}
      <rect x="-9999" y="-9999" width="19998" height="19998" fill="#030a14" />

      {/* Floor grid (rendered in world space, project handles it) */}
      <FloorGrid />

      {/* Racks group (scene space, no extra transform needed — viewBox handles framing) */}
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

      {/* Labels — predefined positions to avoid collision */}
      {sorted
        .filter(({ rack }) => rack.labeled)
        .map(({ rack, center }) => {
          // Fixed label positions per rack code to prevent overlap
          const positions: Record<string, { ox: number; oy: number }> = {
            'RCL-01': { ox: -60, oy: -30 },
            'RCL-03': { ox: -55, oy: -50 },
            'RCL-05': { ox: 55, oy: -25 },
            'RCL-07': { ox: 60, oy: -50 },
          };
          const pos = positions[rack.code] ?? { ox: 0, oy: -40 };
          return (
            <RackLabel
              key={`lbl-${rack.code}`}
              rack={rack}
              anchorX={center.sx}
              anchorY={center.sy}
              offsetX={pos.ox}
              offsetY={pos.oy}
            />
          );
        })}

      {/* Level labels — ONLY for the event-active rack */}
      {(() => {
        const active = racksPositioned.find((r) => r.rack.code === activeEventCode);
        if (!active) return null;
        return Array.from({ length: active.rack.levels }, (_, l) => {
          const z = l * LAYOUT.cellHeight + LAYOUT.cellHeight / 2;
          const p = project(active.baseX - 10, active.baseY, z);
          return (
            <text key={`nl-${l}`} x={p.sx} y={p.sy} textAnchor="end"
              fill={l === 0 ? 'rgba(34,217,245,0.7)' : 'rgba(200,220,240,0.35)'}
              fontSize={6} fontFamily="var(--font-data)">
              N{String(l + 1).padStart(2, '0')}
            </text>
          );
        });
      })()}

      {/* Body labels — ONLY for event-active rack */}
      {(() => {
        const active = racksPositioned.find((r) => r.rack.code === activeEventCode);
        if (!active) return null;
        return Array.from({ length: Math.min(active.rack.bodies, 8) }, (_, b) => {
          const px = active.baseX + b * LAYOUT.cellWidth + LAYOUT.cellWidth / 2;
          const p = project(px, active.baseY + LAYOUT.cellDepth + 8, 0);
          return (
            <text key={`bl-${b}`} x={p.sx} y={p.sy} textAnchor="middle"
              fill="rgba(200,220,240,0.35)" fontSize={5} fontFamily="var(--font-data)">
              C{String(b + 1).padStart(3, '0')}
            </text>
          );
        });
      })()}

      {/* Vignette overlay (uses full rendered area) */}
      <rect x="-9999" y="-9999" width="19998" height="19998" fill="url(#wh-vig)" />
    </svg>
  );
});
