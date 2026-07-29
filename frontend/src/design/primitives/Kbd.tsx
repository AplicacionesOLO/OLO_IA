/**
 * KBD — tecla de atajo.
 *
 * En un centro de control el teclado es mas rapido que el raton, asi que los
 * atajos deben ser visibles y no un secreto para iniciados.
 *
 * Sin borde: tinte de cristal + rim superior, como el resto del sistema.
 */

import { cn } from '../utils/cn';

interface KbdProps {
  children: string;
  className?: string;
}

/** Normaliza el modificador segun la plataforma para no mostrar Ctrl en macOS. */
export function platformModifier(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[22px] min-w-[22px] items-center justify-center px-1.5',
        'rounded-[var(--radius-xs)] [background:var(--glass-2)] shadow-[var(--rim-2)]',
        'font-[family-name:var(--font-data)] text-[length:var(--text-2xs)] leading-none',
        'text-[var(--text-muted)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
