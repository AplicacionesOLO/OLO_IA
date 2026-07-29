/**
 * Variantes reutilizables de Framer Motion.
 *
 * LEY 2 DEL SISTEMA DE MOVIMIENTO: todo movimiento tiene origen y destino
 * espacial. Prohibido el fade puro — es el gesto de un ERP.
 *
 * El `filter: blur` de entrada es lo que diferencia EMERGE de un fade
 * generico: el elemento se ENFOCA al llegar, como una lente ajustandose.
 */

import type { Variants } from 'framer-motion';
import { easing } from './easing';
import { duration } from './duration';

/** Aparicion de superficie. El movimiento por defecto. */
export const emerge: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 12, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: duration.base, ease: easing.emerge },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: 6,
    filter: 'blur(4px)',
    transition: { duration: duration.quick, ease: easing.retire },
  },
};

/** Igual que emerge pero sin blur: para elementos con muchas instancias. */
export const emergeLight: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easing.emerge },
  },
  exit: { opacity: 0, y: 4, transition: { duration: duration.quick, ease: easing.retire } },
};

/** Entrada lateral, para el Stream y los feeds. */
export const slideFromRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: duration.moderate, ease: easing.glide },
  },
  exit: { opacity: 0, x: -12, transition: { duration: duration.quick, ease: easing.retire } },
};

/** Contenedor que escalona la entrada de sus hijos. */
export function staggerContainer(step: number, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: step, delayChildren },
    },
    exit: {
      // En salida el orden se invierte: lo ultimo que entro es lo primero
      // que sale.
      transition: { staggerChildren: step / 2, staggerDirection: -1 },
    },
  };
}

/** Traduccion a movimiento reducido: cross-fade sin desplazamiento. */
export const reducedFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12, ease: 'linear' } },
  exit: { opacity: 0, transition: { duration: 0.08, ease: 'linear' } },
};

/**
 * Selector de variante segun preferencia de movimiento.
 * Todo componente animado pasa por aqui: es lo que garantiza que la traduccion
 * a movimiento reducido no se olvide en ningun sitio.
 */
export function motionVariant(variant: Variants, reducedMotion: boolean): Variants {
  return reducedMotion ? reducedFade : variant;
}
