/**
 * PRESUPUESTO DE CAPAS BLUR
 *
 * `backdrop-filter` es la operacion mas costosa del sistema visual. Sin limite,
 * mata los 60 FPS en graficos integrados, que es exactamente el hardware de un
 * portatil corporativo.
 *
 * Este hook lleva la cuenta global. Al superar el maximo:
 *   · en desarrollo, emite un warning con el plano culpable;
 *   · en produccion, DESACTIVA el blur de las capas excedentes.
 *
 * Degradar en silencio es preferible a caer a 30 FPS: el usuario nota mucho mas
 * la perdida de fluidez que la ausencia de blur en un panel de fondo.
 */

import { useEffect, useState } from 'react';

const MAX_BLUR_LAYERS = 4;

let activeLayers = 0;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

function acquire(): number {
  activeLayers += 1;
  const slot = activeLayers;
  notify();
  return slot;
}

function release() {
  activeLayers = Math.max(0, activeLayers - 1);
  notify();
}

export function getActiveBlurLayers(): number {
  return activeLayers;
}

/**
 * Reserva una capa de blur.
 *
 * @param wanted  si el componente quiere blur
 * @param label   identificador para el warning de desarrollo
 * @returns       si el blur esta concedido
 */
export function useBlurBudget(wanted: boolean, label: string): boolean {
  const [granted, setGranted] = useState(wanted);

  useEffect(() => {
    if (!wanted) {
      setGranted(false);
      return;
    }

    const slot = acquire();
    const allowed = slot <= MAX_BLUR_LAYERS;
    setGranted(allowed);

    if (!allowed && import.meta.env.DEV) {
      console.warn(
        `[OLO/blur] Presupuesto excedido: ${slot} capas activas, maximo ${MAX_BLUR_LAYERS}. ` +
          `El blur del plano "${label}" se ha desactivado. ` +
          `Revisa cuantas Surface con veil hay montadas simultaneamente.`,
      );
    }

    return () => release();
  }, [wanted, label]);

  return granted;
}

/** Suscripcion al contador, para el panel de diagnostico. */
export function subscribeBlurBudget(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
