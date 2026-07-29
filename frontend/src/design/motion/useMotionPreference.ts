/**
 * Preferencias de movimiento.
 *
 * `prefers-reduced-motion` no significa "quitar las animaciones": significa
 * traducir el lenguaje de movimiento a un equivalente estatico que PRESERVE el
 * significado. Los cambios de color de estado, los indicadores de frescura y
 * las barras de progreso deterministas se conservan SIEMPRE: son informacion,
 * no decoracion.
 *
 * Ademas de la preferencia del sistema, el usuario puede reducir el movimiento
 * desde la propia aplicacion. Un operador que pasa 8 horas frente a la pantalla
 * puede querer menos movimiento sin cambiar la configuracion de su sistema
 * operativo.
 */

import { useEffect, useState } from 'react';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Se sincroniza al montar: la preferencia puede haber cambiado entre el
    // valor inicial del useState y el efecto.
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function useSystemReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

export function useSystemReducedTransparency(): boolean {
  return useMediaQuery('(prefers-reduced-transparency: reduce)');
}

/**
 * Deteccion de capacidad del dispositivo.
 *
 * Sirve para decidir si se sirve la escena rica o la degradada ANTES de
 * intentarlo, en lugar de arrancar algo que va a ir mal.
 */
export function detectDeviceCapability(): {
  lowMemory: boolean;
  lowConcurrency: boolean;
  coarsePointer: boolean;
} {
  if (typeof navigator === 'undefined') {
    return { lowMemory: false, lowConcurrency: false, coarsePointer: false };
  }

  // `deviceMemory` es no estandar y solo existe en navegadores Chromium.
  // Ausente => se asume memoria suficiente, que es el caso mayoritario.
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  return {
    lowMemory: typeof deviceMemory === 'number' && deviceMemory < 4,
    lowConcurrency: (navigator.hardwareConcurrency ?? 8) < 4,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  };
}
