/**
 * SYSTEM STATE PROVIDER
 *
 * Alimenta el estado global del sistema y lo conecta con el reloj ambiental.
 *
 * En Capa 1 la fuente es la conectividad del navegador. Cuando exista Supabase
 * Realtime, se suscribira a eventos reales y este sera el unico archivo que
 * cambie: ningun componente consumidor se toca.
 */

import { useEffect, type ReactNode } from 'react';
import { AmbientClockProvider } from '../design/motion/AmbientClock';
import { useSystemReducedMotion } from '../design/motion/useMotionPreference';
import { useSystemStore } from './systemStore';

export function SystemStateProvider({ children }: { children: ReactNode }) {
  const systemState = useSystemStore((s) => s.state);
  const setState = useSystemStore((s) => s.setState);
  const pushEvent = useSystemStore((s) => s.pushEvent);
  const reducedMotion = useSystemReducedMotion();

  // ── Conectividad ────────────────────────────────────────────────────────
  // Cuando el navegador pierde la red, el estado pasa a `offline`: el reloj se
  // detiene y la Mesh se congela. Es la manifestacion de "el sistema perdio sus
  // sentidos", y comunica mas que cualquier mensaje de error.
  useEffect(() => {
    const goOffline = () => {
      setState('offline');
      pushEvent({
        kind: 'system',
        severity: 'critical',
        message: 'Conexion perdida. Los datos mostrados pueden estar desactualizados.',
      });
    };
    const goOnline = () => {
      setState('idle');
      pushEvent({ kind: 'system', severity: 'info', message: 'Conexion restablecida.' });
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    // Estado inicial: si ya arrancamos sin red, hay que reflejarlo.
    if (!navigator.onLine) setState('offline');

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [setState, pushEvent]);

  return (
    <AmbientClockProvider systemState={systemState} reducedMotion={reducedMotion}>
      {children}
    </AmbientClockProvider>
  );
}
