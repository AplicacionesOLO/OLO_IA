/**
 * ARBOL DE UBICACIONES — lista jerarquica con drill-down.
 */

import { ChevronRight, FolderOpen } from 'lucide-react';
import { Badge } from '../../../design/primitives/Badge';
import { cn } from '../../../design/utils/cn';
import type { SpatialLocation } from '../types/index';
import { STATUS_META, STATUS_TONE } from './StatusLegend';

interface LocationTreeProps {
  locations: SpatialLocation[];
  selectedId: string | null;
  onSelect: (loc: SpatialLocation) => void;
  onDrillDown: (loc: SpatialLocation) => void;
  className?: string;
}

export function LocationTree({
  locations,
  selectedId,
  onSelect,
  onDrillDown,
  className,
}: LocationTreeProps) {
  if (locations.length === 0) return null;

  return (
    <ul className={cn('flex flex-col gap-1', className)} role="tree">
      {locations.map((loc) => (
        <LocationTreeItem
          key={loc.id}
          location={loc}
          selected={selectedId === loc.id}
          onSelect={() => onSelect(loc)}
          onDrillDown={() => onDrillDown(loc)}
        />
      ))}
    </ul>
  );
}

function LocationTreeItem({
  location,
  selected,
  onSelect,
  onDrillDown,
}: {
  location: SpatialLocation;
  selected: boolean;
  onSelect: () => void;
  onDrillDown: () => void;
}) {
  const isContainer = location.kind !== 'position';
  const meta = STATUS_META[location.status];
  const pct = location.capacity > 0
    ? Math.round((location.occupied / location.capacity) * 100)
    : 0;

  return (
    <li
      role="treeitem"
      aria-selected={selected}
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-sm)]',
        'px-3 py-2.5 transition-colors duration-150 cursor-pointer',
        selected
          ? '[background:var(--glass-3)] shadow-[var(--rim-2)]'
          : '[background:var(--glass-1)] hover:[background:var(--glass-2)]',
      )}
      onClick={isContainer ? onDrillDown : onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          isContainer ? onDrillDown() : onSelect();
        }
      }}
      tabIndex={0}
    >
      {/* Icono segun tipo */}
      {isContainer ? (
        <FolderOpen strokeWidth={1.5} className="size-4 shrink-0 text-[var(--icon-muted)]" />
      ) : (
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: meta.color }}
        />
      )}

      {/* Contenido */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[length:var(--text-sm)] text-[var(--text-primary)]">
          {location.code}
          {location.name && (
            <span className="ml-2 text-[var(--text-faint)]">{location.name}</span>
          )}
        </span>
        <span className="t-mono-xs text-[var(--text-faint)]">
          {location.kind} · {pct}%
        </span>
      </div>

      {/* Badge */}
      <Badge tone={STATUS_TONE[location.status]} size="xs">
        {meta.label}
      </Badge>

      {/* Mini bar */}
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-[var(--glass-1)] sm:flex">
        <span
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: meta.color }}
        />
      </span>

      {/* Arrow for containers */}
      {isContainer && (
        <ChevronRight strokeWidth={1.5} className="size-4 shrink-0 text-[var(--text-faint)]" />
      )}
    </li>
  );
}
