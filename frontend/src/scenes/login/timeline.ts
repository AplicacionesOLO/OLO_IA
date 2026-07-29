/**
 * TIMELINE DE LA SECUENCIA DE ARRANQUE
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA ESCENA ES UN REGALO, NUNCA UN PEAJE.
 *
 * Un operador que entra 40 veces al dia no puede esperar 8 segundos. Por eso:
 *
 *   · El campo de correo es enfocable a los 800ms, sin esperar la escena.
 *   · Cualquier tecla o click salta al panel de credenciales.
 *   · A partir de la segunda sesion del dia, la secuencia dura 1.4s.
 * ─────────────────────────────────────────────────────────────────────────
 */

const SEEN_KEY = 'olo.scene.lastSeen';

export interface SceneTiming {
  /** Punto de origen: el primer destello. */
  spark: number;
  /** Los axones iniciales se expanden. */
  axons: number;
  /** La malla neuronal se teje. */
  mesh: number;
  /** La camara retrocede y revela el almacen. */
  reveal: number;
  /** Los racks ganan volumen. */
  materialize: number;
  /** Aparecen drones, AGVs y conos de escaneo. */
  agents: number;
  /** El HUD de diagnostico entra escalonado. */
  hud: number;
  /** El panel de credenciales se materializa. */
  panel: number;
  /** Duracion total hasta el estado de reposo. */
  total: number;
}

/** Secuencia completa: primera visita del dia. */
export const FULL_TIMING: SceneTiming = {
  spark: 0,
  axons: 0.6,
  mesh: 1.4,
  reveal: 2.6,
  materialize: 4.0,
  agents: 4.2,
  hud: 5.2,
  panel: 6.4,
  total: 6.8,
};

/**
 * Secuencia abreviada: sesiones posteriores del mismo dia.
 * Se salta el tejido de la malla y entra casi directo al estado final.
 */
export const SHORT_TIMING: SceneTiming = {
  spark: 0,
  axons: 0.05,
  mesh: 0.1,
  reveal: 0.2,
  materialize: 0.3,
  agents: 0.35,
  hud: 0.6,
  panel: 1.0,
  total: 1.4,
};

/** Sin animacion: todo en su estado final. Para movimiento reducido. */
export const INSTANT_TIMING: SceneTiming = {
  spark: 0,
  axons: 0,
  mesh: 0,
  reveal: 0,
  materialize: 0,
  agents: 0,
  hud: 0,
  panel: 0,
  total: 0,
};

/**
 * ¿Es la primera vez hoy?
 *
 * Se compara por dia natural y no por sesion: un operador que entra a las 8:00 y
 * a las 14:00 ya vio la escena, y repetirsela seria fricción.
 */
export function isFirstVisitToday(): boolean {
  try {
    const last = localStorage.getItem(SEEN_KEY);
    if (!last) return true;
    const today = new Date().toDateString();
    return last !== today;
  } catch {
    // localStorage puede fallar en modo privado estricto. Ante la duda, se
    // muestra la escena completa: es el comportamiento mas favorable.
    return true;
  }
}

export function markVisited(): void {
  try {
    localStorage.setItem(SEEN_KEY, new Date().toDateString());
  } catch {
    // Sin persistencia, la escena se vera completa cada vez. Aceptable.
  }
}

export function resolveTiming(reducedMotion: boolean): SceneTiming {
  if (reducedMotion) return INSTANT_TIMING;
  return isFirstVisitToday() ? FULL_TIMING : SHORT_TIMING;
}

/** Lineas del HUD de diagnostico. El ultimo item es la invitacion implicita. */
export const DIAGNOSTIC_LINES: readonly { label: string; value: string; pending?: boolean }[] = [
  { label: 'Red neuronal', value: 'activa' },
  { label: 'Nodos edge', value: '47 / 47' },
  { label: 'Motor de inferencia', value: 'listo' },
  { label: 'Gemelo digital', value: 'sincronizado' },
  { label: 'Organizacion', value: 'esperando identidad', pending: true },
];
