/**
 * WAREHOUSE FLOOR — la planta completa del almacen.
 *
 * Muestra racks agrupados + ubicaciones especiales + no reconocidas.
 * No inventa pasillos ni posiciones. Solo renderiza lo que existe.
 */

import { useMemo } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';
import type { SpatialLocation } from '../../types/index';
import {
  buildViewModel,
  getSelectionContext,
  type SpecialLocation,
  type UnrecognizedLocation,
} from '../../engine/RackModel';
import { RackView } from './RackView';
import { Badge } from '../../../../design/primitives/Badge';
import { STATUS_META } from '../StatusLegend';

interface WarehouseFloorProps {
  locations: SpatialLocation[];
  selectedId: string | null;
  onSelectPosition: (locationId: string) => void;
  className?: string;
}

export function WarehouseFloor({
  locations,
  selectedId,
  onSelectPosition,
  className,
}: WarehouseFloorProps) {
  const viewModel = useMemo(() => buildViewModel(locations), [locations]);

  const selContext = useMemo(() => {
    if (!selectedId) return null;
    return getSelectionContext(selectedId, viewModel);
  }, [selectedId, viewModel]);

  if (viewModel.groups.length === 0 && viewModel.specials.length === 0 && viewModel.unrecognized.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="t-mono-xs text-[var(--text-faint)]">Sin estructura de racks</span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6 overflow-auto p-4', className)}>
      {/* Structured rack groups */}
      {viewModel.groups.map((group) => (
        <div key={group.groupId} className="flex flex-col gap-3">
          <div className="flex items-center gap-3 px-2">
            <span className="font-[family-name:var(--font-data)] text-[length:var(--text-xs)] font-[var(--weight-medium)] uppercase tracking-[var(--tracking-label)] text-[var(--text-faint)]">
              {group.groupLabel}
            </span>
            <div className="h-px flex-1 [background:var(--hairline)]" />
            <span className="t-mono-xs text-[var(--text-faint)]">
              {group.racks.length} racks
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            {group.racks.map((rack) => (
              <RackView
                key={rack.code}
                rack={rack}
                selectedId={selectedId}
                highlightedRack={selContext?.rackCode ?? null}
                highlightedBay={selContext?.bayCode ?? null}
                highlightedLevel={selContext?.levelNumber ?? null}
                onSelectPosition={onSelectPosition}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Special locations */}
      {viewModel.specials.length > 0 && (
        <SpecialsSection
          specials={viewModel.specials}
          selectedId={selectedId}
          onSelect={onSelectPosition}
        />
      )}

      {/* Unrecognized locations */}
      {viewModel.unrecognized.length > 0 && (
        <UnrecognizedSection
          items={viewModel.unrecognized}
          selectedId={selectedId}
          onSelect={onSelectPosition}
        />
      )}
    </div>
  );
}

function SpecialsSection({
  specials,
  selectedId,
  onSelect,
}: {
  specials: SpecialLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-2">
        <AlertTriangle strokeWidth={1.5} className="size-3.5 text-[var(--state-alert)]" />
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-xs)] font-[var(--weight-medium)] uppercase tracking-[var(--tracking-label)] text-[var(--state-alert)]">
          Ubicaciones especiales
        </span>
        <div className="h-px flex-1 [background:var(--hairline)]" />
      </div>

      <div className="flex flex-wrap gap-2 px-2">
        {specials.map((s) => {
          const meta = STATUS_META[s.status];
          const isSelected = selectedId === s.locationId;
          return (
            <button
              key={s.locationId}
              type="button"
              onClick={() => onSelect(s.locationId)}
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2',
                'transition-all duration-150',
                isSelected
                  ? '[background:var(--glass-3)] shadow-[var(--rim-2)] ring-1 ring-[var(--accent)]'
                  : '[background:var(--glass-1)] hover:[background:var(--glass-2)]',
              )}
              title={`${s.fullCode} · ${s.reason}`}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: meta.color }}
              />
              <span className="text-[length:var(--text-xs)] text-[var(--text-primary)]">
                {s.externalCode}
              </span>
              <Badge tone="alert" size="xs">{s.reason}</Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UnrecognizedSection({
  items,
  selectedId,
  onSelect,
}: {
  items: UnrecognizedLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 px-2">
        <HelpCircle strokeWidth={1.5} className="size-3.5 text-[var(--text-faint)]" />
        <span className="font-[family-name:var(--font-data)] text-[length:var(--text-xs)] font-[var(--weight-medium)] uppercase tracking-[var(--tracking-label)] text-[var(--text-faint)]">
          Codigos no estructurados
        </span>
        <div className="h-px flex-1 [background:var(--hairline)]" />
        <span className="t-mono-xs text-[var(--text-faint)]">{items.length}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 px-2">
        {items.map((item) => {
          const isSelected = selectedId === item.locationId;
          const meta = STATUS_META[item.status];
          return (
            <button
              key={item.locationId}
              type="button"
              onClick={() => onSelect(item.locationId)}
              className={cn(
                'flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1',
                'text-[length:var(--text-2xs)] transition-colors',
                isSelected
                  ? '[background:var(--glass-3)] ring-1 ring-[var(--accent)]'
                  : '[background:var(--glass-1)] hover:[background:var(--glass-2)]',
              )}
              title={item.fullCode}
            >
              <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
              <span className="font-[family-name:var(--font-data)] text-[var(--text-faint)]">
                {item.fullCode}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
