/**
 * RACK FRONTAL — vista de frente de un rack seleccionado.
 *
 * Muestra el rack como lo ve un operador parado frente a el:
 * - Cuerpos (C001...C018) en horizontal
 * - Niveles (N07 arriba...N01 abajo) en vertical
 * - Posiciones como celdas coloreadas por estado
 * - Estructura metalica como lineas de referencia
 */

import { ArrowLeft } from 'lucide-react';
import { Button } from '../../../../design/primitives/Button';
import { cn } from '../../../../design/utils/cn';
import type { BayVisual, RackVisual } from '../../engine/RackModel';
import { STATUS_META } from '../StatusLegend';

interface RackFrontalProps {
  rack: RackVisual;
  selectedId: string | null;
  onSelectPosition: (locationId: string) => void;
  onBack: () => void;
  className?: string | undefined;
}

export function RackFrontal({
  rack,
  selectedId,
  onSelectPosition,
  onBack,
  className,
}: RackFrontalProps) {
  // Get all unique level numbers across all bays (sorted high to low)
  const allLevels = new Set<number>();
  for (const bay of rack.bays) {
    for (const level of bay.levels) {
      allLevels.add(level.levelNumber);
    }
  }
  const levelNumbers = [...allLevels].sort((a, b) => b - a);

  return (
    <div className={cn('flex h-full flex-col', className)} style={{ background: '#080c14' }}>
      {/* Header */}
      <div className="flex items-center gap-4 border-b px-4 py-3" style={{ borderColor: 'rgba(60,80,110,0.3)', background: 'rgba(14,26,45,0.5)' }}>
        <Button variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeft strokeWidth={1.5} className="size-4" />
          Volver
        </Button>
        <div className="flex items-center gap-3">
          <span className="font-[family-name:var(--font-data)] text-[length:var(--text-md)] font-[var(--weight-medium)] text-[var(--text-primary)]">
            {rack.code}
          </span>
          <span className="font-[family-name:var(--font-data)] text-[length:var(--text-xs)]" style={{ color: 'rgba(100,160,220,0.5)' }}>
            {rack.bays.length} cuerpos · {levelNumbers.length} niveles
          </span>
        </div>
      </div>

      {/* Frontal grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="inline-block min-w-full">
          {/* Bay headers */}
          <div className="flex gap-px pl-10">
            {rack.bays.map((bay) => (
              <div
                key={bay.code}
                className="flex items-center justify-center"
                style={{
                  width: getSlotWidth(bay),
                  minWidth: 36,
                  borderBottom: '2px solid rgba(60,80,110,0.4)',
                  paddingBottom: 4,
                }}
              >
                <span className="font-[family-name:var(--font-data)] text-[length:9px] font-[var(--weight-medium)]" style={{ color: 'rgba(200,220,240,0.7)' }}>
                  {bay.code}
                </span>
              </div>
            ))}
          </div>

          {/* Level rows */}
          {levelNumbers.map((levelNum) => (
            <div key={levelNum} className="flex items-center gap-px" style={{ borderBottom: '1px solid rgba(60,80,110,0.12)' }}>
              {/* Level label */}
              <div className="flex w-10 shrink-0 items-center justify-end pr-2 py-1">
                <span className="font-[family-name:var(--font-data)] text-[length:9px]" style={{ color: 'rgba(100,160,220,0.5)' }}>
                  N{String(levelNum).padStart(2, '0')}
                </span>
              </div>

              {/* Position cells per bay */}
              {rack.bays.map((bay) => {
                const level = bay.levels.find((l) => l.levelNumber === levelNum);
                const slotW = getSlotWidth(bay);

                if (!level || level.positions.length === 0) {
                  // No position at this level for this bay
                  return (
                    <div
                      key={bay.code}
                      className="flex items-center justify-center py-1"
                      style={{ width: slotW, minWidth: 36 }}
                    >
                      <span className="size-1 rounded-full" style={{ background: 'rgba(60,80,110,0.2)' }} />
                    </div>
                  );
                }

                return (
                  <div
                    key={bay.code}
                    className="flex items-center justify-center gap-1 py-1"
                    style={{ width: slotW, minWidth: 36 }}
                  >
                    {level.positions.map((pos) => {
                      const meta = STATUS_META[pos.status];
                      const pct = pos.capacity > 0 ? pos.occupied / pos.capacity : 0;
                      const alpha = 0.3 + pct * 0.5;
                      const isSelected = selectedId === pos.locationId;

                      return (
                        <button
                          key={pos.locationId}
                          type="button"
                          onClick={() => onSelectPosition(pos.locationId)}
                          className={cn(
                            'rounded-[3px] transition-all duration-150',
                            'hover:scale-110 hover:z-10',
                            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
                            isSelected && 'ring-2 ring-[var(--accent)] ring-offset-1',
                          )}
                          style={{
                            width: 14,
                            height: 14,
                            background: `color-mix(in oklab, ${meta.color} ${Math.round(alpha * 100)}%, transparent)`,
                            boxShadow: isSelected ? `0 0 10px 2px color-mix(in oklab, ${meta.color} 50%, transparent)` : undefined,
                            
                          }}
                          title={`${pos.fullCode}\n${meta.label} · Pos ${pos.positionNumber}\n${pos.occupied}/${pos.capacity}`}
                          aria-label={`${pos.fullCode}, ${meta.label}`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend inline */}
      <div className="flex items-center gap-4 border-t px-4 py-2" style={{ borderColor: 'rgba(60,80,110,0.2)', background: 'rgba(14,26,45,0.3)' }}>
        <Legend />
      </div>
    </div>
  );
}

function getSlotWidth(bay: BayVisual): number {
  const maxPositions = Math.max(...bay.levels.map((l) => l.positions.length), 1);
  return maxPositions * 16 + (maxPositions - 1) * 4 + 12;
}

function Legend() {
  const items: Array<{ label: string; color: string }> = [
    { label: 'Disponible', color: STATUS_META.available.color },
    { label: 'Ocupada', color: STATUS_META.occupied.color },
    { label: 'Inferida', color: STATUS_META.inferred.color },
    { label: 'Bloqueada', color: STATUS_META.blocked.color },
    { label: 'Sin stock', color: 'rgba(60,80,110,0.2)' },
  ];

  return (
    <div className="flex items-center gap-4">
      <span className="font-[family-name:var(--font-data)] text-[length:9px] uppercase" style={{ color: 'rgba(100,140,180,0.5)' }}>
        Leyenda
      </span>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px]" style={{ background: item.color }} />
          <span className="font-[family-name:var(--font-data)] text-[length:8px]" style={{ color: 'rgba(200,220,240,0.5)' }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
