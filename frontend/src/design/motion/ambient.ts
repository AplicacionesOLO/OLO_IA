/**
 * Constantes del movimiento ambiental: el latido que nunca se detiene.
 *
 * Es lo que hace que una captura estatica se sienta viva.
 */

import type { SystemState } from '../tokens/tokens';

export const ambient = {
  /** Deriva lateral de la Mesh, casi imperceptible. */
  meshDriftPeriodMs: 24_000,
  meshDriftRangePx: 12,
  /** Particulas ambientales. */
  particleSpeed: 0.18,
  particleCountApp: 40,
  /*
    120 → 18.

    Se midieron 123 animaciones simultáneas en la pantalla de acceso, y 120 eran estas.
    Ciento veinte puntos moviéndose detrás de un formulario no se leen como atmósfera:
    se leen como ruido, y es la mitad de la queja de que el acceso «no parece
    profesional».

    18 bastan para que el aire no esté muerto. El número no es redondo a propósito: es
    el que quedó al bajar hasta que dejaba de notarse el movimiento como movimiento.
  */
  particleCountLogin: 18,
} as const;

/**
 * Ritmo por estado del sistema.
 *
 * Cuando el estado global cambia, TODA la aplicacion cambia de ritmo al mismo
 * tiempo. El operador percibe la urgencia corporalmente, antes de leer nada.
 */
export const rhythm: Record<SystemState, { breathMs: number; amplitude: number; pulseMs: number }> =
  {
    idle: { breathMs: 4000, amplitude: 0.06, pulseMs: 1800 },
    thinking: { breathMs: 3000, amplitude: 0.1, pulseMs: 1400 },
    alert: { breathMs: 2400, amplitude: 0.16, pulseMs: 1000 },
    critical: { breathMs: 1600, amplitude: 0.22, pulseMs: 700 },
    /** Detenido: el sistema perdio sus sentidos. */
    offline: { breathMs: 0, amplitude: 0, pulseMs: 0 },
  };

/** Nombres de las variables CSS que escribe el reloj. */
export const AMBIENT_VARS = {
  breath: '--ambient-breath',
  pulse: '--ambient-pulse',
  amplitude: '--ambient-amplitude',
} as const;
