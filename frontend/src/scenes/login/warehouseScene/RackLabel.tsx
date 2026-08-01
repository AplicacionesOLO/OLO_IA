/**
 * RACK LABEL — etiqueta flotante con linea conectora.
 */

import { memo } from 'react';
import { rackLocationCount } from './demoData';
import type { DemoRack } from './demoData';

interface RackLabelProps {
  rack: DemoRack;
  anchorX: number;
  anchorY: number;
  /** Offset para posicionar la etiqueta arriba del rack. */
  offsetX?: number;
  offsetY?: number;
}

export const RackLabel = memo(function RackLabel({ rack, anchorX, anchorY, offsetX = 0, offsetY = -40 }: RackLabelProps) {
  const labelX = anchorX + offsetX;
  const labelY = anchorY + offsetY;
  const locations = rackLocationCount(rack);

  return (
    <g className="rack-label">
      {/* Connector line */}
      <line
        x1={anchorX} y1={anchorY}
        x2={labelX} y2={labelY + 16}
        stroke="rgba(34,217,245,0.3)"
        strokeWidth={0.5}
        strokeDasharray="2,2"
      />
      {/* Anchor dot */}
      <circle cx={anchorX} cy={anchorY} r={2} fill="rgba(34,217,245,0.6)" />
      {/* Label background */}
      <rect
        x={labelX - 36} y={labelY - 4}
        width={72} height={28}
        rx={4}
        fill="rgba(10,30,50,0.85)"
        stroke="rgba(34,217,245,0.4)"
        strokeWidth={0.5}
      />
      {/* Code */}
      <text
        x={labelX} y={labelY + 8}
        textAnchor="middle"
        fill="rgba(34,217,245,0.9)"
        fontSize={9}
        fontFamily="var(--font-data)"
        fontWeight={600}
      >
        {rack.code}
      </text>
      {/* Location count */}
      <text
        x={labelX} y={labelY + 19}
        textAnchor="middle"
        fill="rgba(200,220,240,0.5)"
        fontSize={7}
        fontFamily="var(--font-data)"
      >
        {locations} ubicaciones
      </text>
    </g>
  );
});
