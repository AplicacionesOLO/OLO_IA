/**
 * PANEL — cristal flotante. Reemplaza al antiguo `Surface`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUE CAMBIA Y POR QUE
 *
 * El `Surface` anterior aplicaba `border: 1px solid` en los cuatro lados. Con
 * doce paneles en pantalla, el resultado era una reticula de lineas visibles:
 * el lenguaje exacto del software industrial.
 *
 * Este componente NO tiene borde. Se delimita con:
 *
 *   1. RIM   — un realce interior de 1px SOLO arriba, como si la luz
 *              ambiental rozara el canto superior del cristal.
 *   2. DROP  — una sombra de radio muy amplio y opacidad baja, que separa por
 *              profundidad en lugar de por contraste.
 *   3. GLASS — tinte translucido, que deja pasar la luz del fondo.
 *
 * Es como funciona VisionOS. La diferencia entre "caja" y "cristal flotando"
 * esta enteramente en estos tres detalles.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PRESUPUESTO DE BLUR — decision deliberada
 *
 * Solo `hero` y `decision` piden `backdrop-filter`. `support` y `work` NO.
 *
 * Razon: el fondo es un degradado suave y sin detalle, asi que desenfocarlo es
 * visualmente indistinguible de no hacerlo. Con siete paneles en el dashboard,
 * pedir blur en todos agotaria el presupuesto de 4 capas y unos lo tendrian y
 * otros no — y la INCOHERENCIA se nota mucho mas que la ausencia. El blur se
 * reserva para donde si hay contenido detras que desenfocar.
 */

import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils/cn';
import { useBlurBudget } from './useBlurBudget';

/** Nivel de elevacion. Define la jerarquia de atencion. */
export type PanelLevel =
  /** Informacion de apoyo. Apenas se despega del fondo. */
  | 'support'
  /** Nivel de trabajo. La mayoria de los paneles. */
  | 'work'
  /** El foco principal de la vista. */
  | 'hero'
  /** Decision: formularios, dialogos. */
  | 'decision';

/** Estado del dato que contiene. Determina el aura, nunca un borde de color. */
export type PanelAura = 'none' | 'idle' | 'thinking' | 'alert' | 'critical' | 'hero';

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  level?: PanelLevel;
  aura?: PanelAura;
  radius?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Padding interior. `none` para paneles que gestionan su propio espacio. */
  pad?: 'none' | 'sm' | 'md' | 'lg';
  /** Resalta al pasar el puntero. Solo para paneles accionables. */
  interactive?: boolean;
  /** Luz que emana desde la base. Para el Twin y los paneles heroe. */
  floorGlow?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

const LEVEL_BG: Record<PanelLevel, string> = {
  support: '[background:var(--glass-1)]',
  work: '[background:var(--glass-2)]',
  hero: '[background:var(--glass-2)]',
  decision: '[background:var(--glass-3)]',
};

/** Solo los niveles con contenido detras piden blur. Ver cabecera. */
const LEVEL_BLUR: Record<PanelLevel, number> = {
  support: 0,
  work: 0,
  hero: 28,
  decision: 40,
};

/** RIM + DROP combinados. Ambos son box-shadow, asi que van juntos. */
const LEVEL_RIM: Record<PanelLevel, string> = {
  support: 'var(--rim-1)',
  work: 'var(--rim-2)',
  hero: 'var(--rim-2)',
  decision: 'var(--rim-3)',
};

const LEVEL_DROP: Record<PanelLevel, string> = {
  support: 'var(--drop-1)',
  work: 'var(--drop-2)',
  hero: 'var(--drop-3)',
  decision: 'var(--drop-4)',
};

const AURA: Record<PanelAura, string | null> = {
  none: null,
  idle: 'var(--aura-idle)',
  thinking: 'var(--aura-thinking)',
  alert: 'var(--aura-alert)',
  critical: 'var(--aura-critical)',
  hero: 'var(--aura-hero)',
};

const RADIUS: Record<NonNullable<PanelProps['radius']>, string> = {
  sm: 'rounded-[var(--radius-sm)]',
  md: 'rounded-[var(--radius-md)]',
  lg: 'rounded-[var(--radius-lg)]',
  xl: 'rounded-[var(--radius-xl)]',
  '2xl': 'rounded-[var(--radius-2xl)]',
};

const PAD: Record<NonNullable<PanelProps['pad']>, string> = {
  none: '',
  sm: 'p-[var(--space-5)]',
  md: 'p-[var(--panel-pad)]',
  lg: 'p-[var(--panel-pad-lg)]',
};

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  {
    level = 'work',
    aura = 'none',
    radius = 'lg',
    pad = 'md',
    interactive = false,
    floorGlow = false,
    as,
    className,
    children,
    ...rest
  },
  ref,
) {
  const Component = (as ?? 'div') as ElementType;
  const blurPx = LEVEL_BLUR[level];
  const blurEnabled = useBlurBudget(blurPx > 0, level);

  // RIM, DROP y AURA son todos box-shadow: se componen en una sola declaracion.
  // Se pasa por `style` y no por clase de Tailwind porque la combinacion es
  // dinamica; generar 24 clases estaticas para cubrirla no aporta nada.
  const auraShadow = AURA[aura];
  const boxShadow = [LEVEL_RIM[level], LEVEL_DROP[level], auraShadow]
    .filter(Boolean)
    .join(', ');

  return (
    <Component
      ref={ref}
      data-level={level}
      className={cn(
        'relative isolate overflow-hidden',
        LEVEL_BG[level],
        RADIUS[radius],
        PAD[pad],
        interactive && [
          'transition-[transform,background] duration-[280ms] ease-out',
          'hover:-translate-y-[2px]',
          // El foco se dibuja con `outline` y NO con box-shadow: el box-shadow
          // del panel se define en `style`, e inline gana siempre sobre una
          // clase. Un panel accionable sin indicador de foco seria un defecto
          // de accesibilidad, no un detalle.
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--accent)]',
        ],
        className,
      )}
      style={{
        boxShadow,
        ...(blurEnabled
          ? {
              backdropFilter: `blur(${blurPx}px) saturate(1.5)`,
              WebkitBackdropFilter: `blur(${blurPx}px) saturate(1.5)`,
            }
          : {}),
      }}
      {...rest}
    >
      {/* Luz que emana desde la base. Da la sensacion de que el contenido
          irradia en lugar de estar dibujado sobre una superficie. */}
      {floorGlow && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: 'var(--grad-hero-floor)' }}
        />
      )}
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </Component>
  );
});
