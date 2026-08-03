/**
 * MATERIALES DEL VISOR — el lenguaje visual del rack, en un solo sitio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE UN ARCHIVO APARTE
 *
 * El visor tenia los colores repartidos entre literales `rgba()` y llamadas a
 * `resolverColor()`, y el resultado fue que la estructura se dibujaba y las celdas
 * no: dos caminos distintos para lo mismo. Aqui hay un solo camino, y los valores
 * de opacidad —que son el nucleo del problema reportado— se leen de una tabla en
 * vez de estar dispersos por el bucle de pintado.
 *
 * ── LA CALIBRACION ──────────────────────────────────────────────────────────
 *
 * El diagnostico del operador fue «parece un wireframe»: lineas al 10-15% de
 * opacidad. Los valores de `GRID` estan entre 26% y 42%, que es el rango en que una
 * linea sobre `--canvas` (#04080f) se lee sin ambigüedad a 1 px y sin convertirse en
 * reticula dominante.
 *
 * ── LO QUE ESTE ARCHIVO NO HACE ─────────────────────────────────────────────
 *
 * No decide QUE color lleva una celda —eso depende de la capa activa y vive en el
 * visor— sino COMO se pinta el material una vez elegido el color.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Projected } from './geometry';

// ── Resolucion de color ─────────────────────────────────────────────────────

/**
 * Resuelve un color del sistema de diseño a algo que Canvas entienda.
 *
 * ⚠ `ctx.fillStyle` NO entiende `var(--mint-400)` ni `color-mix(in oklab, …)`.
 *   Canvas descarta un valor invalido EN SILENCIO y conserva el anterior, asi que
 *   el sintoma no es un error: es que las celdas no aparecen. La estructura si se
 *   dibujaba porque usa `rgba()` literal, y eso hizo el diagnostico evidente —
 *   estanteria visible, celdas ausentes.
 *
 * Se resuelve con `getComputedStyle` sobre un elemento de sonda, y se memoiza: son
 * lecturas de estilo, que fuerzan layout si se hacen por celda.
 */
const cacheColor = new Map<string, string>();

export function resolveColor(valor: string, alfa: number): string {
  const clave = `${valor}|${alfa}`;
  const hit = cacheColor.get(clave);
  if (hit) return hit;

  let base = valor;
  const m = /^var\((--[^),]+)\)$/.exec(valor.trim());
  if (m) {
    base = getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim() || '#94a3b8';
  }

  // El navegador hace la conversion: se le pide que calcule el color sobre un
  // elemento suelto y se lee el resultado ya en rgb().
  const sonda = document.createElement('span');
  sonda.style.color = base;
  sonda.style.display = 'none';
  document.body.appendChild(sonda);
  const rgb = getComputedStyle(sonda).color;
  sonda.remove();

  const nums = rgb.match(/[\d.]+/g);
  const out =
    nums && nums.length >= 3
      ? `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alfa})`
      : `rgba(148, 163, 184, ${alfa})`;
  cacheColor.set(clave, out);
  return out;
}

/** Invalida la cache. Necesario si el tema cambia en caliente. */
export function resetColorCache(): void {
  cacheColor.clear();
  cacheHatch.clear();
}

// ── Paleta de la estructura ─────────────────────────────────────────────────
//
// Blanco azulado para lo que esta DELANTE y gris azulado para lo que esta DETRAS.
// Es la unica señal de profundidad que no depende de la geometria, y por eso se
// mantiene aunque el zoom aplane las caras.

export const PAINT = {
  /** Poste del plano del pasillo: la referencia visual principal. */
  postFront: 'rgba(219, 233, 250, 0.50)',
  /** Canto iluminado del poste, 1 px en su borde izquierdo. */
  postFrontEdge: 'rgba(240, 249, 255, 0.82)',
  /** Sombra interior del poste, para que se lea como metal y no como cinta. */
  postFrontShade: 'rgba(23, 42, 68, 0.55)',
  postBack: 'rgba(138, 166, 200, 0.20)',

  beamFront: 'rgba(198, 219, 243, 0.42)',
  beamFrontEdge: 'rgba(236, 246, 255, 0.66)',
  beamBack: 'rgba(130, 158, 192, 0.16)',

  /** Division principal: frontera de nivel y de cuerpo. Blanco azulado. */
  gridMajor: 'rgba(199, 219, 243, 0.42)',
  /** Division secundaria: posicion. Gris azulado. */
  gridMinor: 'rgba(142, 168, 200, 0.27)',
  /** Division de PROFUNDIDAD: punteada y mas oscura, para que no se confunda. */
  gridDepth: 'rgba(96, 124, 158, 0.34)',

  floorMajor: 'rgba(126, 158, 198, 0.13)',
  floorMinor: 'rgba(110, 140, 180, 0.07)',
  floorGlow: 'rgba(34, 217, 245, 0.05)',

  /** Canto del FONDO del hueco: tenue, pero presente. */
  cellBackEdge: 'rgba(163, 191, 226, 0.17)',
  /** Boca del hueco, en el plano del bastidor. Separa una celda de su vecina. */
  cellMouth: 'rgba(186, 210, 240, 0.30)',
  /** Realce del canto superior de la cara frontal. */
  cellTopHighlight: 'rgba(240, 249, 255, 0.30)',

  labelLevel: 'rgba(206, 224, 245, 0.86)',
  labelBay: 'rgba(186, 206, 232, 0.80)',
  labelChip: 'rgba(10, 20, 36, 0.72)',
  labelLead: 'rgba(150, 178, 212, 0.24)',

  /** Posicion que el catalogo NO declara. Gris, discontinua, sin relleno. */
  undeclared: 'rgba(148, 163, 184, 0.34)',
} as const;

/**
 * Opacidades del material holografico.
 *
 * Borde brillante, interior translucido, sin vidrio: la cara frontal se rellena en
 * dos tramos —cuerpo y base— para simular el charco de luz sin crear un
 * `CanvasGradient` por celda y por fotograma.
 */
export const HOLO = {
  /** Cuerpo de la cara frontal. */
  face: 0.34,
  /** Banda inferior, sumada al cuerpo: 0,34 + 0,14 ≈ 0,48 en la base. */
  faceBase: 0.14,
  /** Cara superior: recibe la luz, asi que va mas clara. */
  top: 0.19,
  topWash: 'rgba(255, 255, 255, 0.06)',
  /** Cara lateral: en sombra. */
  side: 0.12,
  sideShade: 'rgba(2, 6, 14, 0.42)',
  /** Borde de la cara frontal. Brillante: es la prioridad 2 de la jerarquia. */
  edge: 0.92,
} as const;

// ── Trama diagonal para el estado bloqueado ─────────────────────────────────
//
// El estado no puede depender SOLO del color: una celda ambar y una verde son
// indistinguibles en escala de grises y para un daltonismo rojo-verde. La trama
// diagonal es la segunda señal, y va muy tenue para no ensuciar la cara.

const cacheHatch = new Map<string, CanvasPattern | null>();

export function hatchPattern(
  ctx: CanvasRenderingContext2D,
  color: string,
): CanvasPattern | null {
  const hit = cacheHatch.get(color);
  if (hit !== undefined) return hit;

  const lado = 7;
  const off = document.createElement('canvas');
  off.width = lado;
  off.height = lado;
  const octx = off.getContext('2d');
  if (!octx) {
    cacheHatch.set(color, null);
    return null;
  }
  octx.strokeStyle = color;
  octx.lineWidth = 1;
  // Dos trazos para que el patron sea continuo al repetirse.
  octx.beginPath();
  octx.moveTo(-1, lado + 1);
  octx.lineTo(lado + 1, -1);
  octx.moveTo(lado - 1, lado + 1);
  octx.lineTo(lado + 1, lado - 1);
  octx.stroke();

  const pat = ctx.createPattern(off, 'repeat');
  cacheHatch.set(color, pat);
  return pat;
}

// ── Utilidades de trazado ───────────────────────────────────────────────────

/** Convierte un punto proyectado a pixeles con la camara dada. */
export interface Camara {
  zoom: number;
  panX: number;
  panY: number;
}

export function toScreen(c: Camara, p: Projected): [number, number] {
  return [p.sx * c.zoom + c.panX, p.sy * c.zoom + c.panY];
}

/** Traza un poligono cerrado. No pinta: deja el `path` listo. */
export function path(ctx: CanvasRenderingContext2D, c: Camara, pts: Projected[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y] = toScreen(c, pts[i]!);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Traza un segmento. */
export function segment(
  ctx: CanvasRenderingContext2D,
  c: Camara,
  a: Projected,
  b: Projected,
): void {
  const [x0, y0] = toScreen(c, a);
  const [x1, y1] = toScreen(c, b);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
}

/**
 * Grosor de linea que no desaparece al alejar ni engorda al acercar.
 *
 * Un `lineWidth` proporcional al zoom deja las lineas en 0,3 px cuando el rack se
 * ve entero —que es cuando mas falta hacen— y las convierte en franjas al acercar.
 */
export function stroke(zoom: number, base: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, base * Math.sqrt(zoom)));
}
