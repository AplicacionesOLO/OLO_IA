/**
 * BREADCRUMB ESPACIAL — muestra la posicion en la jerarquia.
 *
 * Zona → Pasillo → Bahia → (posicion seleccionada)
 *
 * Cada segmento es clickable para volver a ese nivel. El ultimo es la posicion
 * actual y no se puede clickear.
 */

import { ChevronRight, Home } from 'lucide-react';
import { cn } from '../../../design/utils/cn';

export interface BreadcrumbSegment {
  id: string | null;
  label: string;
}

interface SpatialBreadcrumbProps {
  segments: BreadcrumbSegment[];
  onNavigate: (index: number) => void;
  className?: string;
}

export function SpatialBreadcrumb({ segments, onNavigate, className }: SpatialBreadcrumbProps) {
  if (segments.length <= 1) return null;

  return (
    <nav
      aria-label="Posicion en la jerarquia"
      className={cn('flex flex-wrap items-center gap-1', className)}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const isRoot = i === 0;

        return (
          <span key={seg.id ?? 'root'} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight
                strokeWidth={1.5}
                className="size-3.5 text-[var(--text-faint)]"
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => onNavigate(i)}
              disabled={isLast}
              className={cn(
                'flex items-center gap-1.5 rounded-[var(--radius-xs)] px-2 py-1 transition-colors',
                isLast
                  ? 'text-[var(--text-primary)] cursor-default'
                  : 'text-[var(--text-faint)] hover:text-[var(--accent)] hover:[background:var(--glass-1)]',
              )}
              aria-current={isLast ? 'location' : undefined}
            >
              {isRoot && <Home strokeWidth={1.5} className="size-3" />}
              <span className="t-mono-xs">{seg.label}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
