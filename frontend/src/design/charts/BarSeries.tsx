/**
 * BARSERIES — comparacion entre categorias.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Sin eje, sin rejilla y sin fondo de pista completa. Cada barra es una columna
 * de luz que crece desde la base, con el canto superior redondeado y un halo
 * proporcional a su valor.
 *
 * Las barras se implementan con divs y no con SVG a proposito: asi el radio, el
 * gradiente y el halo son los mismos tokens que usa el resto del sistema, y la
 * transicion de altura la hace el compositor.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Generico: recibe `{ label, value }[]`. Ninguna semantica de dominio.
 */

import { memo } from 'react';
import { naturePaint, type ChartNature } from './nature';
import { cn } from '../utils/cn';

export interface BarDatum {
  label: string;
  value: number;
  /** Permite destacar una categoria concreta con otra naturaleza. */
  nature?: ChartNature;
}

interface BarSeriesProps {
  data: readonly BarDatum[];
  nature?: ChartNature;
  /** Techo de la escala. Si se omite se usa el maximo de la serie. */
  max?: number;
  /** Muestra la etiqueta bajo cada barra. */
  showLabels?: boolean;
  className?: string;
}

function BarSeriesImpl({
  data,
  nature = 'measured',
  max,
  showLabels = true,
  className,
}: BarSeriesProps) {
  if (data.length === 0) return null;

  // Escala con 8% de holgura: sin ella la barra mas alta toca el techo del
  // contenedor y parece recortada.
  const ceiling = (max ?? Math.max(...data.map((d) => d.value))) * 1.08 || 1;

  return (
    <div className={cn('flex h-full w-full items-end gap-2', className)}>
      {data.map((d) => {
        const paint = naturePaint[d.nature ?? nature];
        const pct = Math.min(100, Math.max(2, (d.value / ceiling) * 100));

        return (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center gap-2.5">
            <div className="relative flex w-full flex-1 items-end justify-center">
              <div
                className="w-full max-w-[26px] rounded-t-[var(--radius-xs)] rounded-b-[3px]"
                style={{
                  height: `${pct}%`,
                  background: `linear-gradient(180deg, ${paint.stroke} 0%, color-mix(in oklab, ${paint.fillTop} 45%, transparent) 65%, transparent 100%)`,
                  boxShadow: `0 0 18px -4px ${paint.glow}`,
                }}
                title={`${d.label}: ${d.value}`}
              />
            </div>
            {showLabels && (
              <span className="t-mono-xs w-full truncate text-center text-[var(--text-faint)]">
                {d.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const BarSeries = memo(BarSeriesImpl);
