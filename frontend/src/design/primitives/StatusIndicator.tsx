/**
 * STATUSINDICATOR
 *
 * WCAG 1.4.1: el color NUNCA es el unico canal. Cada estado se codifica en
 * color + FORMA + (opcionalmente) etiqueta de texto. Un operador con daltonismo
 * distingue los estados por su geometria.
 *
 * El punto activo lleva halo, no solo relleno: en este lenguaje visual el estado
 * se comunica con luz.
 */

import { cn } from '../utils/cn';
import type { SystemState } from '../tokens/tokens';

export type IndicatorState = SystemState | 'confirmed' | 'stale';

interface StatusIndicatorProps {
  state: IndicatorState;
  size?: 'xs' | 'sm' | 'md';
  label?: string;
  /** Añade el latido del reloj ambiental. Solo para estados activos. */
  live?: boolean;
  className?: string;
}

const SIZE = { xs: 8, sm: 10, md: 13 } as const;

const COLOR: Record<IndicatorState, string> = {
  idle: 'var(--state-idle)',
  thinking: 'var(--state-thinking)',
  alert: 'var(--state-alert)',
  critical: 'var(--state-critical)',
  confirmed: 'var(--state-confirmed)',
  offline: 'var(--icon-muted)',
  stale: 'var(--icon-muted)',
};

const A11Y_LABEL: Record<IndicatorState, string> = {
  idle: 'Nominal',
  thinking: 'Procesando',
  alert: 'Requiere atencion',
  critical: 'Fallo critico',
  confirmed: 'Confirmado',
  offline: 'Sin conexion',
  stale: 'Datos desactualizados',
};

/**
 * La forma es el segundo canal.
 * Circulo = nominal · nodo = pensando · triangulo = alerta · octagono = critico
 */
function Glyph({ state, px }: { state: IndicatorState; px: number }) {
  const color = COLOR[state];
  const c = px / 2;

  if (state === 'alert') {
    return <polygon points={`${c},1 ${px - 1},${px - 1.5} 1,${px - 1.5}`} fill={color} />;
  }
  if (state === 'critical') {
    // Octagono: la forma de "stop", reconocible universalmente
    const k = px * 0.29;
    return (
      <polygon
        points={`${k},1 ${px - k},1 ${px - 1},${k} ${px - 1},${px - k} ${px - k},${px - 1} ${k},${px - 1} 1,${px - k} 1,${k}`}
        fill={color}
      />
    );
  }
  if (state === 'thinking') {
    // Nodo con conexiones: sugiere computo
    return (
      <g stroke={color} strokeWidth={1} fill="none">
        <circle cx={c} cy={c} r={px * 0.22} fill={color} />
        <line x1={c} y1={c} x2={px - 0.5} y2={1} />
        <line x1={c} y1={c} x2={0.5} y2={px - 1} />
      </g>
    );
  }
  if (state === 'stale' || state === 'offline') {
    // Circulo tachado
    return (
      <g>
        <circle cx={c} cy={c} r={c - 1} fill="none" stroke={color} strokeWidth={1.2} />
        <line x1={1.5} y1={px - 1.5} x2={px - 1.5} y2={1.5} stroke={color} strokeWidth={1.2} />
      </g>
    );
  }
  // idle y confirmed: circulo relleno
  return <circle cx={c} cy={c} r={c - 0.5} fill={color} />;
}

export function StatusIndicator({
  state,
  size = 'sm',
  label,
  live = false,
  className,
}: StatusIndicatorProps) {
  const px = SIZE[size];
  const isAnimated = live && state !== 'offline' && state !== 'stale';

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative inline-flex shrink-0 items-center justify-center">
        {/* Halo difuso detras del glifo. Es lo que hace que el estado se lea
            como luz emitida y no como un icono coloreado. */}
        {isAnimated && (
          <span
            aria-hidden
            className="olo-pulse absolute inset-0 rounded-full"
            style={{
              boxShadow: `0 0 0 3px color-mix(in oklab, ${COLOR[state]} 18%, transparent), 0 0 14px 1px color-mix(in oklab, ${COLOR[state]} 45%, transparent)`,
            }}
          />
        )}
        <svg
          width={px}
          height={px}
          viewBox={`0 0 ${px} ${px}`}
          role="img"
          aria-label={label ? undefined : A11Y_LABEL[state]}
          aria-hidden={label ? true : undefined}
          className="relative"
        >
          <Glyph state={state} px={px} />
        </svg>
      </span>
      {label && <span className="t-label">{label}</span>}
    </span>
  );
}
