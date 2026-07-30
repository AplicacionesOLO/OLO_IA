/**
 * TREE PANEL — panel izquierdo del workspace.
 *
 * Arbol jerarquico + busqueda + breadcrumb. Es el modo principal de
 * navegacion cuando el operador sabe QUE busca pero no DONDE esta.
 */

import { MapPin, Search } from 'lucide-react';
import { cn } from '../../../../design/utils/cn';
import type { SpatialLocation } from '../../types/index';
import { SpatialBreadcrumb, type BreadcrumbSegment } from '../Breadcrumb';
import { LocationTree } from '../LocationTree';

interface TreePanelProps {
  locations: SpatialLocation[];
  selectedId: string | null;
  breadcrumb: BreadcrumbSegment[];
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (loc: SpatialLocation) => void;
  onDrillDown: (loc: SpatialLocation) => void;
  onNavigateBreadcrumb: (idx: number) => void;
  loading: boolean;
  empty: boolean;
  className?: string;
}

export function TreePanel({
  locations,
  selectedId,
  breadcrumb,
  search,
  onSearchChange,
  onSelect,
  onDrillDown,
  onNavigateBreadcrumb,
  loading,
  empty,
  className,
}: TreePanelProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Mini search */}
      <label className="flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 [background:var(--glass-2)]">
        <Search strokeWidth={1.5} className="size-3.5 shrink-0 text-[var(--icon-muted)]" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar…"
          aria-label="Buscar ubicacion"
          className="w-full bg-transparent text-[length:var(--text-xs)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </label>

      {/* Breadcrumb */}
      {!search && <SpatialBreadcrumb segments={breadcrumb} onNavigate={onNavigateBreadcrumb} />}

      {/* Tree content */}
      {loading && (
        <div className="flex flex-col gap-2 py-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="size-2 animate-pulse rounded-full [background:var(--glass-2)]" />
              <div className="h-2.5 flex-1 animate-pulse rounded-[var(--radius-xs)] [background:var(--glass-2)]" style={{ width: `${40 + (i * 13) % 50}%` }} />
            </div>
          ))}
        </div>
      )}

      {!loading && empty && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <MapPin strokeWidth={1.25} className="size-5 text-[var(--text-faint)]" />
          <span className="t-mono-xs text-[var(--text-faint)]">
            {search ? 'Sin resultados' : 'Sin nodos'}
          </span>
        </div>
      )}

      {!loading && locations.length > 0 && (
        <LocationTree
          locations={locations}
          selectedId={selectedId}
          onSelect={onSelect}
          onDrillDown={onDrillDown}
        />
      )}
    </div>
  );
}
