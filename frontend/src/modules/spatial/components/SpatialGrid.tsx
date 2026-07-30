/**
 * MAPA GRID — representacion espacial en retícula.
 *
 * Cada celda es una ubicacion; el color y la intensidad comunican estado y
 * ocupacion. Es la vista que permite captar el estado completo de un nivel de
 * un vistazo, sin leer texto.
 *
 * La retícula se autoajusta al numero de items con `auto-fill` y un ancho
 * minimo de 56px, así que funciona desde 4 columnas en movil hasta 12+ en un
 * monitor ultrawide.
 */

import { cn } from '../../../design/utils/cn';
import type { SpatialLocation } from '../types/index';
import { STATUS_META } from './StatusLegend';

interface SpatialGridProps {
  locations: SpatialLocation[];
  selectedId: string | null;
  onSelect: (loc: SpatialLocation) => void;
  className?: string;
}

export function SpatialGrid({ locations, selectedId, onSelect, className }: SpatialGridProps) {
  if (locations.length === 0) return null;

  return (
    <div
      className={cn(
        'grid gap-1.5',
        // auto-fill con minimo 56px: la rejilla se adapta sola.
        '[grid-template-columns:repeat(auto-fill,minmax(56px,1fr))]',
        className,
      )}
      role="grid"
      aria-label="Mapa de ubicaciones"
    >
      {locations.map((loc) => (
        <GridCell
          key={loc.id}
          location={loc}
          selected={selectedId === loc.id}
          onSelect={() => onSelect(loc)}
        />
      ))}
    </div>
  );
}

function GridCell({
  location,
  selected,
  onSelect,
}: {
  location: SpatialLocation;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = STATUS_META[location.status];
  const pct = location.capacity > 0 ? location.occupied / location.capacity : 0;

  // La opacidad de la celda refleja la ocupacion: una celda al 100% es solida,
  // una al 0% apenas se distingue del fondo. La forma del estado la da el color;
  // la intensidad del color da la ocupacion. Dos canales de informacion sin texto.
  const fillOpacity = 0.15 + pct * 0.55;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex aspect-square flex-col items-center justify-center gap-0.5',
        'rounded-[var(--radius-xs)] transition-all duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]',
        selected
          ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--canvas)]'
          : 'hover:scale-105',
      )}
      style={{
        background: `color-mix(in oklab, ${meta.color} ${Math.round(fillOpacity * 100)}%, transparent)`,
        boxShadow: selected ? `0 0 16px 2px color-mix(in oklab, ${meta.color} 50%, transparent)` : undefined,
      }}
      aria-label={`${location.code} · ${meta.label} · ${Math.round(pct * 100)}% ocupacion`}
      title={`${location.code}\n${meta.label}\n${location.occupied}/${location.capacity}`}
    >
      {/* Código corto */}
      <span className="t-mono-xs truncate px-0.5 leading-none text-[var(--text-primary)]">
        {shortCode(location.code)}
      </span>
      {/* Mini barra de ocupación */}
      {location.kind === 'position' && (
        <span className="flex h-[3px] w-3/4 overflow-hidden rounded-full bg-[rgb(255_255_255/0.1)]">
          <span
            className="h-full rounded-full"
            style={{ width: `${pct * 100}%`, background: meta.color }}
          />
        </span>
      )}
    </button>
  );
}

/** Extrae la parte final del codigo para que quepa en la celda. */
function shortCode(code: string): string {
  const parts = code.split('-');
  // Si tiene 4+ partes (A-01-03-2), muestra las ultimas 2
  if (parts.length >= 4) return parts.slice(-2).join('-');
  if (parts.length >= 3) return parts.slice(-2).join('-');
  return code;
}
