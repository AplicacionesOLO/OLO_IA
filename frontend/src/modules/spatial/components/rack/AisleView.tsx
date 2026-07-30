/**
 * AISLE VIEW — placeholder.
 *
 * Hoy NO se usa: el parser no inventa pasillos. Cuando el backend entregue
 * aisle como dato estructurado, este componente se activa para mostrar
 * racks enfrentados con el pasillo entre ellos.
 *
 * Se mantiene como modulo exportado para que la interfaz no rompa.
 */

import type { RackVisual } from '../../engine/RackModel';
import { RackView } from './RackView';

interface AisleViewProps {
  label: string;
  leftRacks: RackVisual[];
  rightRacks: RackVisual[];
  selectedId: string | null;
  highlightedRack: string | null;
  highlightedBay: string | null;
  highlightedLevel: number | null;
  onSelectPosition: (locationId: string) => void;
}

export function AisleView({
  label,
  leftRacks,
  rightRacks,
  selectedId,
  highlightedRack,
  highlightedBay,
  highlightedLevel,
  onSelectPosition,
}: AisleViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {leftRacks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {leftRacks.map((rack) => (
            <RackView
              key={rack.code}
              rack={rack}
              selectedId={selectedId}
              highlightedRack={highlightedRack}
              highlightedBay={highlightedBay}
              highlightedLevel={highlightedLevel}
              onSelectPosition={onSelectPosition}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 px-3 py-1">
        <div className="h-px flex-1 [background:var(--hairline)]" />
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-2xs)] uppercase tracking-[var(--tracking-label)] text-[var(--text-faint)]">
          {label}
        </span>
        <div className="h-px flex-1 [background:var(--hairline)]" />
      </div>

      {rightRacks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {rightRacks.map((rack) => (
            <RackView
              key={rack.code}
              rack={rack}
              selectedId={selectedId}
              highlightedRack={highlightedRack}
              highlightedBay={highlightedBay}
              highlightedLevel={highlightedLevel}
              onSelectPosition={onSelectPosition}
            />
          ))}
        </div>
      )}
    </div>
  );
}
