/**
 * LEYENDA DE ESTADOS — referencia visual siempre visible.
 *
 * Sin ella el usuario tiene que inferir que significa cada color, y la inferencia
 * varia entre personas. La leyenda es el contrato entre el sistema y el operador.
 */

import { cn } from '../../../design/utils/cn';
import type { LocationStatus } from '../types/index';

export const STATUS_META: Record<LocationStatus, { label: string; color: string; description: string }> = {
  occupied: { label: 'Ocupada', color: 'var(--aqua-400)', description: 'Con stock confirmado' },
  available: { label: 'Disponible', color: 'var(--mint-400)', description: 'Libre para asignar' },
  inferred: { label: 'Inferida', color: 'var(--iris-400)', description: 'Estado deducido por IA' },
  invalid: { label: 'Invalida', color: 'var(--crimson-400)', description: 'Error o conflicto' },
  reserved: { label: 'Reservada', color: 'var(--ember-400)', description: 'Reservada para operacion' },
  blocked: { label: 'Bloqueada', color: 'var(--text-faint)', description: 'No disponible' },
};

export const STATUS_TONE: Record<LocationStatus, 'measured' | 'confirmed' | 'inferred' | 'critical' | 'alert' | 'neutral'> = {
  occupied: 'measured',
  available: 'confirmed',
  inferred: 'inferred',
  invalid: 'critical',
  reserved: 'alert',
  blocked: 'neutral',
};

interface StatusLegendProps {
  compact?: boolean;
  className?: string;
}

export function StatusLegend({ compact = false, className }: StatusLegendProps) {
  const items: LocationStatus[] = ['occupied', 'available', 'inferred', 'invalid', 'reserved', 'blocked'];

  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}
      role="list"
      aria-label="Leyenda de estados"
    >
      {items.map((s) => {
        const meta = STATUS_META[s];
        return (
          <div
            key={s}
            className="flex items-center gap-2"
            role="listitem"
            title={meta.description}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: meta.color, boxShadow: `0 0 6px 1px color-mix(in oklab, ${meta.color} 40%, transparent)` }}
            />
            <span className={cn('text-[var(--text-secondary)]', compact ? 't-mono-xs' : 'text-[length:var(--text-xs)]')}>
              {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
