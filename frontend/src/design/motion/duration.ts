/**
 * Escala de duraciones en milisegundos.
 *
 * La masa determina la duracion: un elemento grande tarda mas que uno pequeño.
 * Es fisica basica y el cerebro lo espera.
 */

export const durationMs = {
  instant: 80,
  quick: 140,
  base: 220,
  moderate: 340,
  slow: 480,
  scene: 900,
  epic: 1800,
} as const;

/** Framer Motion trabaja en segundos. */
export const duration = {
  instant: 0.08,
  quick: 0.14,
  base: 0.22,
  moderate: 0.34,
  slow: 0.48,
  scene: 0.9,
  epic: 1.8,
} as const;

export type DurationName = keyof typeof duration;

/**
 * Duracion de la transicion de un valor numerico (movimiento COUNT).
 * Proporcional a la magnitud del cambio, con techo: un salto de 1 a 1.000.000
 * no puede tardar un minuto.
 */
export function countDuration(from: number, to: number): number {
  const delta = Math.abs(to - from);
  const magnitude = Math.log10(delta + 1);
  return Math.min(120 + magnitude * 180, 800);
}
