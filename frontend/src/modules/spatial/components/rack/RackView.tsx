/**
 * RACK VIEW — representacion visual de un rack completo.
 *
 * Solo renderiza las posiciones que EXISTEN. No inventa la posicion 2
 * si solo existe la 1. Diferencia visualmente:
 *   - posicion existente con datos → color de estado
 *   - slot sin posicion → no se dibuja (no hay celda vacia)
 */

import { cn } from '../../../../design/utils/cn';
import type { BayVisual, PositionVisual, RackVisual } from '../../engine/RackModel';
import { STATUS_META } from '../StatusLegend';

interface RackViewProps {
  rack: RackVisual;
  selectedId: string | null;
  highlightedRack: string | null;
  highlightedBay: string | null;
  highlightedLevel: number | null;
  onSelectPosition: (locationId: string) => void;
}

export function RackView({
  rack,
  selectedId,
  highlightedRack,
  highlightedBay,
  highlightedLevel,
  onSelectPosition,
}: RackViewProps) {
  const isRackHighlighted = highlightedRack === rack.code;

  return (
    <div
      className={cn(
        'flex flex-col rounded-[var(--radius-md)] overflow-hidden',
        'border transition-all duration-200',
        isRackHighlighted
          ? 'border-[var(--accent)] shadow-[0_0_20px_-6px_var(--accent)]'
          : 'border-[var(--hairline)]',
      )}
    >
      {/* Rack header */}
      <div className="flex items-center justify-center px-2 py-1.5 [background:var(--glass-2)] border-b border-[var(--hairline)] font-[family-name:var(--font-data)] text-[length:var(--text-xs)] font-[var(--weight-medium)] text-[var(--text-primary)]">
        {rack.code}
      </div>

      {/* Bays (Cuerpos) */}
      <div className="flex flex-col divide-y divide-[var(--hairline)] [background:var(--glass-1)]">
        {rack.bays.map((bay) => (
          <BayView
            key={bay.code}
            bay={bay}
            selectedId={selectedId}
            highlightedBay={highlightedBay}
            highlightedLevel={highlightedLevel}
            onSelectPosition={onSelectPosition}
          />
        ))}
      </div>
    </div>
  );
}

function BayView({
  bay,
  selectedId,
  highlightedBay,
  highlightedLevel,
  onSelectPosition,
}: {
  bay: BayVisual;
  selectedId: string | null;
  highlightedBay: string | null;
  highlightedLevel: number | null;
  onSelectPosition: (locationId: string) => void;
}) {
  const isBayHighlighted = highlightedBay === bay.code;

  return (
    <div
      className={cn(
        'flex flex-col transition-colors duration-200',
        isBayHighlighted && '[background:color-mix(in_oklab,var(--accent)_6%,transparent)]',
      )}
    >
      {/* Bay (Cuerpo) label */}
      <div className="px-2 py-0.5 font-[family-name:var(--font-data)] text-[length:9px] text-[var(--text-faint)]">
        {bay.code}
      </div>

      {/* Levels (top to bottom = highest to lowest) */}
      <div className="flex flex-col gap-px px-1 pb-1">
        {bay.levels.map((level) => {
          const isLevelHighlighted =
            highlightedLevel === level.levelNumber && isBayHighlighted;

          return (
            <div
              key={level.levelNumber}
              className={cn(
                'flex items-center gap-0.5',
                isLevelHighlighted && 'rounded-[2px] ring-1 ring-[var(--accent)] ring-offset-1 ring-offset-transparent',
              )}
            >
              {/* Level label */}
              <span className="w-5 shrink-0 text-right font-[family-name:var(--font-data)] text-[length:8px] text-[var(--text-faint)]">
                {level.levelNumber}
              </span>

              {/* Positions — ONLY what exists */}
              <div className="flex gap-px">
                {level.positions.map((pos) => (
                  <PositionCell
                    key={pos.locationId}
                    position={pos}
                    selected={selectedId === pos.locationId}
                    onSelect={() => onSelectPosition(pos.locationId)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PositionCell({
  position,
  selected,
  onSelect,
}: {
  position: PositionVisual;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = STATUS_META[position.status];
  const pct = position.capacity > 0 ? position.occupied / position.capacity : 0;
  const alpha = 0.25 + pct * 0.55;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'size-[16px] rounded-[2px] transition-all duration-150',
        selected && 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--canvas)]',
        'hover:scale-110 hover:z-10',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
      )}
      style={{
        background: `color-mix(in oklab, ${meta.color} ${Math.round(alpha * 100)}%, transparent)`,
        boxShadow: selected ? `0 0 8px 1px color-mix(in oklab, ${meta.color} 50%, transparent)` : undefined,
      }}
      title={`${position.fullCode}\n${meta.label} · ${position.occupied}/${position.capacity}\nPos ${position.positionNumber}`}
      aria-label={`${position.fullCode}, ${meta.label}, posicion ${position.positionNumber}`}
    />
  );
}
