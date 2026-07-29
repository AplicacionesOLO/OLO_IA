/**
 * Escalonados. La aparicion secuencial es la firma de movimiento de OLO IA:
 * comunica que el sistema construye la interfaz con intencion.
 */

export const stagger = {
  /** Filas de tabla, items de lista. */
  tight: 0.024,
  /** Items de menu, chips. */
  base: 0.045,
  /** Estaciones en el Canvas. */
  loose: 0.07,
  /** Lineas del HUD de diagnostico en el login. */
  scene: 0.11,
} as const;

export type StaggerName = keyof typeof stagger;

/**
 * Limite de 12 elementos.
 *
 * A partir del 12º el stagger se colapsa a 0. Una lista de 200 filas
 * escalonadas a 24ms tarda 5 segundos en aparecer: inaceptable.
 */
export const STAGGER_LIMIT = 12;

export function staggerDelay(index: number, step: number): number {
  return index < STAGGER_LIMIT ? index * step : STAGGER_LIMIT * step;
}
