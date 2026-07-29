import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases resolviendo conflictos de Tailwind.
 *
 * `clsx` aplana condicionales; `twMerge` resuelve que `px-2 px-4` gane el
 * ultimo. Sin twMerge, sobrescribir una clase desde props no funciona.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
