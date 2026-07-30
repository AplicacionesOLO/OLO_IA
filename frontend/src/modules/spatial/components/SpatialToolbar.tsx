/**
 * TOOLBAR — barra de herramientas contextual.
 *
 * Reune busqueda, filtros de estado y selector de vista en una linea. Es la
 * interfaz entre la intencion del usuario y los datos que ve.
 */

import { Grid3X3, List, Search } from 'lucide-react';
import { Button } from '../../../design/primitives/Button';
import { cn } from '../../../design/utils/cn';
import type { LocationStatus } from '../types/index';
import { STATUS_META } from './StatusLegend';

export type SpatialViewMode = 'list' | 'grid';

interface SpatialToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: LocationStatus | undefined;
  onStatusFilterChange: (status: LocationStatus | undefined) => void;
  viewMode: SpatialViewMode;
  onViewModeChange: (mode: SpatialViewMode) => void;
  /** Total de ubicaciones en el nivel actual. */
  count: number | null;
  className?: string;
}

export function SpatialToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
  count,
  className,
}: SpatialToolbarProps) {
  const filterStatuses: LocationStatus[] = ['occupied', 'available', 'inferred', 'invalid'];

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {/* Buscador */}
      <label className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] px-4 [background:var(--glass-2)] shadow-[var(--rim-1)] focus-within:shadow-[var(--focus-ring)]">
        <Search strokeWidth={1.5} className="size-4 shrink-0 text-[var(--icon-muted)]" />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar ubicacion (ej: A-01-03)"
          aria-label="Buscar ubicacion por codigo o nombre"
          className="w-full bg-transparent text-[length:var(--text-sm)] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="t-mono-xs shrink-0 text-[var(--text-faint)] hover:text-[var(--text-primary)]"
            aria-label="Limpiar busqueda"
          >
            ✕
          </button>
        )}
      </label>

      {/* Filtros de estado */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
        <Button
          variant={!statusFilter ? 'secondary' : 'ghost'}
          size="xs"
          onClick={() => onStatusFilterChange(undefined)}
          aria-pressed={!statusFilter}
        >
          Todas
        </Button>
        {filterStatuses.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'secondary' : 'ghost'}
            size="xs"
            onClick={() => onStatusFilterChange(statusFilter === s ? undefined : s)}
            aria-pressed={statusFilter === s}
          >
            <span
              aria-hidden
              className="mr-1 inline-block size-1.5 rounded-full"
              style={{ background: STATUS_META[s].color }}
            />
            {STATUS_META[s].label}
          </Button>
        ))}
      </div>

      {/* Contador */}
      {count !== null && (
        <span className="t-mono-xs hidden text-[var(--text-faint)] lg:inline">
          {count} ubicaciones
        </span>
      )}

      {/* Toggle de vista */}
      <div className="flex gap-1 rounded-[var(--radius-sm)] p-0.5 [background:var(--glass-1)]" role="group" aria-label="Modo de visualizacion">
        <button
          type="button"
          onClick={() => onViewModeChange('list')}
          className={cn(
            'flex size-8 items-center justify-center rounded-[var(--radius-xs)] transition-colors',
            viewMode === 'list' ? '[background:var(--glass-3)] text-[var(--text-primary)]' : 'text-[var(--text-faint)] hover:text-[var(--text-primary)]',
          )}
          aria-label="Vista de lista"
          aria-pressed={viewMode === 'list'}
        >
          <List strokeWidth={1.5} className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('grid')}
          className={cn(
            'flex size-8 items-center justify-center rounded-[var(--radius-xs)] transition-colors',
            viewMode === 'grid' ? '[background:var(--glass-3)] text-[var(--text-primary)]' : 'text-[var(--text-faint)] hover:text-[var(--text-primary)]',
          )}
          aria-label="Vista de mapa"
          aria-pressed={viewMode === 'grid'}
        >
          <Grid3X3 strokeWidth={1.5} className="size-4" />
        </button>
      </div>
    </div>
  );
}
