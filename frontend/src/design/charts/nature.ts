/**
 * NATURALEZA DEL DATO EN LOS GRAFICOS
 *
 * REGLA DE PRODUCTO: cian = medido, violeta = inferido por IA.
 *
 * Se centraliza aqui para que ningun grafico pueda elegir su color libremente.
 * Un grafico de prediccion pintado de cian mentiria sobre el origen del dato, y
 * esa es la clase de error que hace que un operador tome una decision confiando
 * en algo que el sistema solo supone.
 */

export type ChartNature = 'measured' | 'inferred' | 'alert' | 'neutral';

export interface NaturePaint {
  /** Trazo principal. */
  stroke: string;
  /** Parada superior del relleno. */
  fillTop: string;
  /** Color del halo. */
  glow: string;
}

export const naturePaint: Record<ChartNature, NaturePaint> = {
  measured: {
    stroke: 'var(--aqua-400)',
    fillTop: 'var(--aqua-400)',
    glow: 'rgb(34 217 245 / 0.45)',
  },
  inferred: {
    stroke: 'var(--iris-400)',
    fillTop: 'var(--iris-500)',
    glow: 'rgb(139 92 246 / 0.45)',
  },
  alert: {
    stroke: 'var(--ember-400)',
    fillTop: 'var(--ember-500)',
    glow: 'rgb(245 158 11 / 0.45)',
  },
  neutral: {
    stroke: 'var(--haze-300)',
    fillTop: 'var(--haze-400)',
    glow: 'rgb(132 148 168 / 0.3)',
  },
};
