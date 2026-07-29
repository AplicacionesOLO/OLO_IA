/**
 * BADGE — etiqueta informativa de estado o recuento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SIN BORDE. La version anterior usaba `border` de 1px en un color derivado del
 * tono; con seis badges en pantalla eran seis rectangulos delineados mas, y ese
 * es exactamente el ruido que habia que eliminar.
 *
 * Ahora es tinte de fondo + texto luminoso + esquinas completamente redondeadas.
 * El color hace todo el trabajo.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `tone: measured | inferred` existe para que un badge con un dato inferido por
 * IA se distinga de uno con un dato medido. Es la regla de producto aplicada
 * hasta el componente mas pequeño.
 */

import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

const badgeVariants = cva(
  [
    'inline-flex items-center gap-1.5 whitespace-nowrap',
    'rounded-[var(--radius-full)] font-medium',
  ],
  {
    variants: {
      tone: {
        neutral: '[background:var(--glass-2)] text-[var(--text-secondary)]',
        accent:
          'bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent-soft)]',
        measured:
          'bg-[color-mix(in_oklab,var(--data-measured)_16%,transparent)] text-[var(--aqua-300)]',
        inferred:
          'bg-[color-mix(in_oklab,var(--data-inferred)_18%,transparent)] text-[var(--iris-300)]',
        alert:
          'bg-[color-mix(in_oklab,var(--state-alert)_18%,transparent)] text-[var(--ember-400)]',
        critical:
          'bg-[color-mix(in_oklab,var(--state-critical)_20%,transparent)] text-[var(--crimson-400)]',
        confirmed:
          'bg-[color-mix(in_oklab,var(--state-confirmed)_16%,transparent)] text-[var(--mint-400)]',
      },
      size: {
        xs: 'h-[20px] px-2 text-[length:var(--text-2xs)] leading-none',
        sm: 'h-[24px] px-2.5 text-[length:var(--text-xs)] leading-none',
        md: 'h-[28px] px-3 text-[length:var(--text-sm)] leading-none',
      },
      numeric: {
        true: 'font-[family-name:var(--font-data)] [font-variant-numeric:tabular-nums]',
      },
      /** Añade el halo del tono. Solo para el badge que debe llamar la atencion. */
      glow: {
        true: '',
      },
    },
    compoundVariants: [
      { tone: 'alert', glow: true, class: 'shadow-[var(--aura-alert)]' },
      { tone: 'critical', glow: true, class: 'shadow-[var(--aura-critical)]' },
      { tone: 'inferred', glow: true, class: 'shadow-[var(--aura-thinking)]' },
      { tone: 'measured', glow: true, class: 'shadow-[var(--aura-idle)]' },
      { tone: 'accent', glow: true, class: 'shadow-[var(--aura-idle)]' },
    ],
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, size, numeric, glow, children, className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size, numeric, glow }), className)}>
      {children}
    </span>
  );
}
