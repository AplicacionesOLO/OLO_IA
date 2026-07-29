/**
 * EL RELOJ AMBIENTAL — un solo requestAnimationFrame para toda la aplicacion.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE DISEÑO
 *
 * El latido del sistema afecta a decenas de elementos. Con estado de React
 * serian decenas de re-renders a 60 Hz: inviable.
 *
 * En lugar de eso, un unico rAF escribe DOS variables CSS en documentElement.
 * Todo lo ambiental es CSS puro que las lee.
 *
 *     1 rAF  →  --ambient-breath: 0.73   →  cientos de elementos reaccionan
 *               --ambient-pulse:  0.41       con CERO re-renders de React
 *
 * Los componentes que necesitan el valor en JS (SVG, canvas) se suscriben con
 * un callback y mutan un ref. Nunca estado.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { AMBIENT_VARS, rhythm } from './ambient';
import type { SystemState } from '../tokens/tokens';

export interface AmbientFrame {
  /** Milisegundos desde el arranque del reloj. */
  t: number;
  /** Respiracion normalizada 0..1, sinusoidal. */
  breath: number;
  /** Latido normalizado 0..1, mas rapido que la respiracion. */
  pulse: number;
  /** Contador de frames. */
  frame: number;
}

type FrameListener = (f: AmbientFrame) => void;

interface AmbientClockApi {
  /** Suscripcion para quien necesita el valor en JS. Devuelve la baja. */
  subscribe: (fn: FrameListener) => () => void;
  /** Lectura puntual sin suscribirse. */
  read: () => AmbientFrame;
  /** Fotogramas por segundo medidos en el ultimo segundo. */
  getFps: () => number;
  /** Si el reloj esta detenido (movimiento reducido u offline). */
  isPaused: () => boolean;
}

const AmbientClockContext = createContext<AmbientClockApi | null>(null);

interface AmbientClockProviderProps {
  children: ReactNode;
  systemState: SystemState;
  /** Cuando es true el reloj no arranca: se fijan valores estaticos. */
  reducedMotion: boolean;
}

export function AmbientClockProvider({
  children,
  systemState,
  reducedMotion,
}: AmbientClockProviderProps) {
  const frameRef = useRef<AmbientFrame>({ t: 0, breath: 0.5, pulse: 0.5, frame: 0 });
  const listenersRef = useRef(new Set<FrameListener>());
  const fpsRef = useRef(60);
  const pausedRef = useRef(false);

  const subscribe = useCallback((fn: FrameListener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const api = useMemo<AmbientClockApi>(
    () => ({
      subscribe,
      read: () => frameRef.current,
      getFps: () => fpsRef.current,
      isPaused: () => pausedRef.current,
    }),
    [subscribe],
  );

  useEffect(() => {
    const root = document.documentElement;
    const { breathMs, pulseMs, amplitude } = rhythm[systemState];

    // La amplitud se publica siempre: aunque el reloj este detenido, el CSS
    // puede necesitarla para calcular estados estaticos.
    root.style.setProperty(AMBIENT_VARS.amplitude, String(amplitude));

    // ── Reloj detenido ───────────────────────────────────────────────────
    // Movimiento reducido, u offline (breathMs === 0). Se fijan valores
    // centrales estaticos y no se arranca ningun rAF. Es importante que sean
    // 0.5 y no 0: un 0 apagaria los elementos que multiplican por breath.
    if (reducedMotion || breathMs === 0) {
      pausedRef.current = true;
      root.style.setProperty(AMBIENT_VARS.breath, '0.5');
      root.style.setProperty(AMBIENT_VARS.pulse, '0.5');
      frameRef.current = { t: 0, breath: 0.5, pulse: 0.5, frame: 0 };
      // Se notifica una vez para que los suscriptores pinten su estado final.
      listenersRef.current.forEach((fn) => fn(frameRef.current));
      return;
    }

    pausedRef.current = false;
    let rafId = 0;
    let start = 0;
    let frame = 0;
    let fpsWindowStart = 0;
    let fpsFrames = 0;

    // Redondeo a 3 decimales antes de escribir: sin esto, cada frame produce
    // un valor distinto en el decimal 15 y el navegador invalida estilos sin
    // necesidad.
    const round = (n: number) => Math.round(n * 1000) / 1000;

    const tick = (now: number) => {
      if (start === 0) {
        start = now;
        fpsWindowStart = now;
      }
      const t = now - start;
      frame += 1;

      // Sinusoidal normalizada a 0..1
      const breath = round((Math.sin((t / breathMs) * Math.PI * 2) + 1) / 2);
      const pulse = round((Math.sin((t / pulseMs) * Math.PI * 2) + 1) / 2);

      root.style.setProperty(AMBIENT_VARS.breath, String(breath));
      root.style.setProperty(AMBIENT_VARS.pulse, String(pulse));

      frameRef.current = { t, breath, pulse, frame };
      listenersRef.current.forEach((fn) => fn(frameRef.current));

      // Medicion de FPS en ventanas de 1s, para el guardia de rendimiento.
      fpsFrames += 1;
      if (now - fpsWindowStart >= 1000) {
        fpsRef.current = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
        fpsFrames = 0;
        fpsWindowStart = now;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    // ── Pausa en pestaña oculta ──────────────────────────────────────────
    // Sin esto, el reloj sigue consumiendo bateria en una pestaña de fondo.
    // `start` se resetea al volver para que no haya un salto en la fase.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        pausedRef.current = true;
      } else {
        pausedRef.current = false;
        start = 0;
        rafId = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [systemState, reducedMotion]);

  return <AmbientClockContext.Provider value={api}>{children}</AmbientClockContext.Provider>;
}

export function useAmbientClock(): AmbientClockApi {
  const ctx = useContext(AmbientClockContext);
  if (!ctx) {
    throw new Error('useAmbientClock debe usarse dentro de AmbientClockProvider');
  }
  return ctx;
}

/**
 * Suscripcion a cada frame para quien necesita el valor en JS.
 *
 * El callback se guarda en un ref para que cambiar su identidad no reinicie la
 * suscripcion en cada render del componente que lo usa.
 */
export function useAmbientFrame(fn: FrameListener): void {
  const { subscribe } = useAmbientClock();
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => subscribe((f) => fnRef.current(f)), [subscribe]);
}
