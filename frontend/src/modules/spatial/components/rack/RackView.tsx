/**
 * RACK VIEW — representacion visual de un rack completo.
 *
 * Dibuja el rack como un operador lo veria de frente:
 *   - Titulo del rack arriba
 *   - Bodies como columnas verticales separadas por hairlines
 *   - Niveles de arriba (N07) a abajo (N01) dentro de cada body
 *   - Posiciones 1 y 2 como dos celdas lado a lado dentro del nivel
 *   - Color de cada celda = estado de la posicion
 */

import { cn } from '../../../../design/utils/cn';
import type { BodyModel, PositionModel, RackModel } from '../../engine/RackModel';
import { STATUS_META } from '../StatusLegend';

interface RackViewProps {
  rack: RackModel;
  selectedId: string | null;
  highlightedRack: string | null;
  highlightedBody: string | null;
  highlightedLevel: string | null;
  onSelectPosition: (locationId: string) => void;
  compact?: boolean;
  className?: string;
}

export function RackView({
  rack,
  selectedId,
  highlightedRack,
  highlightedBody,
  highlightedLevel,
  onSelectPosition,
  compact = false,
  className,
}: RackViewProps) {
  const isRackHighlighted = highlightedRack === rack.code;

  return (
    <div
      className={cn(
        'flex flex-col rounded-[var(--radius-md)] overflow-hidden',
        'border border-[var(--hairline)] transition-all duration-200',
        isRackHighlighted && 'border-[var(--accent)] shadow-[0_0_20px_-6px_var(--accent)]',
        className,
      )}
      data-rack={rack.code}
    >
      {/* Rack header */}
      <div className={cn(
        'flex items-center justify-center px-2 py-1.5',
        '[background:var(--glass-2)] border-b border-[var(--hairline)]',
        compact ? 'text-[length:var(--text-2xs)]' : 'text-[length:var(--text-xs)]',
        'font-[family-name:var(--font-data)] font-[var(--weight-medium)] text-[var(--text-primary)]',
      )}>
        {rack.code}
      </div>

      {/* Bodies */}
      <div className="flex flex-col divide-y divide-[var(--hairline)] [background:var(--glass-1)]">
        {rack.bodies.map((body) => (
          <BodyView
            key={body.id}
            body={body}
            selectedId={selectedId}
            highlightedBody={highlightedBody}
            highlightedLevel={highlightedLevel}
            onSelectPosition={onSelectPosition}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

function BodyView({
  body,
  selectedId,
  highlightedBody,
  highlightedLevel,
  onSelectPosition,
  compact,
}: {
  body: BodyModel;
  selectedId: string | null;
  highlightedBody: string | null;
  highlightedLevel: string | null;
  onSelectPosition: (locationId: string) => void;
  compact: boolean;
}) {
  const isBodyHighlighted = highlightedBody === body.code;

  return (
    <div
      className={cn(
        'flex flex-col transition-colors duration-200',
        isBodyHighlighted && '[background:color-mix(in_oklab,var(--accent)_6%,transparent)]',
      )}
      data-body={body.code}
    >
      {/* Body label */}
      <div className={cn(
        'px-2 py-0.5',
        compact ? 'text-[length:9px]' : 'text-[length:var(--text-2xs)]',
        'font-[family-name:var(--font-data)] text-[var(--text-faint)]',
      )}>
        {body.code}
      </div>

      {/* Levels (top to bottom = highest to lowest) */}
      <div className="flex flex-col gap-px px-1 pb-1">
        {body.levels.map((level) => {
          const isLevelHighlighted = highlightedLevel === level.code && isBodyHighlighted;
          return (
            <div
              key={level.code}
              className={cn(
                'flex items-center gap-0.5',
                isLevelHighlighted && 'rounded-[2px] ring-1 ring-[var(--accent)] ring-offset-1 ring-offset-transparent',
              )}
              data-level={level.code}
            >
              {/* Level label */}
              <span className={cn(
                'w-6 shrink-0 text-right',
                compact ? 'text-[length:8px]' : 'text-[length:9px]',
                'font-[family-name:var(--font-data)] text-[var(--text-faint)]',
              )}>
                {level.code.replace(/^N0?/, '')}
              </span>

              {/* Positions */}
              <div className="flex gap-px">
                {level.positions.map((pos) => (
                  <PositionCell
                    key={pos.locationId}
                    position={pos}
                    selected={selectedId === pos.locationId}
                    onSelect={() => onSelectPosition(pos.locationId)}
                    compact={compact}
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
  compact,
}: {
  position: PositionModel;
  selected: boolean;
  onSelect: () => void;
  compact: boolean;
}) {
  const meta = STATUS_META[position.status];
  const pct = position.capacity > 0 ? position.occupied / position.capacity : 0;
  const alpha = 0.25 + pct * 0.55;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'transition-all duration-150',
        compact ? 'size-[14px] rounded-[2px]' : 'size-[18px] rounded-[3px]',
        selected && 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--canvas)]',
        'hover:scale-110 hover:z-10',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
      )}
      style={{
        background: `color-mix(in oklab, ${meta.color} ${Math.round(alpha * 100)}%, transparent)`,
        boxShadow: selected ? `0 0 8px 1px color-mix(in oklab, ${meta.color} 50%, transparent)` : undefined,
      }}
      title={`${position.fullCode}\n${meta.label} · ${position.occupied}/${position.capacity}`}
      aria-label={`Posicion ${position.positionNumber}, ${meta.label}`}
    />
  );
}
