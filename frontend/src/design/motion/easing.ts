/**
 * Curvas de aceleracion canonicas.
 *
 * El overshoot de `emerge` es minimo (2%): suficiente para sentirse vivo,
 * insuficiente para parecer juguetón. En software industrial el rebote visible
 * se lee como falta de seriedad.
 */

export const easing = {
  /** Emerge con energia y se asienta. Entrada por defecto. */
  emerge: [0.16, 1.0, 0.3, 1.0],
  /** Se retira rapido. Nadie quiere esperar a que algo desaparezca. */
  retire: [0.55, 0.0, 1.0, 0.45],
  /** Movimiento A→B. Simetrico, predecible, sin drama. */
  glide: [0.45, 0.05, 0.55, 0.95],
  /** Micro-interacciones. Casi lineal, respuesta inmediata. */
  precise: [0.3, 0.0, 0.35, 1.0],
  /** Camara y cambios de nivel. Desaceleracion larga = peso y escala. */
  cinematic: [0.22, 1.0, 0.36, 1.0],
  /** El latido y la respiracion. Sinusoidal. */
  breathe: [0.37, 0.0, 0.63, 1.0],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type EasingName = keyof typeof easing;
