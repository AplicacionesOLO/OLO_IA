/**
 * AISLE VIEW — representacion de un pasillo con racks enfrentados.
 *
 * ← RCL01 RCL02 RCL03
 *         PASILLO 1
 *   RCL04 RCL05 RCL06 →
 *
 * Se siente como caminar dentro del almacen.
 */

import { cn } from '../../../../design/utils/cn';
import type { AisleModel } from '../../engine/RackModel';
import { RackView } from './RackView';

interface AisleViewProps {
  aisle: AisleModel;
  selectedId: string | null;
  highlightedRack: string | null;
  highlightedBody: string | null;
  highlightedLevel: string | null;
  onSelectPosition: (locationId: string) => void;
  compact?: boolean;
  className?: string;
}

export function AisleView({
  aisle,
  selectedId,
  highlightedRack,
  highlightedBody,
  highlightedLevel,
  onSelectPosition,
  compact = false,
  className,
}: AisleViewProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} data-aisle={aisle.code}>
      {/* Left side racks */}
      {aisle.leftRacks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {aisle.leftRacks.map((rack) => (
            <RackView
              key={rack.id}
              rack={rack}
              selectedId={selectedId}
              highlightedRack={highlightedRack}
              highlightedBody={highlightedBody}
              highlightedLevel={highlightedLevel}
              onSelectPosition={onSelectPosition}
              compact={compact}
            />
          ))}
        </div>
      )}

      {/* Aisle label (the floor between racks) */}
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="h-px flex-1 [background:var(--hairline)]" />
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-xs)] font-[var(--weight-medium)] uppercase tracking-[var(--tracking-label)] text-[var(--text-faint)]">
          {aisle.name}
        </span>
        <div className="h-px flex-1 [background:var(--hairline)]" />
      </div>

      {/* Right side racks */}
      {aisle.rightRacks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {aisle.rightRacks.map((rack) => (
            <RackView
              key={rack.id}
              rack={rack}
              selectedId={selectedId}
              highlightedRack={highlightedRack}
              highlightedBody={highlightedBody}
              highlightedLevel={highlightedLevel}
              onSelectPosition={onSelectPosition}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}
