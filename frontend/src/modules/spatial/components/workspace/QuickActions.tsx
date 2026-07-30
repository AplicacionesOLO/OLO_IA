/**
 * QUICK ACTIONS — acciones rapidas del operador.
 *
 * Barra de botones que ejecutan operaciones comunes sin necesidad de menus.
 * Hoy son operaciones de visualizacion; cuando el backend este listo se
 * añaden operaciones de datos (mover, contar, reservar).
 */

import { Focus, Maximize, MinusCircle, PlusCircle, RotateCcw } from 'lucide-react';
import { Button } from '../../../../design/primitives/Button';
import { cn } from '../../../../design/utils/cn';

interface QuickActionsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
  onFocusSelection: () => void;
  onResetView: () => void;
  hasSelection: boolean;
  className?: string;
}

export function QuickActions({
  onZoomIn,
  onZoomOut,
  onFitAll,
  onFocusSelection,
  onResetView,
  hasSelection,
  className,
}: QuickActionsProps) {
  return (
    <div
      className={cn('flex items-center gap-1', className)}
      role="toolbar"
      aria-label="Acciones rapidas del mapa"
    >
      <Button variant="ghost" size="xs" iconOnly onClick={onZoomIn} aria-label="Acercar">
        <PlusCircle strokeWidth={1.5} className="size-4" />
      </Button>
      <Button variant="ghost" size="xs" iconOnly onClick={onZoomOut} aria-label="Alejar">
        <MinusCircle strokeWidth={1.5} className="size-4" />
      </Button>
      <Button variant="ghost" size="xs" iconOnly onClick={onFitAll} aria-label="Encuadrar todo">
        <Maximize strokeWidth={1.5} className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        onClick={onFocusSelection}
        disabled={!hasSelection}
        aria-label="Centrar en seleccion"
      >
        <Focus strokeWidth={1.5} className="size-4" />
      </Button>
      <Button variant="ghost" size="xs" iconOnly onClick={onResetView} aria-label="Restablecer vista">
        <RotateCcw strokeWidth={1.5} className="size-4" />
      </Button>
    </div>
  );
}
