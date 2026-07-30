/**
 * TIMELINE — barra de estado inferior del workspace.
 *
 * Muestra informacion contextual: seleccion actual, zoom, coordenadas del
 * cursor, y acciones rapidas. Es el equivalente a la status bar de un IDE.
 *
 * Cuando el backend entregue datos reales, aqui se mostraran:
 * - ultimo evento del almacen
 * - timestamp de la ultima sincronizacion
 * - modo de visualizacion activo
 */

import { cn } from '../../../../design/utils/cn';
import { StatusLegend } from '../StatusLegend';

interface TimelineProps {
  /** Numero de items seleccionados. */
  selectionCount: number;
  /** Zoom actual del viewport (%). */
  zoomPercent: number;
  /** Total de ubicaciones cargadas. */
  totalLoaded: number;
  /** Total real en el backend. */
  totalReal: number;
  /** Vista activa. */
  viewMode: string;
  className?: string;
}

export function Timeline({
  selectionCount,
  zoomPercent,
  totalLoaded,
  totalReal,
  viewMode,
  className,
}: TimelineProps) {
  const isPartial = totalLoaded < totalReal;

  return (
    <div className={cn('flex h-full items-center gap-4 px-4', className)}>
      {/* Selection info */}
      <span className="t-mono-xs text-[var(--text-faint)]">
        {selectionCount > 0 ? `${selectionCount} seleccionados` : 'Sin seleccion'}
      </span>

      <Separator />

      {/* View mode */}
      <span className="t-mono-xs text-[var(--text-faint)]">
        {viewMode === 'canvas' ? 'Mapa' : viewMode === 'grid' ? 'Grid' : 'Lista'}
      </span>

      <Separator />

      {/* Zoom */}
      <span className="t-mono-xs text-[var(--text-faint)]">
        {zoomPercent}%
      </span>

      <Separator />

      {/* Count */}
      <span className={cn('t-mono-xs', isPartial ? 'text-[var(--state-alert)]' : 'text-[var(--text-faint)]')}>
        {totalLoaded}{isPartial ? ` / ${totalReal}` : ''} ubicaciones
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Legend compact */}
      <StatusLegend compact />
    </div>
  );
}

function Separator() {
  return <span className="h-3 w-px [background:var(--hairline)]" />;
}
