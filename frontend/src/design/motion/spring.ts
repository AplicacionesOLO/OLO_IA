/**
 * Presets de fisica de resortes.
 *
 * Para gestos y elementos que el usuario manipula directamente, el resorte es
 * superior a la curva: responde a la velocidad del gesto.
 *
 * REGLA: damping siempre >= 28. Por debajo aparece rebote visible.
 */

import type { Transition } from 'framer-motion';

export const spring = {
  /** Respuesta inmediata: toggles, checkboxes, switches. */
  snap: { type: 'spring', stiffness: 700, damping: 40, mass: 0.5 },
  /** Estandar: paneles, estaciones, tamaño medio. */
  fluid: { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 },
  /** Elementos grandes: expansion de estacion, cambio de modo. */
  heavy: { type: 'spring', stiffness: 180, damping: 28, mass: 1.4 },
  /** Arrastre: reordenar estaciones, mover paneles. */
  drag: { type: 'spring', stiffness: 500, damping: 38, mass: 0.7 },
} as const satisfies Record<string, Transition>;

export type SpringName = keyof typeof spring;
