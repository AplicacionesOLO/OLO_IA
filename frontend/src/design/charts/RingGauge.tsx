/**
 * RINGGAUGE — una fraccion como anillo de luz.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * El anillo de fondo es casi invisible (6% de blanco). Solo el arco de progreso
 * emite. Es la diferencia entre un medidor de instrumentacion —donde el marco
 * pesa lo mismo que el dato— y un indicador donde la luz ES el dato.
 *
 * `strokeLinecap="round"` en el arco: un canto recto en el extremo del progreso
 * lee como barra tecnica; el canto redondeado lee como haz de luz.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Generico: recibe una fraccion 0..1 y contenido libre en el centro.
 */

import { memo, useId, type ReactNode } from 'react';
import { ringArc } from './geometry';
import { naturePaint, type ChartNature } from './nature';
import { cn } from '../utils/cn';

interface RingGaugeProps {
  /** 0..1. Se recorta al rango, no se confia en el llamante. */
  value: number;
  nature?: ChartNature;
  /** Diametro en px. */
  size?: number;
  thickness?: number;
  reducedMotion?: boolean;
  /** Contenido central: normalmente el valor y su etiqueta. */
  children?: ReactNode;
  /** Descripcion para lectores de pantalla. El SVG por si solo no la aporta. */
  ariaLabel?: string;
  className?: string;
}

function RingGaugeImpl({
  value,
  nature = 'measured',
  size = 132,
  thickness = 6,
  reducedMotion = false,
  children,
  ariaLabel,
  className,
}: RingGaugeProps) {
  const uid = useId().replace(/:/g, '');
  const paint = naturePaint[nature];
  const clamped = Math.min(1, Math.max(0, value));

  const c = size / 2;
  const r = c - thickness / 2 - 2;

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      {...(ariaLabel
        ? { role: 'img', 'aria-label': ariaLabel }
        : { 'aria-hidden': true })}
    >
      <svg
        className={cn('absolute inset-0', !reducedMotion && 'olo-breathe-soft')}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`rg-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={paint.fillTop} />
            <stop offset="100%" stopColor={paint.stroke} />
          </linearGradient>
        </defs>

        {/* Pista de fondo. Casi invisible por diseño. */}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgb(255 255 255 / 0.06)"
          strokeWidth={thickness}
        />

        <path
          d={ringArc(c, c, r, clamped)}
          fill="none"
          stroke={`url(#rg-${uid})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${paint.glow})` }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        {children}
      </div>
    </div>
  );
}

export const RingGauge = memo(RingGaugeImpl);
