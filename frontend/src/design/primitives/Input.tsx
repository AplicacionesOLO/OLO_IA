/**
 * INPUT
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Sin borde. El campo es una superficie de cristal con esquinas generosas; al
 * enfocar se ilumina desde dentro (el tinte sube y aparece el anillo de foco),
 * no se le dibuja un marco alrededor.
 *
 * Altura 52px. La version anterior usaba 40px, y un formulario de campos
 * apretados es una de las cosas que hacia que esto pareciera un panel tecnico.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El mensaje de error NUNCA desplaza el layout: ocupa espacio reservado. Un
 * campo que empuja el resto del formulario al validar es un defecto de
 * usabilidad, no un detalle estetico.
 */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string | undefined;
  hint?: string;
  /** Icono a la izquierda. Decorativo: no recibe foco. */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Reserva el hueco del mensaje aunque no haya error. */
  reserveMessageSpace?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    leading,
    trailing,
    reserveMessageSpace = true,
    className,
    id: providedId,
    disabled,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = providedId ?? autoId;
  const messageId = `${id}-msg`;
  const hasMessage = Boolean(error ?? hint);

  return (
    <div className="flex flex-col gap-2.5">
      {label && (
        <label htmlFor={id} className="t-label">
          {label}
        </label>
      )}

      <div
        className={cn(
          'group relative flex items-center gap-3',
          'h-[52px] rounded-[var(--radius-md)] px-4',
          '[background:var(--glass-2)] shadow-[var(--rim-1)]',
          'transition-[background,box-shadow] duration-[220ms] ease-out',
          'focus-within:[background:var(--glass-3)]',
          'focus-within:shadow-[var(--focus-ring)]',
          error && 'shadow-[var(--rim-1),var(--aura-critical)]',
          disabled && 'opacity-40',
        )}
      >
        {leading && (
          <span
            aria-hidden
            className={cn(
              'shrink-0 transition-colors duration-200 [&>svg]:size-[18px]',
              'text-[var(--icon-muted)] group-focus-within:text-[var(--icon-accent)]',
            )}
          >
            {leading}
          </span>
        )}

        <input
          ref={ref}
          id={id}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          className={cn(
            // El input no lleva foco visible propio: lo lleva el contenedor.
            // Si lo llevaran los dos, se verian dos anillos concentricos.
            'peer h-full w-full bg-transparent outline-none focus-visible:shadow-none',
            'text-[length:var(--text-md)] font-[var(--weight-book)] text-[var(--text-primary)]',
            'placeholder:text-[var(--text-faint)]',
            className,
          )}
          {...rest}
        />

        {trailing && (
          <span className="shrink-0 text-[var(--icon-muted)] [&>svg]:size-[18px]">
            {trailing}
          </span>
        )}
      </div>

      {/* Espacio reservado: el error no desplaza nada al aparecer. */}
      {(hasMessage || reserveMessageSpace) && (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          className={cn(
            'min-h-[18px] px-1 text-[length:var(--text-sm)] leading-[18px]',
            error ? 'text-[var(--crimson-400)]' : 'text-[var(--text-faint)]',
          )}
        >
          {error ?? hint ?? ''}
        </p>
      )}
    </div>
  );
});
