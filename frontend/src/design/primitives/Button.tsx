/**
 * BUTTON
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `primary` usa el GRADIENTE de accion (violeta → indigo → azul), no un color
 * plano. Es la unica accion con gradiente de la pantalla: es lo que la convierte
 * en el destino obvio del ojo. Si hubiera dos, no habria ninguna.
 *
 * `command` dispara un proceso del sistema (una inferencia, una sincronizacion).
 * No es lo mismo que guardar un formulario, asi que su estado de carga es un
 * SCAN y no un spinner.
 *
 * NINGUNA variante lleva borde de 4 lados. La delimitacion es tinte + rim.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ── LA DIANA CRECE EN PANTALLAS TACTILES ─────────────────────────────────
 *
 * Con raton, 32x32 sobra: WCAG 2.5.8 pide 24 y el cursor es preciso. Con un dedo
 * no: Apple y Google piden 44, y por debajo la gente falla el toque.
 *
 * Medido en un iPhone 13 emulado (390x844), en la pantalla donde el operario
 * revisa detecciones: las pestañas «Todas / Aceptadas / Pendientes / Rechazadas»
 * median 32px de alto, y los controles del mapa espacial 24x24.
 *
 * `pointer-coarse:` solo aplica cuando el dispositivo apunta con un dedo, asi que
 * la densidad de escritorio —que es deliberada en un producto de esta carga de
 * informacion— no cambia.
 *
 * `min-h`/`min-w` y no `h`/`w` a proposito: gana sobre la altura que ponga cada
 * variante Y sobre la que ponga un componente por su cuenta con `className`. Un
 * boton con `size-6` sigue midiendo 44 al tacto sin tener que ir a buscarlo.
 */

import { forwardRef, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { cn } from '../utils/cn';
import { spring } from '../motion/spring';
import { ScanLine } from './ScanLine';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center overflow-hidden',
    'font-medium whitespace-nowrap select-none',
    // La diana tactil. Ver la cabecera: no se puede resolver con un pseudo-elemento
    // porque `overflow-hidden` —que necesita el barrido de ScanLine— lo recortaria.
    'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
    'transition-[background,box-shadow,color,opacity] duration-[200ms] ease-out',
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
    'disabled:opacity-40 disabled:pointer-events-none',
  ],
  {
    variants: {
      variant: {
        /** La accion principal. Una sola por pantalla. */
        primary: [
          '[background:var(--grad-action)] text-white',
          'shadow-[var(--rim-3),0_10px_30px_-12px_rgb(99_102_241/0.55)]',
          'hover:[background:var(--grad-action-hover)]',
          'hover:shadow-[var(--rim-3),0_14px_40px_-12px_rgb(99_102_241/0.7)]',
        ],
        /** Accion secundaria. Cristal, sin borde. */
        secondary: [
          '[background:var(--glass-2)] text-[var(--text-primary)]',
          'shadow-[var(--rim-2),var(--drop-1)]',
          'hover:[background:var(--glass-3)]',
        ],
        /** Terciaria. Solo texto hasta que se apunta. */
        ghost: [
          'bg-transparent text-[var(--text-muted)]',
          'hover:[background:var(--glass-1)] hover:text-[var(--text-primary)]',
        ],
        danger: [
          'bg-[color-mix(in_oklab,var(--state-critical)_14%,transparent)]',
          'text-[var(--crimson-400)]',
          'shadow-[var(--rim-1)]',
          'hover:bg-[color-mix(in_oklab,var(--state-critical)_24%,transparent)]',
        ],
        /** Dispara cognicion. Violeta: es el color de la inferencia. */
        command: [
          'bg-[color-mix(in_oklab,var(--data-inferred)_15%,transparent)]',
          'text-[var(--text-inferred)]',
          'shadow-[var(--rim-1),var(--aura-thinking)]',
          'hover:bg-[color-mix(in_oklab,var(--data-inferred)_26%,transparent)]',
        ],
      },
      size: {
        xs: 'h-8 gap-1.5 px-3 text-[length:var(--text-xs)] rounded-[var(--radius-xs)]',
        sm: 'h-9 gap-2 px-4 text-[length:var(--text-sm)] rounded-[var(--radius-sm)]',
        md: 'h-11 gap-2 px-5 text-[length:var(--text-base)] rounded-[var(--radius-sm)]',
        lg: 'h-12 gap-2.5 px-6 text-[length:var(--text-md)] rounded-[var(--radius-md)]',
      },
      iconOnly: {
        /** Cuadrado, sin padding horizontal, manteniendo la diana minima. */
        true: 'px-0 aspect-square',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

/**
 * Se extiende `HTMLMotionProps` y no `ButtonHTMLAttributes` porque el elemento
 * subyacente es `motion.button`: sus tipos de `style` y de los manejadores de
 * animacion son propios de Framer y no compatibles con los del DOM cuando
 * `exactOptionalPropertyTypes` esta activo.
 */
export interface ButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children' | 'ref'>,
    VariantProps<typeof buttonVariants> {
  /** Muestra SCAN y bloquea la interaccion. No es un spinner: es un barrido. */
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, iconOnly, loading = false, disabled, className, children, type, ...rest },
  ref,
) {
  const isInert = Boolean(disabled) || loading;

  return (
    <motion.button
      ref={ref}
      type={type ?? 'button'}
      {...(isInert ? {} : { whileTap: { scale: 0.985 } as const })}
      transition={spring.snap}
      disabled={isInert}
      {...(loading ? { 'aria-busy': true } : {})}
      className={cn(buttonVariants({ variant, size, iconOnly }), className)}
      {...rest}
    >
      {loading && <ScanLine className="absolute inset-0" />}
      <span
        className={cn(
          'inline-flex items-center gap-[inherit]',
          loading && 'opacity-50',
        )}
      >
        {children}
      </span>
    </motion.button>
  );
});
