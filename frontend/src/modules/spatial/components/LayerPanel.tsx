/**
 * PANEL DE CAPAS — controla que se ve sobre el mapa.
 *
 * "Capa" en un WMS es una dimension de visualizacion: puedes ver solo las
 * ocupadas, solo las que la IA infiere, o ambas. Es el concepto que permite que
 * un mapa denso siga siendo legible.
 *
 * Hoy las capas corresponden a los estados; en el futuro se añadirán capas de
 * flujo (rutas de AGV), capas de temperatura, capas de antigüedad del stock, etc.
 */

import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../../design/utils/cn';
import type { LocationStatus } from '../types/index';
import { STATUS_META } from './StatusLegend';

export interface LayerConfig {
  occupied: boolean;
  available: boolean;
  inferred: boolean;
  invalid: boolean;
  reserved: boolean;
  blocked: boolean;
}

export const DEFAULT_LAYERS: LayerConfig = {
  occupied: true,
  available: true,
  inferred: true,
  invalid: true,
  reserved: true,
  blocked: true,
};

interface LayerPanelProps {
  layers: LayerConfig;
  onToggle: (status: LocationStatus) => void;
  className?: string;
}

export function LayerPanel({ layers, onToggle, className }: LayerPanelProps) {
  const items: LocationStatus[] = ['occupied', 'available', 'inferred', 'invalid', 'reserved', 'blocked'];
  const activeCount = Object.values(layers).filter(Boolean).length;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <span className="t-label">Capas</span>
        <span className="t-mono-xs text-[var(--text-faint)]">{activeCount}/6</span>
      </div>
      <div className="flex flex-col gap-1">
        {items.map((s) => {
          const meta = STATUS_META[s];
          const active = layers[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => onToggle(s)}
              className={cn(
                'flex items-center gap-2.5 rounded-[var(--radius-xs)] px-2.5 py-1.5 transition-colors',
                active
                  ? 'text-[var(--text-primary)] hover:[background:var(--glass-1)]'
                  : 'text-[var(--text-faint)] opacity-50 hover:opacity-75',
              )}
              aria-label={`${active ? 'Ocultar' : 'Mostrar'} capa ${meta.label}`}
              aria-pressed={active}
            >
              {active ? (
                <Eye strokeWidth={1.5} className="size-3.5" />
              ) : (
                <EyeOff strokeWidth={1.5} className="size-3.5" />
              )}
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: active ? meta.color : 'var(--text-faint)' }}
              />
              <span className="text-[length:var(--text-xs)]">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
