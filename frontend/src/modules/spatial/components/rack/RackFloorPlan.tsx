/**
 * RACK FLOOR PLAN — vista superior del almacen.
 *
 * Muestra los racks vistos desde arriba como una planta industrial.
 * Dark background, racks como bloques, pasillos como espacios entre filas.
 * Al hacer click en un rack se abre la vista frontal.
 */

import { useMemo } from 'react';
import { cn } from '../../../../design/utils/cn';
import type { SpatialLocation } from '../../types/index';
import {
  buildViewModel,
  getSelectionContext,
  type RackVisual,
  type SpecialLocation,
  type UnrecognizedLocation,
} from '../../engine/RackModel';
import { STATUS_META } from '../StatusLegend';

interface RackFloorPlanProps {
  locations: SpatialLocation[];
  selectedId: string | null;
  onSelectRack: (rackCode: string) => void;
  onSelectPosition: (locationId: string) => void;
  className?: string | undefined;
}

export function RackFloorPlan({
  locations,
  selectedId,
  onSelectRack,
  onSelectPosition,
  className,
}: RackFloorPlanProps) {
  const viewModel = useMemo(() => buildViewModel(locations), [locations]);
  const selContext = useMemo(
    () => (selectedId ? getSelectionContext(selectedId, viewModel) : null),
    [selectedId, viewModel],
  );

  return (
    <div className={cn('flex h-full flex-col overflow-auto', className)}>
      {/* Floor grid background */}
      <div className="relative min-h-full p-6" style={{ background: '#080c14' }}>
        {/* Technical grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Rack groups */}
        <div className="relative flex flex-col gap-8">
          {viewModel.groups.map((group) => (
            <div key={group.groupId} className="flex flex-col gap-4">
              {/* Group header (aisle/zone label) */}
              <div className="flex items-center gap-4">
                <div className="h-px flex-1" style={{ background: 'rgba(100,140,180,0.15)' }} />
                <span className="font-[family-name:var(--font-data)] text-[length:10px] font-[var(--weight-medium)] uppercase tracking-[0.12em]" style={{ color: 'rgba(100,160,220,0.5)' }}>
                  {group.groupLabel}
                </span>
                <div className="h-px flex-1" style={{ background: 'rgba(100,140,180,0.15)' }} />
              </div>

              {/* Racks row */}
              <div className="flex flex-wrap gap-3">
                {group.racks.map((rack) => (
                  <FloorRack
                    key={rack.code}
                    rack={rack}
                    isHighlighted={selContext?.rackCode === rack.code}
                    onSelect={() => onSelectRack(rack.code)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Special locations zone */}
          {viewModel.specials.length > 0 && (
            <SpecialZone
              specials={viewModel.specials}
              selectedId={selectedId}
              onSelect={onSelectPosition}
            />
          )}

          {/* Unrecognized */}
          {viewModel.unrecognized.length > 0 && (
            <UnrecognizedZone
              items={viewModel.unrecognized}
              selectedId={selectedId}
              onSelect={onSelectPosition}
            />
          )}
        </div>

        {/* Scale + compass */}
        <div className="absolute bottom-4 left-4 flex items-center gap-4">
          <Compass />
          <ScaleBar />
        </div>

        {/* Zoom indicator */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-[3px] px-2 py-1" style={{ background: 'rgba(8,12,20,0.8)', border: '1px solid rgba(100,140,180,0.15)' }}>
          <span className="font-[family-name:var(--font-data)] text-[length:9px]" style={{ color: 'rgba(100,160,220,0.5)' }}>100%</span>
        </div>
      </div>
    </div>
  );
}

/** Rack block in floor plan — top-down view. */
function FloorRack({
  rack,
  isHighlighted,
  onSelect,
}: {
  rack: RackVisual;
  isHighlighted: boolean;
  onSelect: () => void;
}) {
  // Calculate occupancy for the whole rack
  let totalCap = 0;
  let totalOcc = 0;
  for (const bay of rack.bays) {
    for (const level of bay.levels) {
      for (const pos of level.positions) {
        totalCap += pos.capacity;
        totalOcc += pos.occupied;
      }
    }
  }
  const pct = totalCap > 0 ? Math.round((totalOcc / totalCap) * 100) : 0;
  const positions = rack.bays.reduce((sum, b) => sum + b.levels.reduce((s2, l) => s2 + l.positions.length, 0), 0);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col items-center rounded-[4px] transition-all duration-200',
        'border',
        isHighlighted
          ? 'border-[var(--accent)] shadow-[0_0_24px_-4px_var(--accent)]'
          : 'border-[rgba(60,80,110,0.3)] hover:border-[rgba(100,160,220,0.4)]',
      )}
      style={{
        background: isHighlighted
          ? 'rgba(10,162,199,0.08)'
          : 'rgba(14,26,45,0.6)',
        width: Math.max(64, rack.bays.length * 6 + 24),
        minHeight: 48,
      }}
      title={`${rack.code}\n${rack.bays.length} cuerpos · ${positions} posiciones\n${pct}% ocupacion`}
      aria-label={`Rack ${rack.code}, ${pct} por ciento ocupacion`}
    >
      {/* Rack code */}
      <span className="mt-1.5 font-[family-name:var(--font-data)] text-[length:10px] font-[var(--weight-medium)]" style={{ color: isHighlighted ? 'var(--accent)' : 'rgba(200,220,240,0.7)' }}>
        {rack.code}
      </span>

      {/* Mini bay indicators */}
      <div className="mt-1 flex gap-px px-1.5 pb-1.5">
        {rack.bays.slice(0, 20).map((bay) => {
          const bayOcc = bay.levels.reduce((s, l) => s + l.positions.reduce((s2, p) => s2 + p.occupied, 0), 0);
          const bayCap = bay.levels.reduce((s, l) => s + l.positions.reduce((s2, p) => s2 + p.capacity, 0), 0);
          const bayPct = bayCap > 0 ? bayOcc / bayCap : 0;
          return (
            <div
              key={bay.code}
              className="rounded-[1px]"
              style={{
                width: 4,
                height: 12,
                background: `rgba(34,217,245,${0.15 + bayPct * 0.6})`,
              }}
            />
          );
        })}
      </div>

      {/* Occupancy label */}
      <span className="absolute -bottom-4 font-[family-name:var(--font-data)] text-[length:8px] opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'rgba(200,220,240,0.5)' }}>
        {pct}%
      </span>
    </button>
  );
}

function SpecialZone({
  specials,
  selectedId,
  onSelect,
}: {
  specials: SpecialLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Group by reason
  const byReason = new Map<string, SpecialLocation[]>();
  for (const s of specials) {
    const arr = byReason.get(s.reason) ?? [];
    arr.push(s);
    byReason.set(s.reason, arr);
  }

  return (
    <div className="flex flex-col gap-4 mt-4 pt-4" style={{ borderTop: '1px solid rgba(245,158,11,0.15)' }}>
      <span className="font-[family-name:var(--font-data)] text-[length:10px] uppercase tracking-[0.12em]" style={{ color: 'rgba(245,158,11,0.6)' }}>
        Zonas operativas
      </span>
      <div className="flex flex-wrap gap-3">
        {[...byReason.entries()].map(([reason, items]) => (
          <div
            key={reason}
            className="flex flex-col gap-1 rounded-[4px] px-3 py-2"
            style={{ background: 'rgba(245,158,11,0.04)', border: '1px dashed rgba(245,158,11,0.2)' }}
          >
            <span className="font-[family-name:var(--font-data)] text-[length:9px] uppercase" style={{ color: 'rgba(245,158,11,0.7)' }}>
              {reason}
            </span>
            <div className="flex flex-wrap gap-1">
              {items.map((s) => {
                const meta = STATUS_META[s.status];
                const isSelected = selectedId === s.locationId;
                return (
                  <button
                    key={s.locationId}
                    type="button"
                    onClick={() => onSelect(s.locationId)}
                    className={cn(
                      'size-3 rounded-[2px] transition-all',
                      isSelected && 'ring-1 ring-[var(--accent)]',
                    )}
                    style={{ background: `color-mix(in oklab, ${meta.color} 50%, transparent)` }}
                    title={s.fullCode}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UnrecognizedZone({
  items,
  selectedId,
  onSelect,
}: {
  items: UnrecognizedLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 mt-2 pt-2" style={{ borderTop: '1px solid rgba(100,116,139,0.15)' }}>
      <span className="font-[family-name:var(--font-data)] text-[length:9px] uppercase tracking-[0.12em]" style={{ color: 'rgba(100,116,139,0.5)' }}>
        No clasificados ({items.length})
      </span>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 50).map((item) => (
          <button
            key={item.locationId}
            type="button"
            onClick={() => onSelect(item.locationId)}
            className={cn(
              'rounded-[2px] px-1.5 py-0.5 font-[family-name:var(--font-data)] text-[length:8px] transition-colors',
              selectedId === item.locationId ? 'ring-1 ring-[var(--accent)]' : '',
            )}
            style={{ background: 'rgba(100,116,139,0.1)', color: 'rgba(100,116,139,0.6)' }}
            title={item.fullCode}
          >
            {item.fullCode}
          </button>
        ))}
      </div>
    </div>
  );
}

function Compass() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(100,140,180,0.2)" strokeWidth="0.5" />
      <line x1="12" y1="2" x2="12" y2="6" stroke="rgba(100,160,220,0.5)" strokeWidth="1" />
      <text x="12" y="10" textAnchor="middle" fill="rgba(100,160,220,0.5)" fontSize="6" fontFamily="var(--font-data)">N</text>
    </svg>
  );
}

function ScaleBar() {
  return (
    <div className="flex items-end gap-1.5">
      <div className="flex flex-col items-center gap-0.5">
        <div className="h-px w-12" style={{ background: 'rgba(100,160,220,0.4)' }} />
        <span className="font-[family-name:var(--font-data)] text-[length:8px]" style={{ color: 'rgba(100,160,220,0.4)' }}>10 m</span>
      </div>
    </div>
  );
}
